"""Tests for GUI preference defaults and migration."""

from __future__ import annotations

from novelflow.api import prefs as prefs_mod


def test_load_prefs_migrates_audiobook_library_dir_to_project_folder(
    monkeypatch, tmp_path
) -> None:
    prefs_file = tmp_path / "gui_prefs.json"
    prefs_file.write_text(
        '{"audiobook_library_dir": "C:/Books/Mozart", "project_folder": ""}',
        encoding="utf-8",
    )
    monkeypatch.setattr(prefs_mod, "prefs_path", lambda: prefs_file)

    loaded = prefs_mod.load_prefs()

    assert loaded["project_folder"] == "C:/Books/Mozart"
    assert loaded["audiobook_library_dir"] == "C:/Books/Mozart"
