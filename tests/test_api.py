"""Basic tests for the NovelSpine local API."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from novelspine.api.app import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_list_voices() -> None:
    response = client.get("/voices?engine=edge")
    assert response.status_code == 200
    voices = response.json()
    assert isinstance(voices, list)
    assert len(voices) > 0
    first = voices[0]
    assert "id" in first
    assert "label" in first


def test_get_prefs() -> None:
    response = client.get("/prefs")
    assert response.status_code == 200
    body = response.json()
    assert "data" in body
    assert isinstance(body["data"], dict)
    assert "default_voice" in body["data"]


def test_put_prefs_roundtrip() -> None:
    response = client.put("/prefs", json={"data": {"volume": 77}})
    assert response.status_code == 200
    assert response.json()["data"]["volume"] == 77


def test_get_resume() -> None:
    response = client.get("/resume")
    assert response.status_code == 200
    assert isinstance(response.json(), dict)


def test_sections_missing_file() -> None:
    response = client.get("/sections", params={"path": "does-not-exist.md"})
    assert response.status_code == 404


def test_pick_folder_endpoint(monkeypatch) -> None:
    from novelspine.api import dialogs as dialogs_module

    monkeypatch.setattr(dialogs_module, "pick_folder_dialog", lambda: "C:\\Books")
    response = client.post("/pick-folder")
    assert response.status_code == 200
    assert response.json() == {"path": "C:\\Books"}


def test_sections_parses_markdown(tmp_path: Path) -> None:
    md = tmp_path / "book.md"
    md.write_text(
        "# Test Book\n\n## Chapter One\n\nHello world.\n",
        encoding="utf-8",
    )
    response = client.get("/sections", params={"path": str(md)})
    assert response.status_code == 200
    body = response.json()
    assert body["book_title"] == "Test Book"
    assert len(body["sections"]) >= 2
    titles = [s["title"] for s in body["sections"]]
    assert "Chapter One" in titles


def test_library_empty_for_missing_dir() -> None:
    response = client.get("/library", params={"root": "definitely-not-a-real-folder-xyz"})
    assert response.status_code == 200
    assert response.json() == []


def test_library_empty_without_root() -> None:
    response = client.get("/library", params={"root": ""})
    assert response.status_code == 200
    assert response.json() == []


def test_media_speed_missing_file() -> None:
    response = client.get("/media/speed", params={"path": "does-not-exist.mp3", "speed": 1.25})
    assert response.status_code == 404


def test_get_resume_always_object(monkeypatch) -> None:
    from novelspine.api import prefs as prefs_module

    monkeypatch.setattr(prefs_module, "load_resume", lambda: None)  # type: ignore[return-value]
    response = client.get("/resume")
    assert response.status_code == 200
    assert response.json() == {}


def test_resolve_audiobook_markdown_prefers_explicit_path(tmp_path: Path) -> None:
    from novelspine.api.jobs import _resolve_audiobook_markdown

    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    md = tmp_path / "book.readable.md"
    md.write_text("# Book\n\nHello.\n", encoding="utf-8")

    resolved = _resolve_audiobook_markdown(pdf, markdown_path=str(md), output_path=None)
    assert resolved == md.resolve()


def test_resolve_audiobook_markdown_sibling(tmp_path: Path) -> None:
    from novelspine.api.jobs import _resolve_audiobook_markdown

    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    md = tmp_path / "book.readable.md"
    md.write_text("# Book\n\nHello.\n", encoding="utf-8")

    resolved = _resolve_audiobook_markdown(pdf, markdown_path=None, output_path=None)
    assert resolved == md.resolve()
