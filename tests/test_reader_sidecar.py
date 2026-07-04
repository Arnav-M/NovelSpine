"""Tests for reader sidecar timing helpers."""

from novelspine.reader_sidecar import (
    align_line_starts_to_duration,
    line_starts_from_sentence_boundaries,
    line_starts_from_weights,
    line_starts_from_word_boundaries,
)


def test_line_starts_from_weights():
    lines = ["One two.", "Three four five."]
    weights = [2, 3]
    starts = line_starts_from_weights(lines, weights, 5000)
    assert starts == [0, 2000]


def test_line_starts_from_word_boundaries():
    lines = ["Hello world.", "Goodbye moon."]
    boundaries = [
        {"offset_ms": 0, "duration_ms": 400, "text": "Hello"},
        {"offset_ms": 400, "duration_ms": 400, "text": "world"},
        {"offset_ms": 1200, "duration_ms": 400, "text": "Goodbye"},
        {"offset_ms": 1800, "duration_ms": 400, "text": "moon"},
    ]
    starts = line_starts_from_word_boundaries(lines, boundaries, 2500)
    assert starts == [0, 1364]


def test_line_starts_from_sentence_boundaries():
    lines = [
        "Chapter One.",
        "It was a dark and stormy night.",
        "The wind howled loudly.",
    ]
    boundaries = [
        {"offset_ms": 100, "duration_ms": 1737, "text": "Chapter One."},
        {"offset_ms": 1787, "duration_ms": 2587, "text": "It was a dark and stormy night."},
        {"offset_ms": 4375, "duration_ms": 2250, "text": "The wind howled loudly."},
    ]
    starts = line_starts_from_sentence_boundaries(lines, boundaries, 6696)
    assert starts == [100, 1787, 4375]


def test_line_starts_skip_duplicate_sentences():
    lines = ["Chapter One.", "The story begins here."]
    boundaries = [
        {"offset_ms": 0, "duration_ms": 1200, "text": "Chapter One."},
        {"offset_ms": 1200, "duration_ms": 1200, "text": "Chapter One."},
        {"offset_ms": 2500, "duration_ms": 1800, "text": "The story begins here."},
    ]
    starts = line_starts_from_sentence_boundaries(lines, boundaries, 4300)
    assert starts == [0, 2500]


def test_align_line_starts_to_duration():
    starts = [0, 1000, 2000]
    boundaries = [
        {"offset_ms": 0, "duration_ms": 500, "text": "A."},
        {"offset_ms": 1000, "duration_ms": 500, "text": "B."},
        {"offset_ms": 2000, "duration_ms": 500, "text": "C."},
    ]
    scaled = align_line_starts_to_duration(starts, boundaries, 3000)
    assert scaled == [0, 1200, 2400]
