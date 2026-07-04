"""Tests for audiobook library scanning."""

from __future__ import annotations

from pathlib import Path

from novelspine.player import scan_audiobook_folder


def test_scan_finds_numbered_audiobook_variants(tmp_path: Path) -> None:
    base = tmp_path / "Novel.audiobook.m4b"
    rebuild = tmp_path / "Novel.audiobook_1.m4b"
    legacy = tmp_path / "Novel.audiobook-2.m4b"
    base.write_bytes(b"old" * 400)
    rebuild.write_bytes(b"new" * 400)
    legacy.write_bytes(b"legacy" * 400)

    entries = scan_audiobook_folder(tmp_path)
    paths = {path.name for _, path in entries}
    labels = dict(entries)

    assert "Novel.audiobook.m4b" in paths
    assert "Novel.audiobook_1.m4b" in paths
    assert "Novel.audiobook-2.m4b" in paths
    assert labels["Novel (1, m4b)"] == rebuild
    assert labels["Novel (2, m4b)"] == legacy
    assert labels["Novel (m4b)"] == base


def test_scan_includes_audio_format_in_label(tmp_path: Path) -> None:
    m4b = tmp_path / "Novel.audiobook.m4b"
    m4a = tmp_path / "Novel.audiobook.m4a"
    m4b.write_bytes(b"x" * 2048)
    m4a.write_bytes(b"y" * 2048)

    entries = scan_audiobook_folder(tmp_path)
    labels = dict(entries)

    assert labels["Novel (m4b)"] == m4b
    assert labels["Novel (m4a)"] == m4a


def test_scan_finds_audiobooks_in_book_subfolder(tmp_path: Path) -> None:
    book_dir = tmp_path / "My Novel"
    book_dir.mkdir()
    audio = book_dir / "My Novel.audiobook.m4b"
    audio.write_bytes(b"x" * 2048)

    entries = scan_audiobook_folder(tmp_path)
    assert len(entries) == 1
    assert entries[0][1] == audio


def test_scan_finds_audiobooks_in_nested_subfolders(tmp_path: Path) -> None:
    nested = tmp_path / "Series" / "My Novel"
    nested.mkdir(parents=True)
    audio = nested / "My Novel.audiobook.m4b"
    audio.write_bytes(b"x" * 2048)

    entries = scan_audiobook_folder(tmp_path)
    assert len(entries) == 1
    assert entries[0][1] == audio


def test_scan_ignores_sidecar_without_merged_audio(tmp_path: Path) -> None:
    sidecar = tmp_path / "Novel.audiobook.chapters.json"
    sidecar.write_text("[]", encoding="utf-8")
    sections = tmp_path / ".Novel.readable_audiobook_work" / "sections"
    sections.mkdir(parents=True)
    mp3 = sections / "001_part.mp3"
    mp3.write_bytes(b"x" * 2048)

    entries = scan_audiobook_folder(tmp_path)
    assert entries == []


def test_scan_ignores_tiny_stub_files(tmp_path: Path) -> None:
    stub = tmp_path / "Novel.audiobook.m4b"
    stub.write_bytes(b"x")

    entries = scan_audiobook_folder(tmp_path)
    assert entries == []
