"""Request/response models for the Novelflow local API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ConvertJobRequest(BaseModel):
    pdf_path: str
    output_path: str | None = None
    keep_raw: bool = False


class AudiobookJobRequest(BaseModel):
    source_path: str
    markdown_path: str | None = None
    output_path: str | None = None
    use_existing_md: bool = False
    engine: str = "edge"
    voice: str | None = None
    audio_format: Literal["m4b", "mp3", "m4a"] = "m4b"
    disabled_section_ids: list[str] = Field(default_factory=list)
    chapters_and_title_only: bool = True


class JobCreatedResponse(BaseModel):
    job_id: str


class JobStatusResponse(BaseModel):
    job_id: str
    kind: str
    state: Literal["pending", "running", "done", "error", "cancelled"]
    progress: float = 0.0
    message: str = ""


class VoiceResponse(BaseModel):
    id: str
    label: str
    engine: str
    locale: str


class SectionResponse(BaseModel):
    id: str
    title: str
    kind: str
    enabled: bool
    order: int
    word_count: int


class SectionsResponse(BaseModel):
    book_title: str
    author: str | None
    source_markdown: str
    sections: list[SectionResponse]


class LibraryItemResponse(BaseModel):
    label: str
    audio_path: str
    markdown_path: str | None = None
    cover_path: str | None = None


class ChapterResponse(BaseModel):
    title: str
    duration_ms: int
    file: str | None
    start_ms: int = 0


class ChaptersResponse(BaseModel):
    audio_path: str
    chapters: list[ChapterResponse]
    playable_path: str | None = None


class PrefsResponse(BaseModel):
    data: dict


class PrefsUpdateRequest(BaseModel):
    data: dict
