"""Project folder layout and optional cleanup after audiobook creation."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from novelspine.path_utils import safe_rmtree, safe_unlink


class AudiobookUnchangedError(Exception):
    """Raised when an existing audiobook already matches the requested build."""

    def __init__(self, existing_path: Path, message: str | None = None) -> None:
        self.existing_path = Path(existing_path).resolve()
        text = message or (
            f"Audiobook already matches {self.existing_path.name}. "
            "Change the markdown, voice, or section selection before rebuilding."
        )
        super().__init__(text)


@dataclass(frozen=True)
class AudiobookBuildSpec:
    markdown_path: Path
    markdown_text: str
    engine: str
    voice: str
    enabled_section_ids: tuple[str, ...]


def _paths_equal(a: Path | str, b: Path | str) -> bool:
    if not a or not b:
        return False
    return str(Path(a).resolve()).replace("\\", "/").lower() == str(Path(b).resolve()).replace("\\", "/").lower()


def markdown_content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_spec_hash(spec: AudiobookBuildSpec) -> str:
    """Short fingerprint for a synthesis work directory."""
    payload = "|".join(
        [
            markdown_content_hash(spec.markdown_text),
            spec.engine,
            spec.voice,
            ",".join(spec.enabled_section_ids),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def markdown_path_for_audiobook(audiobook_path: Path) -> Path | None:
    """Best-effort readable markdown beside an audiobook file."""
    folder = Path(audiobook_path).resolve().parent
    stem = Path(audiobook_path).stem
    if ".audiobook_" in stem:
        base = stem.rsplit(".audiobook_", 1)[0]
    elif ".audiobook-" in stem:
        base = stem.rsplit(".audiobook-", 1)[0]
    elif ".audiobook" in stem:
        base = stem.split(".audiobook", 1)[0]
    else:
        base = stem
    for name in (f"{base}.readable.md", f"{base}.md"):
        candidate = folder / name
        if candidate.is_file():
            return candidate.resolve()
    return None


def _read_source_sidecar(audiobook_path: Path) -> dict | None:
    sidecar = Path(audiobook_path).resolve().with_suffix(".source.json")
    if not sidecar.is_file():
        return None
    try:
        data = json.loads(sidecar.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def write_audiobook_source_meta(
    audiobook_path: Path,
    spec: AudiobookBuildSpec,
) -> None:
    """Persist build inputs so identical rebuilds can be skipped safely."""
    sidecar = Path(audiobook_path).resolve().with_suffix(".source.json")
    payload = {
        "markdown_path": str(spec.markdown_path.resolve()),
        "markdown_sha256": markdown_content_hash(spec.markdown_text),
        "engine": spec.engine,
        "voice": spec.voice,
        "enabled_section_ids": list(spec.enabled_section_ids),
    }
    sidecar.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _stored_markdown_fingerprint(audiobook_path: Path) -> tuple[Path | None, str | None]:
    stored = _read_source_sidecar(audiobook_path)
    if stored is not None:
        md_path = stored.get("markdown_path")
        sha = stored.get("markdown_sha256")
        resolved = Path(md_path).resolve() if md_path else markdown_path_for_audiobook(audiobook_path)
        return resolved, sha if isinstance(sha, str) else None

    audio = Path(audiobook_path).resolve()
    manifest = audio.with_suffix(".manifest.json")
    if manifest.is_file():
        from novelspine.book_structure import BookManifest

        manifest_data = BookManifest.load(manifest)
        return markdown_path_for_audiobook(audio), markdown_content_hash(manifest_data.source_markdown)

    folder_md = markdown_path_for_audiobook(audio)
    if folder_md is not None:
        return folder_md, markdown_content_hash(folder_md.read_text(encoding="utf-8"))
    return None, None


def _variant_stem_matches(stem: str, base_stem: str) -> bool:
    if stem == base_stem:
        return True
    if stem.startswith(f"{base_stem}_"):
        return True
    if stem.startswith(f"{base_stem}-"):  # legacy hyphen variants
        return True
    return False


def _audiobook_variants_for_base(base: Path) -> list[Path]:
    parent = base.parent
    if not parent.is_dir():
        return []
    return [
        p
        for p in parent.iterdir()
        if p.is_file()
        and p.suffix.lower() == base.suffix.lower()
        and _variant_stem_matches(p.stem, base.stem)
    ]


def _enabled_ids_from_sidecar(data: dict) -> tuple[str, ...] | None:
    raw = data.get("enabled_section_ids")
    if not isinstance(raw, list):
        return None
    return tuple(str(item) for item in raw)


def _audiobook_matches_build(audio: Path, spec: AudiobookBuildSpec) -> bool:
    stored = _read_source_sidecar(audio)
    if stored is None:
        return False
    if stored.get("voice") is None or stored.get("enabled_section_ids") is None:
        return False

    stored_md = stored.get("markdown_path")
    if not stored_md or not _paths_equal(stored_md, spec.markdown_path):
        return False
    if stored.get("markdown_sha256") != markdown_content_hash(spec.markdown_text):
        return False
    if stored.get("engine") != spec.engine:
        return False
    if stored.get("voice") != spec.voice:
        return False
    stored_ids = _enabled_ids_from_sidecar(stored)
    if stored_ids is None or stored_ids != spec.enabled_section_ids:
        return False
    return True


def resolve_audiobook_build_path(
    spec: AudiobookBuildSpec,
    audio_format: str,
    *,
    output_base: Path | None = None,
) -> Path:
    """
    Pick an output path for a new audiobook build.

    Raises :class:`AudiobookUnchangedError` when an on-disk audiobook already
    matches the same markdown, voice, engine, and section selection.
    Otherwise returns an unused path (``Book.audiobook_1.m4b``, …).
    """
    md = spec.markdown_path.resolve()
    base = Path(output_base).resolve() if output_base else default_audiobook_path(md, audio_format)
    variant_root = default_audiobook_path(md, audio_format)
    variants = _audiobook_variants_for_base(variant_root)
    variants.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    for audio in variants:
        if _audiobook_matches_build(audio, spec):
            raise AudiobookUnchangedError(
                audio,
                f"Audiobook already matches {md.name} with this voice and section selection.",
            )
    return unique_audiobook_path(base)


def book_stem(path: Path) -> str:
    """Stable folder/file stem for a PDF, markdown, or audiobook path."""
    stem = Path(path).resolve().stem
    if stem.endswith(".readable"):
        stem = stem[: -len(".readable")]
    if ".audiobook_" in stem:
        stem = stem.split(".audiobook_", 1)[0]
    elif ".audiobook" in stem:
        stem = stem.split(".audiobook", 1)[0]
    return stem


def project_folder_for(path: Path) -> Path:
    """Folder that holds all artifacts for one book (``Book/`` beside ``Book.pdf``)."""
    resolved = Path(path).resolve()
    stem = book_stem(resolved)
    parent = resolved.parent
    if parent.name == stem:
        return parent
    return parent / stem


def unified_project_folder_for(path: Path) -> Path:
    """Parent library folder containing per-book project subfolders."""
    book_folder = project_folder_for(path)
    parent = book_folder.parent
    if parent.name:
        return parent
    return book_folder


def ensure_project_folder(path: Path) -> Path:
    folder = Path(path).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def readable_markdown_in_project(source: Path) -> Path:
    """``Book/Book.readable.md`` for a PDF or markdown source."""
    folder = ensure_project_folder(project_folder_for(source))
    return folder / f"{book_stem(source)}.readable.md"


def audiobook_in_project(markdown_or_source: Path, audio_format: str) -> Path:
    """``Book/Book.audiobook.m4b`` beside the readable markdown."""
    folder = ensure_project_folder(project_folder_for(markdown_or_source))
    fmt = audio_format.lstrip(".")
    return folder / f"{book_stem(markdown_or_source)}.audiobook.{fmt}"


def default_audiobook_path(markdown_path: Path, audio_format: str) -> Path:
    """Default ``Book.audiobook.m4b`` beside readable markdown (before uniquification)."""
    md = Path(markdown_path).resolve()
    stem = md.stem
    if stem.endswith(".readable"):
        stem = stem[: -len(".readable")]
    fmt = audio_format.lstrip(".")
    return md.with_name(f"{stem}.audiobook.{fmt}")


def unique_audiobook_path(path: Path) -> Path:
    """
    Return ``path`` when unused, otherwise ``name_1.ext``, ``name_2.ext``, …

    Avoids overwriting an audiobook that may be open in the player.
    """
    candidate = Path(path).resolve()
    if not candidate.is_file():
        return candidate
    stem = candidate.stem
    suffix = candidate.suffix
    parent = candidate.parent
    for n in range(1, 1000):
        alt = parent / f"{stem}_{n}{suffix}"
        if not alt.is_file():
            return alt
    raise FileExistsError(f"Too many audiobook variants for {candidate.name}")


def audiobook_variant_rank(path: Path) -> int:
    """Return 0 for base ``Book.audiobook.m4b``, N for ``Book.audiobook_N.m4b``."""
    name = Path(path).name
    numbered = re.search(r"\.audiobook_(\d+)\.", name, re.I)
    if numbered:
        return int(numbered.group(1))
    if re.search(r"\.audiobook\.[^.]+$", name, re.I):
        return 0
    return -1


def newest_audiobook_for_markdown(markdown_path: Path, audio_format: str) -> Path | None:
    """Highest-numbered audiobook variant for a markdown source (mtime as tiebreaker)."""
    base = default_audiobook_path(markdown_path, audio_format)
    matches = _audiobook_variants_for_base(base)
    if not matches:
        return None
    return max(matches, key=lambda p: (audiobook_variant_rank(p), p.stat().st_mtime))


def work_dir_base_for_markdown(markdown_path: Path) -> Path:
    return Path(markdown_path).resolve().parent / f".{Path(markdown_path).stem}_audiobook_work"


def work_dir_for_markdown(markdown_path: Path) -> Path:
    """Legacy base work dir (contains one subdir per build spec)."""
    return work_dir_base_for_markdown(markdown_path)


def work_dir_for_build(spec: AudiobookBuildSpec) -> Path:
    """Spec-specific work directory root (contains ``sections/``)."""
    return work_dir_base_for_markdown(spec.markdown_path) / build_spec_hash(spec)


def write_work_dir_fingerprint(work_dir: Path, spec: AudiobookBuildSpec) -> None:
    """Persist build inputs beside cached section MP3s."""
    payload = {
        "markdown_path": str(spec.markdown_path.resolve()),
        "markdown_sha256": markdown_content_hash(spec.markdown_text),
        "engine": spec.engine,
        "voice": spec.voice,
        "enabled_section_ids": list(spec.enabled_section_ids),
    }
    work_dir.mkdir(parents=True, exist_ok=True)
    (work_dir / ".build.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


def cleanup_intermediate_files(
    audiobook_path: Path,
    markdown_path: Path | None = None,
    *,
    remove_markdown: bool = True,
    progress: Callable[[str], None] | None = None,
) -> list[str]:
    """
    Remove synthesis leftovers after a successful audiobook build.

    Keeps the final audiobook, ``.chapters.json`` sidecar, and any cover images.
    """
    log = progress or (lambda _msg: None)
    removed: list[str] = []
    audio = Path(audiobook_path).resolve()

    if markdown_path:
        md = Path(markdown_path).resolve()
        work_dir = work_dir_for_markdown(md)
        if work_dir.is_dir():
            safe_rmtree(work_dir)
            removed.append(str(work_dir))

        if remove_markdown and md.is_file():
            safe_unlink(md)
            removed.append(str(md))

        stem = book_stem(md)
        folder = md.parent
        for candidate in (
            folder / f"{stem}.raw.md",
            md.with_name(f"{stem}.raw.md"),
            md.with_suffix(".raw.md"),
        ):
            if candidate.is_file():
                safe_unlink(candidate)
                removed.append(str(candidate))

    manifest = audio.with_suffix(".manifest.json")
    if manifest.is_file():
        safe_unlink(manifest)
        removed.append(str(manifest))

    if removed:
        log(f"Removed {len(removed)} intermediate file(s); kept audiobook and chapter index.")
    else:
        log("No intermediate files to remove.")
    return removed
