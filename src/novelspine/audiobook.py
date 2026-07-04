"""Generate chapter-marked audiobooks from readable markdown."""

from __future__ import annotations

import json
import re
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from novelspine.audio_merge import _probe_duration_ms, merge_audiobook, update_manifest_timestamps
from novelspine.book_structure import (
    BookManifest,
    BookSection,
    SectionKind,
    apply_default_audiobook_filter,
    apply_section_filter,
    parse_book_sections,
    reader_lines_for_section,
)
from novelspine.convert import ConversionCancelled, _check_cancel
from novelspine.reader_sidecar import (
    line_starts_from_sentence_boundaries,
    line_starts_from_weights,
    reader_sidecar_path,
    save_reader_sidecar,
)
from novelspine.tts_config import resolve_engine, section_workers
from novelspine.path_utils import safe_rmtree, safe_unlink
from novelspine.project_output import (
    AudiobookBuildSpec,
    default_audiobook_path,
    resolve_audiobook_build_path,
    work_dir_for_build,
    write_audiobook_source_meta,
    write_work_dir_fingerprint,
)
from novelspine.tts_engines import get_engine
from novelspine.tts_voices import default_voice

# A valid synthesized section MP3 is comfortably larger than this; anything
# smaller is treated as a corrupt/partial leftover and re-rendered on resume.
_MIN_VALID_SECTION_BYTES = 1024

# Titles that already lead with "Chapter …" carry their own number/name.
_CHAPTER_PREFIX_RE = re.compile(r"^\s*chapter\b", re.I)
_PURE_NUMBER_RE = re.compile(r"^[\divxlcdm.\s]+$", re.I)


def _chapter_announcement(section: BookSection, number: int) -> str:
    """Spoken intro for a chapter, e.g. ``"Chapter 3. The Storm"``.

    Folded into the section's first chunk at synthesis time, so it adds a few
    words to one already-scheduled TTS call rather than any new work.
    """
    title = section.title.strip()
    if _CHAPTER_PREFIX_RE.match(title):
        return title  # already "Chapter 5", "Chapter 5: The Storm", etc.
    if not title or _PURE_NUMBER_RE.match(title):
        return f"Chapter {number}"
    return f"Chapter {number}. {title}"


def _speech_with_announcement(section: BookSection, intro: str | None) -> str:
    if not intro:
        return section.text
    body = section.text.strip()
    if not body or body.lower() == section.title.strip().lower():
        return intro
    return f"{intro}. {body}"

# Synthesis owns 2–85% of the audiobook progress band; merge owns 85–100%.
_SYNTH_LO = 2.0
_SYNTH_HI = 85.0


