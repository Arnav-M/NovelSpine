"""Tests for audiobook section parsing."""

from pathlib import Path

from novelflow.book_structure import SectionKind, find_cover_image_path, parse_book_sections


SAMPLE = """\
# The Example Novel

*JANE AUTHOR*

## Dedication

For my family.

## Chapter One

It was a dark and stormy night. The wind howled.

## Chapter Two

Morning came softly over the hills.

## Acknowledgements

Thanks to everyone who helped.
"""


def test_parse_sections_order():
    manifest = parse_book_sections(SAMPLE)
    titles = [s.title for s in manifest.sections]
    assert titles[0] == "The Example Novel"
    assert "Dedication" in titles
    assert "Chapter One" in titles
    assert "Acknowledgements" in titles
    assert titles.index("Dedication") < titles.index("Chapter One")
    assert titles.index("Chapter Two") < titles.index("Acknowledgements")


def test_section_kinds():
    manifest = parse_book_sections(SAMPLE)
    by_title = {s.title: s for s in manifest.sections}
    assert by_title["The Example Novel"].kind == SectionKind.TITLE
    assert by_title["Dedication"].kind == SectionKind.FRONT_MATTER
    assert by_title["Chapter One"].kind == SectionKind.CHAPTER
    assert by_title["Acknowledgements"].kind == SectionKind.BACK_MATTER


def test_strip_markdown_for_tts():
    manifest = parse_book_sections(SAMPLE)
    ch1 = next(s for s in manifest.sections if s.title == "Chapter One")
    assert "##" not in ch1.text
    assert "dark and stormy" in ch1.text


def test_reader_lines_include_chapter_announcement():
    from novelflow.book_structure import reader_lines_for_section

    manifest = parse_book_sections(SAMPLE)
    ch1 = next(s for s in manifest.sections if s.title == "Chapter One")
    lines, weights = reader_lines_for_section(ch1, 1)
    assert lines[0] == "Chapter One"
    assert "dark and stormy" in lines[1]
    assert len(weights) == len(lines)
    assert weights[0] >= 1
    assert sum(weights) > weights[0]


def test_section_lookup_by_chapter_id():
    from novelflow.book_structure import section_for_audio_chapter

    manifest = parse_book_sections(SAMPLE)
    ch1 = next(s for s in manifest.sections if s.title == "Chapter One")
    found = section_for_audio_chapter(manifest, 99, chapter_id=ch1.id)
    assert found is not None
    assert found.title == "Chapter One"


def test_section_for_chapter_index_matches_audiobook_order():
    from novelflow.book_structure import (
        apply_default_audiobook_filter,
        section_for_chapter_index,
    )

    manifest = parse_book_sections(SAMPLE)
    filtered = apply_default_audiobook_filter(manifest).enabled_sections()
    assert [s.title for s in filtered] == ["The Example Novel", "Chapter One", "Chapter Two"]

    title = section_for_chapter_index(manifest, 0, chapter_title="The Example Novel")
    assert title is not None
    assert title.title == "The Example Novel"

    ch1 = section_for_chapter_index(manifest, 1, chapter_title="Chapter One")
    assert ch1 is not None
    assert "dark and stormy" in ch1.text

    ch1_by_index = section_for_chapter_index(manifest, 1)
    assert ch1_by_index is not None
    assert ch1_by_index.title == "Chapter One"


def test_default_audiobook_filter():
    from novelflow.book_structure import (
        SectionKind,
        apply_default_audiobook_filter,
        default_audiobook_disabled_ids,
        parse_book_sections,
    )

    manifest = parse_book_sections(SAMPLE)
    disabled = default_audiobook_disabled_ids(manifest)
    assert any(s.title == "Dedication" for s in manifest.sections if s.id in disabled)
    filtered = apply_default_audiobook_filter(manifest)
    enabled_kinds = {s.kind for s in filtered.enabled_sections()}
    assert SectionKind.CHAPTER in enabled_kinds
    assert SectionKind.FRONT_MATTER not in enabled_kinds
    assert SectionKind.BACK_MATTER not in enabled_kinds


def test_navigation_skipped():
    md = """\
# Book

## Navigation

- [Chapter One](#chapter-one)

## Chapter One

Story here.
"""
    manifest = parse_book_sections(md)
    titles = [s.title for s in manifest.sections]
    assert "Navigation" not in titles
    assert "Chapter One" in titles


def test_find_cover_image_from_title_page_markdown(tmp_path: Path):
    cover = tmp_path / "cover-art.png"
    cover.write_bytes(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    md = tmp_path / "book.readable.md"
    md.write_text(
        "# The Example Novel\n\n"
        "![Cover](cover-art.png)\n\n"
        "## Chapter One\n\n"
        "Story.\n",
        encoding="utf-8",
    )
    assert find_cover_image_path(md) == cover.resolve()


def test_find_cover_image_from_colocated_export(tmp_path: Path):
    md = tmp_path / "novel.readable.md"
    md.write_text("# Novel\n\n## Chapter One\n\nHi.\n", encoding="utf-8")
    cover = tmp_path / "novel.readable.cover.png"
    cover.write_bytes(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    assert find_cover_image_path(md) == cover.resolve()


def test_duplicate_titles_collapsed():
    md = """\
# The Doomsday Prophecy

The Doomsday Prophecy

# The Doomsday Prophecy

The Doomsday Prophecy

# The Doomsday Prophecy

SCOTT MARIANI

## Chapter One

It begins.
"""
    manifest = parse_book_sections(md)
    title_sections = [s for s in manifest.sections if s.kind == SectionKind.TITLE]
    assert len(title_sections) == 1
    # The single title still carries the book title text.
    assert "Doomsday Prophecy" in title_sections[0].text


def test_chapters_sorted_when_back_matter_stub_appears_first():
    """TOC/back-matter stubs like Author's Note under Chapter N must not play first."""
    md = """\
# The Mozart Conspiracy

## Navigation

- [Chapter One](#chapter-one)
- [Chapter Sixty-Nine](#chapter-sixty-nine)

## Chapter Sixty-Nine

*Author's Note*

## Acknowledgements

Thanks.

## Chapter One

Story begins here with real content.

## Chapter Two

More story.

## Chapter Sixty-Nine

The real final chapter with much longer narrative text that continues
for many paragraphs in the actual book ending.
"""
    manifest = parse_book_sections(md)
    chapters = [s for s in manifest.sections if s.kind == SectionKind.CHAPTER]
    assert [s.title for s in chapters] == [
        "Chapter One",
        "Chapter Two",
        "Chapter Sixty-Nine",
    ]
    ch69 = chapters[-1]
    assert "real final chapter" in ch69.text
    demoted = [
        s for s in manifest.sections
        if s.title == "Chapter Sixty-Nine" and s.kind == SectionKind.BACK_MATTER
    ]
    assert len(demoted) == 1
    assert "Author's Note" in demoted[0].text
