"""Tests for Windows-safe path helpers."""

from __future__ import annotations

from pathlib import Path

from novelspine.path_utils import safe_rmtree, safe_unlink


def test_safe_unlink_removes_file(tmp_path: Path) -> None:
    target = tmp_path / "chunk.mp3"
    target.write_bytes(b"audio")
    assert safe_unlink(target)
    assert not target.exists()


def test_safe_rmtree_removes_directory(tmp_path: Path) -> None:
    work = tmp_path / "work"
    sections = work / "sections"
    sections.mkdir(parents=True)
    (sections / "001_part.mp3").write_bytes(b"x" * 2048)
    assert safe_rmtree(work)
    assert not work.exists()
