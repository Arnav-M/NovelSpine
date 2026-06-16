import type { Chapter } from "../api/client";

export function isMergedAudiobook(chapters: Chapter[]): boolean {
  return chapters.length > 0 && chapters.every((ch) => !ch.file);
}

export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function bookPositionMs(chapters: Chapter[], index: number, offsetMs: number): number {
  const ch = chapters[index];
  if (isMergedAudiobook(chapters)) {
    return (ch?.start_ms ?? 0) + offsetMs;
  }
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += chapters[i]?.duration_ms ?? 0;
  return pos + offsetMs;
}

export function isChapterSection(ch: Chapter): boolean {
  if (ch.kind === "chapter") return true;
  if (ch.kind && ch.kind !== "chapter") return false;
  return /^chapter\b/i.test(ch.title);
}

export function chapterSections(chapters: Chapter[]): Chapter[] {
  return chapters.filter(isChapterSection);
}

/** Index label for the active section — "Chapter N of M" for fiction chapters, else "Part X of Y". */
export function chapterLabelFor(chapters: Chapter[], index: number): string {
  if (index < 0 || index >= chapters.length) return "";
  const ch = chapters[index];
  if (isChapterSection(ch)) {
    const numbered = chapters.slice(0, index + 1).filter(isChapterSection).length;
    const total = chapterSections(chapters).length;
    return total > 1 ? `Chapter ${numbered} of ${total}` : `Chapter ${numbered}`;
  }
  const total = chapters.length;
  const num = index + 1;
  return total > 1 ? `Part ${num} of ${total}` : `Part ${num}`;
}

/** @deprecated Use chapterLabelFor(chapters, index) */
export function chapterLabel(activeChapter: number, total: number): string {
  if (total <= 0) return "";
  return total > 1 ? `Part ${activeChapter + 1} of ${total}` : `Part ${activeChapter + 1}`;
}

export function sectionKindBadgeLabel(kind: string | null | undefined): string | null {
  if (!kind || kind === "chapter") return null;
  const labels: Record<string, string> = {
    title: "title",
    front_matter: "front",
    back_matter: "back",
    other: "other",
  };
  return labels[kind] ?? kind.replace(/_/g, " ");
}

export function audiobookHasSectionKinds(chapters: Chapter[]): boolean {
  return chapters.some((ch) => sectionKindBadgeLabel(ch.kind) != null);
}

export function chapterListNumber(chapters: Chapter[], index: number): string | null {
  const ch = chapters[index];
  if (!ch || !isChapterSection(ch)) return null;
  const num = chapters.slice(0, index + 1).filter(isChapterSection).length;
  return `${num}.`;
}

export function totalBookDurationMs(chapters: Chapter[]): number {
  if (!chapters.length) return 0;
  if (isMergedAudiobook(chapters)) {
    const last = chapters[chapters.length - 1];
    return (last.start_ms ?? 0) + (last.duration_ms ?? 0);
  }
  return chapters.reduce((sum, ch) => sum + (ch.duration_ms ?? 0), 0);
}

export interface TimelineSegment {
  start: number;
  end: number;
  dur: number;
  index: number;
  title: string;
}

/** Book timeline segments with start/end/dur derived from chapter metadata. */
export function buildTimelineSegments(chapters: Chapter[]): TimelineSegment[] {
  const merged = isMergedAudiobook(chapters);
  let acc = 0;
  return chapters.map((ch, i) => {
    const dur = Math.max(0, ch.duration_ms ?? 0);
    const start = merged ? (ch.start_ms ?? acc) : acc;
    acc += dur;
    return { start, end: start + dur, dur, index: i, title: ch.title };
  });
}

/** Map pointer x within the segments row to book milliseconds (gap-aware). */
export function pixelXToBookMs(
  segments: TimelineSegment[],
  total: number,
  pixelX: number,
  containerWidth: number,
  gapPx: number,
): number {
  if (!segments.length || containerWidth <= 0 || total <= 0) return 0;
  const x = Math.max(0, Math.min(containerWidth, pixelX));
  const gaps = Math.max(0, segments.length - 1);
  const contentWidth = Math.max(0, containerWidth - gaps * gapPx);
  let cursor = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const weight = seg.dur / total;
    const segW = contentWidth * weight;
    if (x <= cursor + segW || i === segments.length - 1) {
      const into = segW > 0 ? Math.max(0, Math.min(segW, x - cursor)) : 0;
      const frac = segW > 0 ? into / segW : 0;
      return Math.min(total, seg.start + seg.dur * frac);
    }
    cursor += segW + gapPx;
  }
  return total;
}

/** Map book milliseconds to x offset within the segments row (gap-aware). */
export function bookMsToPixelX(
  segments: TimelineSegment[],
  total: number,
  bookMs: number,
  containerWidth: number,
  gapPx: number,
): number {
  if (!segments.length || containerWidth <= 0) return 0;
  const gaps = Math.max(0, segments.length - 1);
  const contentWidth = Math.max(0, containerWidth - gaps * gapPx);
  let x = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const weight = total > 0 ? seg.dur / total : 1 / segments.length;
    const segW = contentWidth * weight;
    if (bookMs >= seg.end) {
      x += segW;
      if (i < segments.length - 1) x += gapPx;
      continue;
    }
    const into = Math.max(0, bookMs - seg.start);
    const frac = seg.dur > 0 ? Math.min(1, into / seg.dur) : 0;
    return x + segW * frac;
  }
  return x;
}

export function chapterIndexForBookMs(chapters: Chapter[], bookMs: number): number {
  return seekBookMs(chapters, bookMs).index;
}

export function seekBookMs(chapters: Chapter[], bookMs: number): { index: number; offsetMs: number } {
  const clamped = Math.max(0, bookMs);
  if (isMergedAudiobook(chapters)) {
    for (let i = 0; i < chapters.length; i += 1) {
      const ch = chapters[i];
      const start = ch.start_ms ?? 0;
      const end = start + (ch.duration_ms ?? 0);
      const isLast = i === chapters.length - 1;
      if (clamped >= start && (clamped < end || isLast)) {
        const raw = Math.max(0, clamped - start);
        const dur = ch.duration_ms ?? 0;
        return { index: i, offsetMs: isLast && dur > 0 ? Math.min(raw, dur) : raw };
      }
    }
    return { index: chapters.length - 1, offsetMs: 0 };
  }
  let acc = 0;
  for (let i = 0; i < chapters.length; i += 1) {
    const dur = chapters[i].duration_ms ?? 0;
    if (clamped <= acc + dur || i === chapters.length - 1) {
      const raw = Math.max(0, clamped - acc);
      const isLast = i === chapters.length - 1;
      return { index: i, offsetMs: isLast && dur > 0 ? Math.min(raw, dur) : raw };
    }
    acc += dur;
  }
  return { index: 0, offsetMs: 0 };
}
