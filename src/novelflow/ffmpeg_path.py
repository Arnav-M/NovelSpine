"""Locate ffmpeg/ffprobe: system PATH, bundled install, or dev checkout."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

_FFMPEG_NAMES = ("ffmpeg.exe", "ffmpeg") if sys.platform == "win32" else ("ffmpeg",)
_FFPROBE_NAMES = ("ffprobe.exe", "ffprobe") if sys.platform == "win32" else ("ffprobe",)


def _bundled_bin_dirs() -> list[Path]:
    dirs: list[Path] = []
    env_dir = os.environ.get("NOVELFLOW_FFMPEG_DIR", "").strip()
    if env_dir:
        dirs.append(Path(env_dir))

    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
    else:
        exe_dir = Path(sys.argv[0]).resolve().parent

    dirs.extend(
        [
            exe_dir / "ffmpeg",
            exe_dir / "resources" / "ffmpeg",
        ]
    )

    if not getattr(sys, "frozen", False):
        # Local dev after `scripts/fetch-ffmpeg.ps1`
        dev_dir = Path(__file__).resolve().parents[2] / "src-tauri" / "resources" / "ffmpeg"
        if dev_dir.is_dir():
            dirs.append(dev_dir)

    seen: set[Path] = set()
    unique: list[Path] = []
    for d in dirs:
        resolved = d.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        unique.append(resolved)
    return unique


def find_ffmpeg() -> str | None:
    """Return path to ffmpeg binary, or None if not found."""
    found = shutil.which("ffmpeg")
    if found:
        return found

    for bin_dir in _bundled_bin_dirs():
        for name in _FFMPEG_NAMES:
            candidate = bin_dir / name
            if candidate.is_file():
                return str(candidate)
    return None


def find_ffprobe() -> str | None:
    """Return path to ffprobe binary, or None if not found."""
    found = shutil.which("ffprobe")
    if found:
        return found

    for bin_dir in _bundled_bin_dirs():
        for name in _FFPROBE_NAMES:
            candidate = bin_dir / name
            if candidate.is_file():
                return str(candidate)
    return None


def configure_ffmpeg_env() -> str | None:
    """Prepend bundled ffmpeg dir to PATH for this process. Returns ffmpeg path."""
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        return None

    bin_dir = str(Path(ffmpeg).parent)
    path = os.environ.get("PATH", "")
    parts = path.split(os.pathsep) if path else []
    if bin_dir not in parts:
        os.environ["PATH"] = bin_dir + (os.pathsep + path if path else "")
    os.environ.setdefault("NOVELFLOW_FFMPEG_DIR", bin_dir)
    return ffmpeg
