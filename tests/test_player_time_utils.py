"""Sanity checks for book progress math used by the React player (mirrored in timeUtils.ts)."""

from __future__ import annotations


def _is_merged(chapters: list[dict]) -> bool:
    return bool(chapters) and all(not ch.get("file") for ch in chapters)


def _total_book_duration_ms(chapters: list[dict]) -> int:
    if not chapters:
        return 0
    if _is_merged(chapters):
        last = chapters[-1]
        return int(last.get("start_ms", 0)) + int(last.get("duration_ms", 0))
    return sum(int(ch.get("duration_ms", 0)) for ch in chapters)


def _seek_book_ms(chapters: list[dict], book_ms: int) -> tuple[int, int]:
    clamped = max(0, int(book_ms))
    if _is_merged(chapters):
        for i, ch in enumerate(chapters):
            start = int(ch.get("start_ms", 0))
            end = start + int(ch.get("duration_ms", 0))
            is_last = i == len(chapters) - 1
            dur = int(ch.get("duration_ms", 0))
            if clamped >= start and (clamped < end or is_last):
                raw = max(0, clamped - start)
                offset = min(raw, dur) if is_last and dur > 0 else raw
                return i, offset
        return len(chapters) - 1, 0

    acc = 0
    for i, ch in enumerate(chapters):
        dur = int(ch.get("duration_ms", 0))
        if clamped <= acc + dur or i == len(chapters) - 1:
            raw = max(0, clamped - acc)
            is_last = i == len(chapters) - 1
            offset = min(raw, dur) if is_last and dur > 0 else raw
            return i, offset
        acc += dur
    return 0, 0


def _book_position_ms(chapters: list[dict], index: int, offset_ms: int) -> int:
    if _is_merged(chapters):
        return int(chapters[index].get("start_ms", 0)) + offset_ms
    pos = sum(int(chapters[i].get("duration_ms", 0)) for i in range(index))
    return pos + offset_ms


def test_multi_file_book_seek_and_position() -> None:
    chapters = [
        {"title": "A", "duration_ms": 1000, "file": "a.mp3", "start_ms": 0},
        {"title": "B", "duration_ms": 2000, "file": "b.mp3", "start_ms": 1000},
        {"title": "C", "duration_ms": 1500, "file": "c.mp3", "start_ms": 3000},
    ]
    assert _total_book_duration_ms(chapters) == 4500
    idx, offset = _seek_book_ms(chapters, 2500)
    assert idx == 1
    assert offset == 1500
    assert _book_position_ms(chapters, 1, 1500) == 2500


def test_merged_m4b_book_seek_and_position() -> None:
    chapters = [
        {"title": "A", "duration_ms": 1000, "file": None, "start_ms": 0},
        {"title": "B", "duration_ms": 2000, "file": None, "start_ms": 1000},
        {"title": "C", "duration_ms": 1500, "file": None, "start_ms": 3000},
    ]
    assert _total_book_duration_ms(chapters) == 4500
    idx, offset = _seek_book_ms(chapters, 2500)
    assert idx == 1
    assert offset == 1500
    assert _book_position_ms(chapters, 1, 1500) == 2500
