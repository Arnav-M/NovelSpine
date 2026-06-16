"""Regression tests for audiobook section cache and chapter sidecars."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from novelflow.audiobook import create_audiobook
from novelflow.audio_merge import ChapterMarker
from novelflow.project_output import (
    AudiobookBuildSpec,
    default_audiobook_path,
    work_dir_for_build,
)


def _spec(
    md: Path,
    text: str,
    *,
    engine: str = "edge",
    voice: str = "en-US-JennyNeural",
    enabled: tuple[str, ...] = ("novel", "chapter-one"),
) -> AudiobookBuildSpec:
    return AudiobookBuildSpec(
        markdown_path=md,
        markdown_text=text,
        engine=engine,
        voice=voice,
        enabled_section_ids=enabled,
    )


def _minimal_markdown() -> str:
    return "# Novel\n\n## Chapter One\n\nHello world."


class _RecordingEngine:
    def __init__(self, label: str) -> None:
        self.label = label
        self.calls: list[tuple[str, Path]] = []

    def synthesize_section(
        self,
        text: str,
        output_path: Path,
        *,
        voice: str,
        progress=None,
        on_progress=None,
    ) -> None:
        self.calls.append((voice, output_path))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(self.label.encode("utf-8") * 512)


@pytest.fixture
def markdown_source(tmp_path: Path) -> tuple[Path, str]:
    md = tmp_path / "Novel.readable.md"
    text = _minimal_markdown()
    md.write_text(text, encoding="utf-8")
    return md, text


def test_voice_change_does_not_reuse_cached_sections(markdown_source: tuple[Path, str]) -> None:
    md, text = markdown_source
    engine_a = _RecordingEngine("voice-a")
    engine_b = _RecordingEngine("voice-b")
    audio_out = default_audiobook_path(md, "m4b")

    with patch("novelflow.audiobook.get_engine", side_effect=[engine_a, engine_b]):
        with patch(
            "novelflow.audiobook.merge_audiobook",
            return_value=(
                audio_out,
                [ChapterMarker(id="chapter-one", title="Chapter One", start_ms=0, end_ms=1000)],
            ),
        ):
            create_audiobook(md, audio_out, voice="voice-a", audio_format="m4b")
            create_audiobook(md, audio_out, voice="voice-b", audio_format="m4b")

    assert engine_a.calls
    assert engine_b.calls
    work_a = work_dir_for_build(_spec(md, text, voice="voice-a"))
    work_b = work_dir_for_build(_spec(md, text, voice="voice-b"))
    assert work_a != work_b
    cached_a = next(work_a.glob("sections/*.mp3"))
    cached_b = next(work_b.glob("sections/*.mp3"))
    assert cached_a.read_bytes().startswith(b"voice-a")
    assert cached_b.read_bytes().startswith(b"voice-b")


def test_markdown_edit_with_same_section_ids_re_synthesizes(markdown_source: tuple[Path, str]) -> None:
    md, old_text = markdown_source
    engine_first = _RecordingEngine("first")
    engine_second = _RecordingEngine("second")
    audio_out = default_audiobook_path(md, "m4b")

    with patch("novelflow.audiobook.get_engine", return_value=engine_first):
        with patch(
            "novelflow.audiobook.merge_audiobook",
            return_value=(
                audio_out,
                [ChapterMarker(id="chapter-one", title="Chapter One", start_ms=0, end_ms=1000)],
            ),
        ):
            create_audiobook(md, audio_out, voice="voice-a", audio_format="m4b")

    new_text = old_text + "\n\nMore text."
    md.write_text(new_text, encoding="utf-8")

    with patch("novelflow.audiobook.get_engine", return_value=engine_second):
        with patch(
            "novelflow.audiobook.merge_audiobook",
            return_value=(
                audio_out.with_name("Novel.audiobook_1.m4b"),
                [ChapterMarker(id="chapter-one", title="Chapter One", start_ms=0, end_ms=1000)],
            ),
        ):
            create_audiobook(md, audio_out, voice="voice-a", audio_format="m4b")

    assert engine_first.calls
    assert engine_second.calls
    work_second = work_dir_for_build(_spec(md, new_text, voice="voice-a"))
    cached = next(work_second.glob("sections/*.mp3"))
    assert cached.read_bytes().startswith(b"second")


def test_chapters_sidecar_keeps_duplicate_titles(markdown_source: tuple[Path, str]) -> None:
    md, _text = markdown_source
    md.write_text(
        "# Novel\n\n## Introduction\n\nFirst intro.\n\n## Introduction\n\nSecond intro.\n",
        encoding="utf-8",
    )
    audio_out = default_audiobook_path(md, "m4b")
    markers = [
        ChapterMarker(id="introduction", title="Introduction", start_ms=0, end_ms=500),
        ChapterMarker(id="introduction-2", title="Introduction", start_ms=500, end_ms=1000),
    ]
    fake_engine = MagicMock()

    with patch("novelflow.audiobook.get_engine", return_value=fake_engine):
        fake_engine.synthesize_section.side_effect = lambda _text, output_path, **kwargs: output_path.write_bytes(
            b"x" * 2048
        )
        with patch("novelflow.audiobook.merge_audiobook", return_value=(audio_out, markers)):
            out, _manifest = create_audiobook(
                md,
                audio_out,
                voice="voice-a",
                audio_format="m4b",
                chapters_and_title_only=False,
            )

    sidecar = out.with_suffix(".chapters.json")
    data = json.loads(sidecar.read_text(encoding="utf-8"))
    assert len(data) == 2
    assert data[0]["title"] == "Introduction"
    assert data[1]["title"] == "Introduction"
    assert data[0]["id"] == "introduction"
    assert data[1]["id"] == "introduction-2"
    assert data[0]["file"] != data[1]["file"]


def test_resume_reuses_sections_within_same_build_spec(markdown_source: tuple[Path, str]) -> None:
    md, text = markdown_source
    work = work_dir_for_build(_spec(md, text, voice="voice-a"))
    sections = work / "sections"
    sections.mkdir(parents=True)
    (sections / "000_novel.mp3").write_bytes(b"cached-novel" * 128)
    (sections / "001_chapter-one.mp3").write_bytes(b"cached-chapter" * 128)

    engine = _RecordingEngine("should-not-run")
    audio_out = default_audiobook_path(md, "m4b")

    with patch("novelflow.audiobook.get_engine", return_value=engine):
        with patch(
            "novelflow.audiobook.merge_audiobook",
            return_value=(
                audio_out,
                [
                    ChapterMarker(id="novel", title="Novel", start_ms=0, end_ms=500),
                    ChapterMarker(id="chapter-one", title="Chapter One", start_ms=500, end_ms=1000),
                ],
            ),
        ):
            create_audiobook(md, audio_out, voice="voice-a", audio_format="m4b")

    assert engine.calls == []
