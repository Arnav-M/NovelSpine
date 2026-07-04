"""Tests for bundled ffmpeg discovery."""

from __future__ import annotations

from pathlib import Path

from novelspine.ffmpeg_path import configure_ffmpeg_env, find_ffmpeg, find_ffprobe


def test_find_ffmpeg_from_env_dir(tmp_path: Path, monkeypatch) -> None:
    bin_dir = tmp_path / "ffmpeg"
    bin_dir.mkdir()
    ffmpeg = bin_dir / "ffmpeg.exe"
    ffprobe = bin_dir / "ffprobe.exe"
    ffmpeg.write_bytes(b"fake")
    ffprobe.write_bytes(b"fake")

    monkeypatch.delenv("PATH", raising=False)
    monkeypatch.setenv("NOVELSPINE_FFMPEG_DIR", str(bin_dir))

    assert find_ffmpeg() == str(ffmpeg)
    assert find_ffprobe() == str(ffprobe)


def test_configure_ffmpeg_env_prepends_path(tmp_path: Path, monkeypatch) -> None:
    import os

    bin_dir = tmp_path / "ffmpeg"
    bin_dir.mkdir()
    ffmpeg = bin_dir / "ffmpeg.exe"
    ffmpeg.write_bytes(b"fake")

    monkeypatch.delenv("PATH", raising=False)
    monkeypatch.setenv("NOVELSPINE_FFMPEG_DIR", str(bin_dir))

    configured = configure_ffmpeg_env()
    assert configured == str(ffmpeg)
    assert str(bin_dir) in os.environ["PATH"]
