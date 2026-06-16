"""Read/write GUI preferences (same format as the legacy Tkinter app)."""

from __future__ import annotations

import json
from pathlib import Path

from novelflow.user_paths import user_data_dir

_DEFAULT_PREFS: dict = {
    "theme": "dark",
    "volume": 85,
    "speed": 1.0,
    "remember_speed": True,
    "default_voice": "en-US-AriaNeural",
    "default_engine": "edge",
    "default_audio_format": "m4b",
    "audiobook_library_dir": "",
    "project_folder": "",
    "use_project_folder": True,
    "audiobook_only_cleanup": False,
    "mini_player_collapsed": False,
    "audiobook_covers": {},
}


def prefs_path() -> Path:
    return user_data_dir() / "gui_prefs.json"


def load_prefs() -> dict:
    path = prefs_path()
    if not path.is_file():
        return dict(_DEFAULT_PREFS)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return dict(_DEFAULT_PREFS)
    merged = dict(_DEFAULT_PREFS)
    merged.update(data)
    if not str(merged.get("project_folder", "")).strip():
        legacy = str(merged.get("audiobook_library_dir", "")).strip()
        if legacy:
            merged["project_folder"] = legacy
    return merged


def save_prefs(data: dict) -> dict:
    current = load_prefs()
    current.update(data)
    path = prefs_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(current, indent=2), encoding="utf-8")
    return current


def resume_path() -> Path:
    return user_data_dir() / "player_resume.json"


def load_resume() -> dict:
    path = resume_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def save_resume(data: dict) -> dict:
    if not isinstance(data, dict):
        data = {}
    path = resume_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data
