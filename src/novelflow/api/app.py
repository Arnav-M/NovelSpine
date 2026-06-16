"""FastAPI local API for the Novelflow desktop UI."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from novelflow.api import dialogs as dialogs_module
from novelflow.api import files as files_module
from novelflow.api import jobs as job_module
from novelflow.api import library as library_module
from novelflow.api import prefs as prefs_module
from novelflow.api.schemas import (
    AudiobookJobRequest,
    ChapterTextResponse,
    ConvertJobRequest,
    JobCreatedResponse,
    JobStatusResponse,
    PrefsResponse,
    PrefsUpdateRequest,
    SectionsResponse,
    VoiceResponse,
)
from novelflow.book_structure import (
    chapter_number_in_audiobook,
    parse_book_sections,
    reader_lines_for_section,
    section_for_audio_chapter,
)
from novelflow.reader_sidecar import (
    READER_SIDECAR_VERSION,
    load_reader_section,
    reader_sidecar_version,
)
from novelflow.tts_voices import voices_for_engine

app = FastAPI(title="Novelflow API", version="0.3.0")
jobs = job_module.JobManager()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|\[::1\]|tauri\.localhost)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/pick-folder")
async def pick_folder() -> dict:
    """Open a native folder picker (used when the UI runs in a browser, not Tauri)."""
    folder = await asyncio.get_event_loop().run_in_executor(None, dialogs_module.pick_folder_dialog)
    return {"path": folder}


@app.get("/voices", response_model=list[VoiceResponse])
def list_voices(engine: str = Query(default="edge")) -> list[VoiceResponse]:
    return [
        VoiceResponse(id=v.id, label=v.label, engine=v.engine, locale=v.locale)
        for v in voices_for_engine(engine)
    ]


@app.get("/sections", response_model=SectionsResponse)
def book_sections(path: str = Query(..., description="Path to readable markdown")) -> SectionsResponse:
    md = Path(path).resolve()
    if not md.is_file():
        raise HTTPException(status_code=404, detail="Markdown file not found.")
    manifest = parse_book_sections(md.read_text(encoding="utf-8"))
    return SectionsResponse(
        book_title=manifest.book_title,
        author=manifest.author,
        source_markdown=str(md),
        sections=[
            {
                "id": s.id,
                "title": s.title,
                "kind": s.kind.value,
                "enabled": s.enabled,
                "order": s.order,
                "word_count": len(s.text.split()),
            }
            for s in manifest.sections
        ],
    )


@app.get("/reader/chapter-text", response_model=ChapterTextResponse)
def reader_chapter_text(
    markdown_path: str = Query(...),
    chapter_index: int = Query(..., ge=0),
    chapter_title: str | None = Query(default=None),
    chapter_id: str | None = Query(default=None),
    audio_path: str | None = Query(default=None),
) -> ChapterTextResponse:
    md = Path(markdown_path).resolve()
    if not md.is_file():
        raise HTTPException(status_code=404, detail="Markdown file not found.")
    manifest = parse_book_sections(md.read_text(encoding="utf-8"))

    resolved_id = chapter_id
    resolved_title = chapter_title
    if audio_path:
        from novelflow.player import load_chapters

        audio = Path(audio_path).resolve()
        if audio.is_file():
            audio_chapters = load_chapters(audio, probe_durations=False)
            if 0 <= chapter_index < len(audio_chapters):
                sidecar_ch = audio_chapters[chapter_index]
                resolved_id = resolved_id or (sidecar_ch.id or None)
                resolved_title = resolved_title or sidecar_ch.title

    section = section_for_audio_chapter(
        manifest,
        chapter_index,
        chapter_id=resolved_id,
        chapter_title=resolved_title,
    )
    if section is None:
        raise HTTPException(status_code=404, detail="Chapter text not found.")

    if audio_path and resolved_id:
        audio = Path(audio_path)
        stored = load_reader_section(audio, resolved_id)
        sidecar_ok = reader_sidecar_version(audio) >= READER_SIDECAR_VERSION
        if stored and isinstance(stored.get("lines"), list):
            lines = [str(line) for line in stored["lines"]]
            weights_raw = stored.get("line_weights")
            starts_raw = stored.get("line_start_ms")
            line_weights = (
                [int(w) for w in weights_raw]
                if isinstance(weights_raw, list) and len(weights_raw) == len(lines)
                else [max(len(line.split()), 1) for line in lines]
            )
            line_start_ms = (
                [int(ms) for ms in starts_raw]
                if sidecar_ok
                and isinstance(starts_raw, list)
                and len(starts_raw) == len(lines)
                else []
            )
            stored_duration = stored.get("duration_ms")
            section_duration_ms = (
                int(stored_duration)
                if isinstance(stored_duration, (int, float)) and int(stored_duration) > 0
                else 0
            )
            return ChapterTextResponse(
                title=section.title,
                lines=lines,
                line_weights=line_weights,
                line_start_ms=line_start_ms,
                section_duration_ms=section_duration_ms,
            )

    chapter_number = chapter_number_in_audiobook(manifest, section)
    lines, line_weights = reader_lines_for_section(section, chapter_number)
    return ChapterTextResponse(
        title=section.title,
        lines=lines,
        line_weights=line_weights,
    )


@app.get("/library")
def library(root: str = Query(default="")) -> list[dict]:
    if not root.strip():
        return []
    return library_module.scan_library(root)


@app.get("/media")
def media(path: str = Query(...)) -> FileResponse:
    resolved = files_module.resolve_media_path(path)
    return FileResponse(resolved)


@app.get("/media/speed")
def media_speed(path: str = Query(...), speed: float = Query(default=1.0)) -> dict:
    variant = files_module.speed_variant_path(path, speed)
    return {"path": variant}


@app.post("/files/stage")
async def stage_file(file: UploadFile = File(...)) -> dict:
    staged = await files_module.stage_upload(file)
    return {"path": staged}


@app.get("/chapters")
def chapters(path: str = Query(...), probe: bool = Query(default=True)) -> dict:
    audio = Path(path).resolve()
    if not audio.is_file():
        if audio.name.endswith(".chapters.json"):
            raise HTTPException(status_code=404, detail="Audiobook not found.")
        sidecar = audio.with_suffix(".chapters.json")
        if sidecar.is_file():
            audio = sidecar
        else:
            raise HTTPException(status_code=404, detail="Audiobook not found.")
    return library_module.chapters_for_audio(str(audio), probe_durations=probe)


@app.get("/cover")
def cover(
    path: str = Query(...),
    markdown_path: str | None = Query(default=None),
) -> dict:
    found = library_module.cover_for_path(path, markdown_path=markdown_path)
    return {"cover_path": found}


@app.get("/prefs", response_model=PrefsResponse)
def get_prefs() -> PrefsResponse:
    return PrefsResponse(data=prefs_module.load_prefs())


@app.put("/prefs", response_model=PrefsResponse)
def put_prefs(body: PrefsUpdateRequest) -> PrefsResponse:
    return PrefsResponse(data=prefs_module.save_prefs(body.data))


@app.get("/resume")
def get_resume() -> dict:
    data = prefs_module.load_resume()
    return data if isinstance(data, dict) else {}


@app.put("/resume")
def put_resume(body: dict) -> dict:
    return prefs_module.save_resume(body)


@app.post("/jobs/convert", response_model=JobCreatedResponse)
def start_convert(body: ConvertJobRequest) -> JobCreatedResponse:
    pdf = Path(body.pdf_path).resolve()
    if not pdf.is_file():
        raise HTTPException(status_code=400, detail="PDF not found.")
    try:
        job = jobs.start_convert(
            pdf_path=str(pdf),
            output_path=body.output_path,
            keep_raw=body.keep_raw,
            use_project_folder=body.use_project_folder,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return JobCreatedResponse(job_id=job.id)


@app.post("/jobs/audiobook", response_model=JobCreatedResponse)
def start_audiobook(body: AudiobookJobRequest) -> JobCreatedResponse:
    source = Path(body.source_path).resolve()
    if not source.is_file():
        raise HTTPException(status_code=400, detail="Source file not found.")
    try:
        job = jobs.start_audiobook(
            source_path=str(source),
            markdown_path=body.markdown_path,
            output_path=body.output_path,
            use_existing_md=body.use_existing_md,
            engine=body.engine,
            voice=body.voice,
            audio_format=body.audio_format,
            disabled_section_ids=set(body.disabled_section_ids),
            chapters_and_title_only=body.chapters_and_title_only,
            use_project_folder=body.use_project_folder,
            audiobook_only=body.audiobook_only,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return JobCreatedResponse(job_id=job.id)


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def job_status(job_id: str) -> JobStatusResponse:
    status = jobs.status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return JobStatusResponse(
        job_id=status["job_id"],
        kind=status["kind"],
        state=status["state"],
        progress=status["progress"],
        message=status["message"],
    )


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    if not jobs.cancel(job_id):
        raise HTTPException(status_code=404, detail="Job not found.")
    return {"cancelled": True}


@app.get("/jobs/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
    if jobs.get(job_id) is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    async def stream():
        loop = asyncio.get_event_loop()
        while True:
            event = await loop.run_in_executor(None, _next_event, job_id)
            if event is None:
                break
            yield event.to_sse()
            if event.type == "end":
                break

    return StreamingResponse(stream(), media_type="text/event-stream")


def _next_event(job_id: str) -> job_module.JobEvent | None:
    for event in jobs.iter_events(job_id, timeout=25.0):
        if event.type != "ping":
            return event
    job = jobs.get(job_id)
    if job and job.state.value in ("done", "error", "cancelled"):
        return job_module.JobEvent("end", {})
    return job_module.JobEvent("ping", {})


@app.post("/preview-voice")
def preview_voice(voice: str = Query(...), engine: str = Query(default="edge")) -> dict:
    from novelflow.tts_engines import get_engine

    text = "This is a preview of how your audiobook will sound with the selected voice."
    out = Path(tempfile.gettempdir()) / f"novelflow_preview_{voice}.mp3"
    eng = get_engine(engine)
    eng.synthesize_section(text, out, voice=voice)
    return {"preview_path": str(out)}
