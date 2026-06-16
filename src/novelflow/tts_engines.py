"""Text-to-speech synthesis backend (Edge online neural TTS)."""

from __future__ import annotations

import asyncio
import shutil
import subprocess
import tempfile
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from novelflow.ffmpeg_path import find_ffmpeg
from novelflow.path_utils import release_after_subprocess, safe_unlink
from novelflow.audio_merge import _probe_duration_ms
from novelflow.tts_config import EDGE_CHUNK_PARALLEL
from novelflow.tts_text import split_for_tts


@dataclass
class SynthesisResult:
    path: Path
    word_boundaries: list[dict[str, object]] = field(default_factory=list)


class TTSEngine(ABC):
    name: str

    @abstractmethod
    def synthesize_section(
        self,
        text: str,
        output_path: Path,
        *,
        voice: str,
        progress: Callable[[str], None] | None = None,
        on_progress: Callable[[float], None] | None = None,
    ) -> Path:
        """Synthesize ``text`` to ``output_path``.

        ``on_progress`` (when given) receives the fraction (0.0–1.0) of this
        section that has been rendered, allowing callers to drive a real
        completion bar instead of a stage estimate.
        """
        ...

    def synthesize_section_detailed(
        self,
        text: str,
        output_path: Path,
        *,
        voice: str,
        progress: Callable[[str], None] | None = None,
        on_progress: Callable[[float], None] | None = None,
    ) -> SynthesisResult:
        path = self.synthesize_section(
            text,
            output_path,
            voice=voice,
            progress=progress,
            on_progress=on_progress,
        )
        return SynthesisResult(path=path)


def _merge_audio_files(chunks: list[Path], output_path: Path) -> Path:
    if not chunks:
        raise ValueError("No audio chunks to merge")
    if len(chunks) == 1:
        shutil.copy2(chunks[0], output_path)
        return output_path

    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise RuntimeError(
            "ffmpeg is required to merge audio chunks. "
            "Reinstall Novelflow or install ffmpeg and add it to your PATH."
        )

    with tempfile.TemporaryDirectory() as tmp:
        list_file = Path(tmp) / "concat.txt"
        list_file.write_text(
            "\n".join(f"file '{chunk.resolve().as_posix()}'" for chunk in chunks),
            encoding="utf-8",
        )
        subprocess.run(
            [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
             "-c", "copy", str(output_path)],
            check=True,
            capture_output=True,
        )
        release_after_subprocess()
    return output_path


class EdgeTTSEngine(TTSEngine):
    name = "edge"

    def synthesize_section(
        self,
        text: str,
        output_path: Path,
        *,
        voice: str,
        progress: Callable[[str], None] | None = None,
        on_progress: Callable[[float], None] | None = None,
    ) -> Path:
        return self.synthesize_section_detailed(
            text,
            output_path,
            voice=voice,
            progress=progress,
            on_progress=on_progress,
        ).path

    def synthesize_section_detailed(
        self,
        text: str,
        output_path: Path,
        *,
        voice: str,
        progress: Callable[[str], None] | None = None,
        on_progress: Callable[[float], None] | None = None,
    ) -> SynthesisResult:
        try:
            import edge_tts
        except ImportError as exc:
            raise RuntimeError(
                "edge-tts is not installed. Run: pip install novelflow[audiobook]"
            ) from exc

        chunks = split_for_tts(text)
        if not chunks:
            raise ValueError("No text to synthesize")

        total = len(chunks)
        done = 0
        all_boundaries: list[dict[str, object]] = []
        chunk_offset_ms = 0

        with tempfile.TemporaryDirectory(prefix="novelflow_tts_") as tmp:
            tmp_dir = Path(tmp)

            async def _synthesize_chunk(
                sem: asyncio.Semaphore,
                idx: int,
                chunk: str,
            ) -> tuple[Path, list[dict[str, object]], int]:
                nonlocal done
                async with sem:
                    part = tmp_dir / f"part{idx:04d}.mp3"
                    communicate = edge_tts.Communicate(
                        chunk,
                        voice=voice,
                        boundary="SentenceBoundary",
                    )
                    boundaries: list[dict[str, object]] = []
                    with part.open("wb") as audio_file:
                        async for item in communicate.stream():
                            if item["type"] == "audio":
                                audio_file.write(item["data"])
                            elif item["type"] == "SentenceBoundary":
                                boundaries.append(
                                    {
                                        "offset_ms": int(item["offset"] / 10_000),
                                        "duration_ms": int(item["duration"] / 10_000),
                                        "text": item["text"],
                                    }
                                )
                    duration_ms = _probe_duration_ms(part)
                done += 1
                if on_progress:
                    on_progress(0.95 * done / total)
                return part, boundaries, duration_ms

            async def _run() -> list[tuple[Path, list[dict[str, object]], int]]:
                sem = asyncio.Semaphore(EDGE_CHUNK_PARALLEL)
                tasks = [_synthesize_chunk(sem, idx, chunk) for idx, chunk in enumerate(chunks)]
                if progress:
                    progress(f"  Edge TTS: {total} chunk(s), {EDGE_CHUNK_PARALLEL} parallel")
                return list(await asyncio.gather(*tasks))

            chunk_results = asyncio.run(_run())
            part_paths: list[Path] = []
            for part, boundaries, duration_ms in chunk_results:
                for boundary in boundaries:
                    all_boundaries.append(
                        {
                            "offset_ms": int(boundary["offset_ms"]) + chunk_offset_ms,
                            "duration_ms": int(boundary.get("duration_ms", 0)),
                            "text": boundary["text"],
                        }
                    )
                chunk_offset_ms += duration_ms
                part_paths.append(part)

            _merge_audio_files(part_paths, output_path)
            release_after_subprocess()
            for part in part_paths:
                safe_unlink(part)
        if on_progress:
            on_progress(1.0)
        return SynthesisResult(path=output_path, word_boundaries=all_boundaries)


def get_engine(name: str) -> TTSEngine:
    return EdgeTTSEngine()