def create_audiobook(
    markdown_path: Path,
    output_path: Path | None = None,
    *,
    engine: str = "auto",
    voice: str | None = None,
    audio_format: str = "m4b",
    disabled_section_ids: set[str] | None = None,
    chapters_and_title_only: bool = True,
    resume: bool = True,
    keep_sections: bool = True,
    progress: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> tuple[Path, BookManifest]:
    """
    Convert readable markdown to an audiobook with navigable section markers.

    By default only the title page and story chapters are synthesized.

    ``on_progress`` reports a 0–100 percentage driven by real work: synthesis
    is weighted by each section's text length and updated as TTS chunks land,
    and the merge phase follows ffmpeg's own progress output.
    """
    log = progress or print
    resolved_engine = resolve_engine(engine)
    voice = voice or default_voice(resolved_engine)

    md_path = Path(markdown_path).resolve()
    if not md_path.is_file():
        raise FileNotFoundError(f"Markdown not found: {md_path}")

    markdown = md_path.read_text(encoding="utf-8")
    manifest = parse_book_sections(markdown)

    if disabled_section_ids is not None:
        manifest = apply_section_filter(manifest, disabled_section_ids)
    elif chapters_and_title_only:
        manifest = apply_default_audiobook_filter(manifest)

    if output_path is None:
        base = default_audiobook_path(md_path, audio_format)
    else:
        base = Path(output_path).resolve()
        if not base.suffix:
            base = base.with_suffix(f".{audio_format.lstrip('.')}")

    enabled = manifest.enabled_sections()
    if not enabled:
        raise ValueError("No enabled sections to synthesize.")

    build_spec = AudiobookBuildSpec(
        markdown_path=md_path,
        markdown_text=markdown,
        engine=resolved_engine,
        voice=voice,
        enabled_section_ids=tuple(s.id for s in enabled),
    )
    out = resolve_audiobook_build_path(build_spec, audio_format, output_base=base)
    if out.name != default_audiobook_path(md_path, audio_format).name:
        log(f"Saving new audiobook as {out.name} (markdown, voice, or sections changed).")

    work_dir = work_dir_for_build(build_spec)
    sections_dir = work_dir / "sections"
    if not resume and work_dir.exists():
        safe_rmtree(work_dir)
    sections_dir.mkdir(parents=True, exist_ok=True)
    write_work_dir_fingerprint(work_dir, build_spec)

    log(
        f"TTS engine: {resolved_engine} "
        f"({section_workers(engine)} section worker(s), "
        f"{len(enabled)} section(s))"
    )

    engine_impl = get_engine(engine)
    section_files: list[tuple[str, str, Path]] = []
    total = len(enabled)
    completed = 0

    # Number chapters in reading order so the narrator says "Chapter 1",
    # "Chapter 2", … The intro is merged into each chapter's first chunk, so
    # it costs a few extra words on an already-scheduled call — not a new one.
    announcements: dict[str, str] = {}
    chapter_numbers: dict[str, int] = {}
    chapter_no = 0
    for s in enabled:
        if s.kind == SectionKind.CHAPTER:
            chapter_no += 1
            chapter_numbers[s.id] = chapter_no
            announcements[s.id] = _chapter_announcement(s, chapter_no)

    reader_sections: dict[str, dict] = {}
    reader_lock = threading.Lock()

    # Weight each section by its text length so a 30-page chapter advances the
    # bar far more than a one-line title — i.e. progress tracks real work.
    total_chars = sum(max(len(s.text), 1) for s in enabled)
    weights = {s.order: max(len(s.text), 1) / total_chars for s in enabled}
    section_frac: dict[int, float] = {}
    progress_lock = threading.Lock()

    def _emit_synth_progress() -> None:
        if not on_progress:
            return
        overall = sum(weights[o] * section_frac.get(o, 0.0) for o in weights)
        on_progress(_SYNTH_LO + (_SYNTH_HI - _SYNTH_LO) * overall)

    def _set_section_fraction(order: int, frac: float) -> None:
        with progress_lock:
            section_frac[order] = max(section_frac.get(order, 0.0), frac)
            _emit_synth_progress()

    def _store_reader_timings(
        section: BookSection,
        part_path: Path,
        *,
        word_boundaries: list[dict[str, object]] | None = None,
    ) -> None:
        chapter_number = chapter_numbers.get(section.id)
        lines, weights = reader_lines_for_section(section, chapter_number)
        duration_ms = _probe_duration_ms(part_path)
        if word_boundaries:
            line_start_ms = line_starts_from_sentence_boundaries(
                lines,
                word_boundaries,
                duration_ms,
            )
        else:
            line_start_ms = line_starts_from_weights(lines, weights, duration_ms)
        with reader_lock:
            reader_sections[section.id] = {
                "lines": lines,
                "line_start_ms": line_start_ms,
                "line_weights": weights,
                "duration_ms": duration_ms,
            }

    def _synthesize(section: BookSection) -> tuple[str, str, Path, BookSection]:
        _check_cancel(cancel_check)
        part_path = sections_dir / f"{section.order:03d}_{section.id}.mp3"
        for stale in sections_dir.glob(f"{section.order:03d}_{section.id}.part*.mp3"):
            safe_unlink(stale)
        if part_path.is_file() and part_path.stat().st_size >= _MIN_VALID_SECTION_BYTES:
            _set_section_fraction(section.order, 1.0)
            _store_reader_timings(section, part_path)
            return section.id, section.title, part_path, section
        speech = _speech_with_announcement(section, announcements.get(section.id))
        synth = engine_impl.synthesize_section_detailed(
            speech,
            part_path,
            voice=voice,
            progress=log,
            on_progress=lambda frac, o=section.order: _set_section_fraction(o, frac),
        )
        _set_section_fraction(section.order, 1.0)
        _store_reader_timings(section, synth.path, word_boundaries=synth.word_boundaries)
        return section.id, section.title, part_path, section

    workers = section_workers(engine)
    results: dict[int, tuple[str, str, Path]] = {}

    if workers <= 1:
        for idx, section in enumerate(enabled):
            log(f"Section {idx + 1}/{total}: {section.title} ({section.kind.value})")
            section_id, title, path, _ = _synthesize(section)
            results[section.order] = (section_id, title, path)
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_synthesize, section): section for section in enabled}
            for future in as_completed(futures):
                section = futures[future]
                section_id, title, path, _ = future.result()
                results[section.order] = (section_id, title, path)
                with progress_lock:
                    completed += 1
                log(f"Section {completed}/{total}: {section.title} ({section.kind.value})")

    for section in enabled:
        section_id, title, path = results[section.order]
        section_files.append((section_id, title, path))

    _check_cancel(cancel_check)
    log("Merging sections with chapter markers…")

    def _merge_progress(frac: float) -> None:
        if on_progress:
            on_progress(_SYNTH_HI + (100.0 - _SYNTH_HI) * frac)

    audiobook_path, markers = merge_audiobook(
        section_files, out, audio_format=audio_format, on_progress=_merge_progress,
    )

    manifest_path = audiobook_path.with_suffix(".manifest.json")
    manifest.save(manifest_path)
    update_manifest_timestamps(manifest_path, markers)

    # Pair each chapter marker with its source section MP3 (when kept) so the
    # in-app player can stream chapters directly without decoding the m4b.
    marker_files = {section_id: path for section_id, _title, path in section_files}
    meta_sidecar = audiobook_path.with_suffix(".chapters.json")
    meta_sidecar.write_text(
        json.dumps(
            [
                {
                    "id": m.id or None,
                    "title": m.title,
                    "start_ms": m.start_ms,
                    "end_ms": m.end_ms,
                    "file": (
                        str(marker_files[m.id])
                        if keep_sections and m.id and m.id in marker_files
                        else None
                    ),
                }
                for m in markers
            ],
            indent=2,
        ),
        encoding="utf-8",
    )

    save_reader_sidecar(audiobook_path, reader_sections)
    log(f"Reader timings: {reader_sidecar_path(audiobook_path).name}")

    if not keep_sections:
        safe_rmtree(work_dir)
    else:
        log(f"Section audio kept in: {sections_dir}")

    if on_progress:
        on_progress(100)
    write_audiobook_source_meta(audiobook_path, build_spec)
    log(f"Audiobook saved: {audiobook_path}")
    log(f"Navigation manifest: {manifest_path}")
    return audiobook_path, manifest
