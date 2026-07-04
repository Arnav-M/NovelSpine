"""Tests for project folder layout and cleanup."""

from __future__ import annotations

from pathlib import Path

import pytest

from novelspine.project_output import (
    AudiobookBuildSpec,
    AudiobookUnchangedError,
    audiobook_in_project,
    audiobook_variant_rank,
    book_stem,
    build_spec_hash,
    cleanup_intermediate_files,
    default_audiobook_path,
    markdown_content_hash,
    newest_audiobook_for_markdown,
    project_folder_for,
    unified_project_folder_for,
    readable_markdown_in_project,
    resolve_audiobook_build_path,
    unique_audiobook_path,
    work_dir_for_build,
    work_dir_for_markdown,
    write_audiobook_source_meta,
)


def _spec(
    md: Path,
    text: str,
    *,
    engine: str = "edge",
    voice: str = "en-US-JennyNeural",
    enabled: tuple[str, ...] = ("title", "ch-1"),
) -> AudiobookBuildSpec:
    return AudiobookBuildSpec(
        markdown_path=md,
        markdown_text=text,
        engine=engine,
        voice=voice,
        enabled_section_ids=enabled,
    )


def test_book_stem_and_project_folder() -> None:
    pdf = Path("C:/Books/My Novel.pdf")
    assert book_stem(pdf) == "My Novel"
    assert project_folder_for(pdf) == Path("C:/Books/My Novel")
    md = readable_markdown_in_project(pdf)
    assert md == Path("C:/Books/My Novel/My Novel.readable.md")
    audio = audiobook_in_project(md, "m4b")
    assert audio == Path("C:/Books/My Novel/My Novel.audiobook.m4b")


def test_project_folder_for_markdown_already_in_project() -> None:
    md = Path("C:/Books/My Novel/My Novel.readable.md")
    assert project_folder_for(md) == Path("C:/Books/My Novel")
    audio = Path("C:/Books/My Novel/My Novel.audiobook_1.m4b")
    assert project_folder_for(audio) == Path("C:/Books/My Novel")


def test_project_folder_for_loose_markdown() -> None:
    md = Path("C:/Books/notes.readable.md")
    assert project_folder_for(md) == Path("C:/Books/notes")


def test_unified_project_folder_is_parent_of_book_folder() -> None:
    pdf = Path("C:/Books/My Novel.pdf")
    assert unified_project_folder_for(pdf) == Path("C:/Books")

    md = Path("C:/Books/My Novel/My Novel.readable.md")
    assert unified_project_folder_for(md) == Path("C:/Books")

    loose = Path("C:/Books/notes.readable.md")
    assert unified_project_folder_for(loose) == Path("C:/Books")


def test_unique_audiobook_path(tmp_path: Path) -> None:
    first = tmp_path / "Book.audiobook.m4b"
    first.write_bytes(b"v1")
    assert unique_audiobook_path(first) == tmp_path / "Book.audiobook_1.m4b"
    assert unique_audiobook_path(tmp_path / "Book.audiobook_1.m4b") == tmp_path / "Book.audiobook_1.m4b"

    (tmp_path / "Book.audiobook_1.m4b").write_bytes(b"v2")
    assert unique_audiobook_path(first) == tmp_path / "Book.audiobook_2.m4b"


def test_newest_audiobook_for_markdown(tmp_path: Path) -> None:
    import os
    import time

    md = tmp_path / "Book.readable.md"
    md.write_text("# Book", encoding="utf-8")
    base = default_audiobook_path(md, "m4b")
    base.write_bytes(b"old")
    variant_one = tmp_path / "Book.audiobook_1.m4b"
    variant_one.write_bytes(b"v1")
    variant_two = tmp_path / "Book.audiobook_2.m4b"
    variant_two.write_bytes(b"v2")
    # Touch base most recently — rank should still prefer _2.
    time.sleep(0.02)
    os.utime(base, None)
    found = newest_audiobook_for_markdown(md, "m4b")
    assert found == variant_two


def test_audiobook_variant_rank() -> None:
    assert audiobook_variant_rank(Path("Book.audiobook.m4b")) == 0
    assert audiobook_variant_rank(Path("Book.audiobook_3.m4b")) == 3


