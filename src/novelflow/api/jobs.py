"""Background job manager with SSE event streaming."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from queue import Empty, Queue
from typing import Any


class JobState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


@dataclass
class JobEvent:
    type: str
    data: dict[str, Any] = field(default_factory=dict)

    def to_sse(self) -> str:
        import json

        payload = {"type": self.type, **self.data}
        return f"data: {json.dumps(payload)}\n\n"


@dataclass
class Job:
    id: str
    kind: str
    state: JobState = JobState.PENDING
    progress: float = 0.0
    message: str = ""
    result: Any = None
    error: str | None = None
    _events: Queue[JobEvent] = field(default_factory=Queue, repr=False)
    _cancel: threading.Event = field(default_factory=threading.Event, repr=False)
    _thread: threading.Thread | None = field(default=None, repr=False)

    def emit(self, event_type: str, **data: Any) -> None:
        if event_type == "log":
            self.message = str(data.get("message", ""))
        elif event_type == "progress":
            self.progress = float(data.get("percent", self.progress))
        self._events.put(JobEvent(event_type, data))

    def cancel(self) -> None:
        self._cancel.set()


class JobManager:
    """Runs one long job at a time, matching legacy GUI behavior."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}
        self._active_id: str | None = None

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def status(self, job_id: str) -> dict[str, Any] | None:
        job = self.get(job_id)
        if job is None:
            return None
        return {
            "job_id": job.id,
            "kind": job.kind,
            "state": job.state.value,
            "progress": job.progress,
            "message": job.message,
            "result": job.result,
            "error": job.error,
        }

    def _set_state(self, job: Job, state: JobState) -> None:
        job.state = state
        job.emit("state", state=state.value)

    def _start(self, kind: str, worker: Callable[[Job], Any]) -> Job:
        with self._lock:
            if self._active_id is not None:
                active = self._jobs.get(self._active_id)
                if active and active.state in (JobState.PENDING, JobState.RUNNING):
                    raise RuntimeError("Another job is already running.")
            job_id = uuid.uuid4().hex
            job = Job(id=job_id, kind=kind)
            self._jobs[job_id] = job
            self._active_id = job_id

        def runner() -> None:
            self._set_state(job, JobState.RUNNING)
            try:
                result = worker(job)
            except Exception as exc:  # noqa: BLE001
                from novelflow.convert import ConversionCancelled

                if isinstance(exc, ConversionCancelled) or job._cancel.is_set():
                    job.error = "Cancelled"
                    self._set_state(job, JobState.CANCELLED)
                    job.emit("cancelled")
                else:
                    job.error = str(exc) or type(exc).__name__
                    self._set_state(job, JobState.ERROR)
                    job.emit("error", message=job.error)
            else:
                if job._cancel.is_set():
                    job.error = "Cancelled"
                    self._set_state(job, JobState.CANCELLED)
                    job.emit("cancelled")
                else:
                    job.result = result
                    self._set_state(job, JobState.DONE)
                    job.emit("done", result=_serialize_result(result))
            finally:
                with self._lock:
                    if self._active_id == job.id:
                        self._active_id = None
                job.emit("end")

        job._thread = threading.Thread(target=runner, daemon=True)
        job._thread.start()
        return job

    def start_convert(
        self,
        *,
        pdf_path: str,
        output_path: str | None,
        keep_raw: bool,
        use_project_folder: bool = False,
    ) -> Job:
        def worker(job: Job) -> Path:
            from novelflow.convert import convert_pdf
            from novelflow.project_output import readable_markdown_in_project

            pdf = Path(pdf_path).resolve()
            out = output_path
            if use_project_folder and not out:
                out = str(readable_markdown_in_project(pdf))

            return convert_pdf(
                pdf_path,
                out,
                keep_raw=keep_raw,
                progress=lambda msg: job.emit("log", message=msg),
                on_progress=lambda pct: job.emit("progress", percent=pct),
                cancel_check=job._cancel.is_set,
            )

        return self._start("convert", worker)

    def start_audiobook(
        self,
        *,
        source_path: str,
        markdown_path: str | None,
        output_path: str | None,
        use_existing_md: bool,
        engine: str,
        voice: str | None,
        audio_format: str,
        disabled_section_ids: set[str],
        chapters_and_title_only: bool,
        use_project_folder: bool = False,
        audiobook_only: bool = False,
    ) -> Job:
        def worker(job: Job) -> Any:
            from novelflow.audiobook import create_audiobook
            from novelflow.convert import convert_pdf
            from novelflow.project_output import (
                AudiobookUnchangedError,
                audiobook_in_project,
                cleanup_intermediate_files,
                newest_audiobook_for_markdown,
                readable_markdown_in_project,
            )

            def unchanged_result(exc: AudiobookUnchangedError, md: Path) -> dict[str, Any]:
                job.emit("log", message=str(exc))
                payload: dict[str, Any] = {
                    "audiobook_path": str(exc.existing_path),
                    "unchanged": True,
                    "message": str(exc),
                }
                if not audiobook_only:
                    payload["markdown_path"] = str(md)
                return payload

            source = Path(source_path).resolve()
            disabled = disabled_section_ids or None
            keep_sections = not audiobook_only

            if use_existing_md or source.suffix.lower() == ".md":
                md_path = _resolve_audiobook_markdown(
                    source,
                    markdown_path=markdown_path,
                    output_path=output_path,
                )
                audio_out: Path | None
                if output_path:
                    audio_out = Path(output_path).resolve()
                elif use_project_folder:
                    audio_out = audiobook_in_project(md_path, audio_format)
                else:
                    audio_out = None
                job.emit("log", message=f"Using markdown: {md_path.name}")
                try:
                    out, manifest = create_audiobook(
                        md_path,
                        audio_out,
                        engine=engine,
                        voice=voice,
                        audio_format=audio_format,
                        disabled_section_ids=disabled,
                        chapters_and_title_only=chapters_and_title_only,
                        keep_sections=keep_sections,
                        progress=lambda msg: job.emit("log", message=msg),
                        on_progress=lambda pct: job.emit("progress", percent=pct),
                        cancel_check=job._cancel.is_set,
                    )
                except AudiobookUnchangedError as exc:
                    return unchanged_result(exc, md_path)
                if audiobook_only:
                    cleanup_intermediate_files(
                        out,
                        md_path,
                        remove_markdown=True,
                        progress=lambda msg: job.emit("log", message=msg),
                    )
                return {
                    "markdown_path": "" if audiobook_only else str(md_path),
                    "audiobook_path": str(out),
                    "manifest": manifest.to_dict(),
                }

            md_path = (
                readable_markdown_in_project(source)
                if use_project_folder and not output_path
                else (source.with_suffix(".readable.md") if output_path is None else Path(output_path))
            )
            try:
                convert_pdf(
                    source,
                    str(md_path),
                    audiobook=True,
                    tts_engine=engine,
                    tts_voice=voice,
                    audio_format=audio_format,
                    disabled_section_ids=disabled,
                    chapters_and_title_only=chapters_and_title_only,
                    keep_sections=keep_sections,
                    progress=lambda msg: job.emit("log", message=msg),
                    on_progress=lambda pct: job.emit("progress", percent=pct),
                    cancel_check=job._cancel.is_set,
                )
            except AudiobookUnchangedError as exc:
                return unchanged_result(exc, md_path)
            if use_project_folder:
                audio_out = newest_audiobook_for_markdown(md_path, audio_format)
                if audio_out is None:
                    audio_out = audiobook_in_project(md_path, audio_format)
            else:
                audio_out = newest_audiobook_for_markdown(md_path, audio_format)
                if audio_out is None:
                    audio_out = md_path.with_name(
                        f"{md_path.stem.replace('.readable', '')}.audiobook.{audio_format}",
                    )
                    if not audio_out.is_file():
                        audio_out = md_path.with_suffix(f".audiobook.{audio_format}")
            if audiobook_only:
                cleanup_intermediate_files(
                    audio_out,
                    md_path,
                    remove_markdown=True,
                    progress=lambda msg: job.emit("log", message=msg),
                )
            return {
                "markdown_path": "" if audiobook_only else str(md_path.resolve()),
                "audiobook_path": str(audio_out.resolve()),
            }

        return self._start("audiobook", worker)

    def cancel(self, job_id: str) -> bool:
        job = self.get(job_id)
        if job is None:
            return False
        job.cancel()
        return True

    def iter_events(self, job_id: str, *, timeout: float = 30.0):
        job = self.get(job_id)
        if job is None:
            return
        while True:
            try:
                event = job._events.get(timeout=timeout)
            except Empty:
                yield JobEvent("ping", {})
                if job.state in (JobState.DONE, JobState.ERROR, JobState.CANCELLED):
                    break
                continue
            yield event
            if event.type == "end":
                break


def _resolve_audiobook_markdown(
    source: Path,
    *,
    markdown_path: str | None,
    output_path: str | None,
) -> Path:
    """Locate readable markdown when synthesizing from an existing conversion."""
    if markdown_path:
        md = Path(markdown_path).resolve()
        if md.is_file():
            return md
        raise FileNotFoundError(f"Markdown not found: {md}")

    if source.suffix.lower() == ".md":
        if not source.is_file():
            raise FileNotFoundError(f"Markdown not found: {source}")
        return source

    if output_path:
        md = Path(output_path).resolve()
        if md.is_file():
            return md

    sibling = source.with_suffix(".readable.md")
    if sibling.is_file():
        return sibling.resolve()

    raise FileNotFoundError(
        f"No readable markdown found for {source.name}. "
        "Convert the document on the Document tab first."
    )


def _serialize_result(result: Any) -> Any:
    if isinstance(result, Path):
        return str(result)
    if isinstance(result, dict):
        return result
    if hasattr(result, "to_dict"):
        return result.to_dict()
    return result
