"""Persist and resolve reader line timings beside audiobook files."""

from __future__ import annotations

import json
import re
from pathlib import Path

READER_SIDECAR_VERSION = 2


def reader_sidecar_path(audiobook_path: Path) -> Path:
    return Path(audiobook_path).resolve().with_suffix(".reader.json")


def _normalize_word(word: str) -> str:
    return re.sub(r"[^a-z0-9']+", "", word.lower())


def line_starts_from_weights(
    lines: list[str],
    weights: list[int],
    total_ms: int,
) -> list[int]:
    if not lines:
        return []
    total_weight = sum(max(w, 1) for w in weights) or len(lines)
    duration = max(total_ms, 1)
    starts: list[int] = [0]
    cumulative = 0.0
    for weight in weights[:-1]:
        cumulative += max(weight, 1) / total_weight
        starts.append(int(round(cumulative * duration)))
    return starts


def _boundary_timeline_span(boundaries: list[dict[str, object]]) -> int:
    if not boundaries:
        return 0
    last = boundaries[-1]
    offset = int(last.get("offset_ms", 0))
    duration = int(last.get("duration_ms", 0))
    return offset + duration if duration > 0 else offset


def align_line_starts_to_duration(
    starts: list[int],
    boundaries: list[dict[str, object]],
    total_ms: int,
) -> list[int]:
    """Stretch line starts so spoken content spans the probed audio file length."""
    if not starts or total_ms <= 0:
        return starts
    span = _boundary_timeline_span(boundaries)
    if span <= 0:
        span = starts[-1]
    if span <= 0 or span >= total_ms * 0.98:
        return starts
    scale = total_ms / span
    return [int(round(start * scale)) for start in starts]


def _skip_duplicate_sentence_boundaries(
    boundaries: list[dict[str, object]],
    boundary_index: int,
    line_text: str,
) -> int:
    """Advance past consecutive spoken sentences that repeat the current line."""
    normalized = re.sub(r"[^a-z0-9]+", " ", line_text.lower()).strip()
    if not normalized:
        return boundary_index
    while boundary_index + 1 < len(boundaries):
        next_text = re.sub(
            r"[^a-z0-9]+",
            " ",
            str(boundaries[boundary_index + 1].get("text", "")).lower(),
        ).strip()
        if next_text != normalized:
            break
        boundary_index += 1
    return boundary_index


def line_starts_from_sentence_boundaries(
    lines: list[str],
    boundaries: list[dict[str, object]],
    total_ms: int,
) -> list[int]:
    """Map reader lines to start offsets using Edge TTS sentence boundary events."""
    if not lines:
        return []
    if not boundaries:
        weights = [max(len(line.split()), 1) for line in lines]
        return line_starts_from_weights(lines, weights, total_ms)

    boundary_index = 0
    starts: list[int] = []

    for line in lines:
        if boundary_index >= len(boundaries):
            starts.append(starts[-1] if starts else 0)
            continue
        starts.append(int(boundaries[boundary_index]["offset_ms"]))
        boundary_index = _skip_duplicate_sentence_boundaries(
            boundaries,
            boundary_index,
            line,
        )
        boundary_index += 1

    for index in range(1, len(starts)):
        if starts[index] < starts[index - 1]:
            starts[index] = starts[index - 1]

    return align_line_starts_to_duration(starts, boundaries, total_ms)


def line_starts_from_word_boundaries(
    lines: list[str],
    boundaries: list[dict[str, object]],
    total_ms: int,
) -> list[int]:
    """Map reader lines to start offsets using Edge TTS word boundary events."""
    if not lines:
        return []
    if not boundaries:
        weights = [max(len(line.split()), 1) for line in lines]
        return line_starts_from_weights(lines, weights, total_ms)

    boundary_index = 0
    starts: list[int] = []

    for line in lines:
        line_words = [_normalize_word(word) for word in line.split()]
        line_words = [word for word in line_words if word]
        if not line_words:
            starts.append(starts[-1] if starts else 0)
            continue

        while boundary_index < len(boundaries):
            boundary_word = _normalize_word(str(boundaries[boundary_index].get("text", "")))
            if boundary_word == line_words[0]:
                break
            boundary_index += 1

        if boundary_index >= len(boundaries):
            starts.append(starts[-1] if starts else 0)
            continue

        starts.append(int(boundaries[boundary_index]["offset_ms"]))
        for _ in line_words:
            if boundary_index < len(boundaries):
                boundary_index += 1

    for index in range(1, len(starts)):
        if starts[index] < starts[index - 1]:
            starts[index] = starts[index - 1]

    return align_line_starts_to_duration(starts, boundaries, total_ms)


def save_reader_sidecar(audiobook_path: Path, sections: dict[str, dict]) -> Path:
    sidecar = reader_sidecar_path(audiobook_path)
    payload = {
        "version": READER_SIDECAR_VERSION,
        "sections": sections,
    }
    sidecar.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return sidecar


def load_reader_sidecar(audiobook_path: Path) -> dict[str, dict] | None:
    sidecar = reader_sidecar_path(audiobook_path)
    if not sidecar.is_file():
        return None
    try:
        data = json.loads(sidecar.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    sections = data.get("sections")
    return sections if isinstance(sections, dict) else None


def reader_sidecar_version(audiobook_path: Path) -> int:
    sidecar = reader_sidecar_path(audiobook_path)
    if not sidecar.is_file():
        return 0
    try:
        data = json.loads(sidecar.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return 0
    version = data.get("version")
    return int(version) if isinstance(version, int) else 1


def load_reader_section(audiobook_path: Path, section_id: str | None) -> dict | None:
    if not section_id:
        return None
    sections = load_reader_sidecar(audiobook_path)
    if not sections:
        return None
    entry = sections.get(section_id)
    return entry if isinstance(entry, dict) else None