def test_work_dir_for_build_changes_with_voice(tmp_path: Path) -> None:
    md = tmp_path / "Book.readable.md"
    text = "# Book\n\nChapter one."
    md.write_text(text, encoding="utf-8")
    spec_a = _spec(md, text, voice="voice-a")
    spec_b = _spec(md, text, voice="voice-b")
    assert work_dir_for_build(spec_a) != work_dir_for_build(spec_b)
    assert build_spec_hash(spec_a) != build_spec_hash(spec_b)


def test_resolve_skips_when_build_unchanged(tmp_path: Path) -> None:
    md = tmp_path / "Book.readable.md"
    text = "# Book\n\nChapter one."
    md.write_text(text, encoding="utf-8")
    audio = default_audiobook_path(md, "m4b")
    audio.write_bytes(b"existing")
    spec = _spec(md, text)
    write_audiobook_source_meta(audio, spec)

    with pytest.raises(AudiobookUnchangedError) as exc:
        resolve_audiobook_build_path(spec, "m4b")
    assert exc.value.existing_path == audio


def test_resolve_uses_new_variant_when_voice_changes(tmp_path: Path) -> None:
    md = tmp_path / "Book.readable.md"
    text = "# Book\n\nChapter one."
    md.write_text(text, encoding="utf-8")
    audio = default_audiobook_path(md, "m4b")
    audio.write_bytes(b"existing")
    write_audiobook_source_meta(audio, _spec(md, text, voice="voice-a"))

    out = resolve_audiobook_build_path(_spec(md, text, voice="voice-b"), "m4b")
    assert out == tmp_path / "Book.audiobook_1.m4b"


def test_resolve_uses_new_variant_when_sections_change(tmp_path: Path) -> None:
    md = tmp_path / "Book.readable.md"
    text = "# Book\n\nChapter one."
    md.write_text(text, encoding="utf-8")
    audio = default_audiobook_path(md, "m4b")
    audio.write_bytes(b"existing")
    write_audiobook_source_meta(audio, _spec(md, text, enabled=("title", "ch-1")))

    out = resolve_audiobook_build_path(_spec(md, text, enabled=("title", "ch-1", "ch-2")), "m4b")
    assert out == tmp_path / "Book.audiobook_1.m4b"


def test_resolve_uses_new_variant_when_markdown_changed(tmp_path: Path) -> None:
    md = tmp_path / "Book.readable.md"
    old_text = "# Book\n\nChapter one."
    new_text = "# Book\n\nChapter one.\n\nNew paragraph."
    md.write_text(new_text, encoding="utf-8")
    audio = default_audiobook_path(md, "m4b")
    audio.write_bytes(b"existing")
    write_audiobook_source_meta(audio, _spec(md, old_text))

    out = resolve_audiobook_build_path(_spec(md, new_text), "m4b")
    assert out == tmp_path / "Book.audiobook_1.m4b"


def test_markdown_content_hash_stable() -> None:
    assert markdown_content_hash("abc") == markdown_content_hash("abc")
    assert markdown_content_hash("abc") != markdown_content_hash("abcd")


def test_cleanup_removes_intermediate_files(tmp_path: Path) -> None:
    md = tmp_path / "Book.readable.md"
    md.write_text("# Book", encoding="utf-8")
    raw = tmp_path / "Book.raw.md"
    raw.write_text("raw", encoding="utf-8")
    work = work_dir_for_markdown(md)
    work.mkdir()
    (work / "sections").mkdir()
    (work / "sections" / "001_part.mp3").write_bytes(b"x" * 2048)

    audio = tmp_path / "Book.audiobook.m4b"
    audio.write_bytes(b"fake")
    chapters = tmp_path / "Book.audiobook.chapters.json"
    chapters.write_text("[]", encoding="utf-8")
    manifest = tmp_path / "Book.audiobook.manifest.json"
    manifest.write_text("{}", encoding="utf-8")
    cover = tmp_path / "Book.readable.cover.png"
    cover.write_bytes(b"png")

    removed = cleanup_intermediate_files(audio, md, remove_markdown=True)
    assert md not in [Path(p) for p in removed] or not md.is_file()
    assert not md.is_file()
    assert not raw.is_file()
    assert not work.is_dir()
    assert not manifest.is_file()
    assert audio.is_file()
    assert chapters.is_file()
    assert cover.is_file()
