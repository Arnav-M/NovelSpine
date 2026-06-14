"""Library scan and chapter metadata for the React player."""

from __future__ import annotations

from pathlib import Path

from novelflow.cover_art import find_cover_for_audiobook, find_cover_in_markdown
from novelflow.player import load_chapters, scan_audiobook_folder


def _guess_markdown(audio_path: Path) -> Path | None:
    folder = audio_path.parent
    stem = audio_path.stem
    if ".audiobook" in stem:
        base = stem.split(".audiobook", 1)[0]
    else:
        base = stem
    for name in (f"{base}.readable.md", f"{base}.md"):
        candidate = folder / name
        if candidate.is_file():
            return candidate.resolve()
    readable = folder / f"{base}.readable.md"
    return readable.resolve() if readable.is_file() else None


def scan_library(root: str) -> list[dict]:
    folder = Path(root).resolve()
    if not folder.is_dir():
        return []
    items: list[dict] = []
    for label, audio_path in scan_audiobook_folder(folder):
        md = _guess_markdown(audio_path)
        cover = find_cover_for_audiobook(audio_path, markdown_path=md)
        items.append(
            {
                "label": label,
                "audio_path": str(audio_path.resolve()),
                "markdown_path": str(md) if md else None,
                "cover_path": str(cover) if cover else None,
            }
        )
    return items


def chapters_for_audio(audio_path: str, *, probe_durations: bool = True) -> dict:
    path = Path(audio_path).resolve()
    chapters = load_chapters(path, probe_durations=probe_durations)
    playable = None
    if path.is_file() and path.suffix.lower() in {".mp3", ".m4a", ".m4b", ".ogg", ".wav"}:
        playable = str(path)
    elif chapters and all(c.file is not None for c in chapters):
        playable = str(chapters[0].file) if chapters[0].file else None
    return {
        "audio_path": str(path),
        "playable_path": playable,
        "chapters": [
            {
                "title": c.title,
                "duration_ms": c.duration_ms,
                "file": str(c.file) if c.file else None,
                "start_ms": c.start_ms,
            }
            for c in chapters
        ],
    }


def cover_for_markdown(markdown_path: str) -> str | None:
    found = find_cover_in_markdown(Path(markdown_path))
    return str(found.resolve()) if found else None
