"""File staging and media helpers for the local API."""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import HTTPException, UploadFile

_STAGING_DIR = Path(tempfile.gettempdir()) / "novelflow_staging"


def ensure_staging_dir() -> Path:
    _STAGING_DIR.mkdir(parents=True, exist_ok=True)
    return _STAGING_DIR


async def stage_upload(file: UploadFile) -> str:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Uploaded file has no name.")
    safe_name = Path(file.filename).name
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid file name.")
    dest = ensure_staging_dir() / safe_name
    # Avoid overwriting in-use files with a numeric suffix.
    if dest.exists():
        stem = dest.stem
        suffix = dest.suffix
        for i in range(1, 1000):
            candidate = dest.with_name(f"{stem}_{i}{suffix}")
            if not candidate.exists():
                dest = candidate
                break
    content = await file.read()
    dest.write_bytes(content)
    return str(dest.resolve())


def resolve_media_path(path: str) -> Path:
    resolved = Path(path).resolve()
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="File not found.")
    return resolved


def speed_variant_path(source: str, speed: float) -> str:
    from novelflow.player import cached_speed_variant, make_speed_variant

    src = Path(source).resolve()
    if not src.is_file():
        raise HTTPException(status_code=404, detail="Source audio not found.")
    if abs(speed - 1.0) < 0.01:
        return str(src)
    cached = cached_speed_variant(src, speed)
    if cached is not None:
        return str(cached.resolve())
    variant = make_speed_variant(src, speed)
    if variant is None:
        raise HTTPException(status_code=500, detail="Speed variant unavailable (ffmpeg required).")
    return str(variant.resolve())
