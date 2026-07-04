"""Windows-safe file removal (handles transient file locks)."""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path


def _is_locked_error(exc: OSError) -> bool:
    if exc.errno in (13, 16, 32):  # EACCES, EBUSY, ESHARE (Windows sharing violation)
        return True
    winerror = getattr(exc, "winerror", None)
    return winerror in (5, 32)  # ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION


def safe_unlink(path: Path, *, retries: int = 12, delay: float = 0.12) -> bool:
    """Delete a file, retrying when Windows still holds a handle (WinError 32)."""
    for attempt in range(retries):
        try:
            path.unlink(missing_ok=True)
            return not path.exists()
        except FileNotFoundError:
            return True
        except OSError as exc:
            if not _is_locked_error(exc) or attempt == retries - 1:
                raise
            time.sleep(delay * (attempt + 1))
    return not path.exists()


def safe_rmtree(path: Path, *, retries: int = 8, delay: float = 0.2) -> bool:
    """Remove a directory tree, retrying on transient Windows file locks."""
    if not path.exists():
        return True
    for attempt in range(retries):
        try:
            shutil.rmtree(path)
            return not path.exists()
        except OSError as exc:
            if not _is_locked_error(exc) or attempt == retries - 1:
                if attempt == retries - 1:
                    shutil.rmtree(path, ignore_errors=True)
                    return not path.exists()
                raise
            time.sleep(delay * (attempt + 1))
    return not path.exists()


def release_after_subprocess() -> None:
    """Brief pause so Windows releases handles after ffmpeg/subprocess exits."""
    if os.name == "nt":
        time.sleep(0.05)
