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

export function chapterLabel(activeChapter: number, total: number): string {
  if (total <= 0) return "";
  return total > 1 ? `Part ${activeChapter + 1} of ${total}` : `Part ${activeChapter + 1}`;
}

export function totalBookDurationMs(chapters: Chapter[]): number {
  if (!chapters.length) return 0;
  if (isMergedAudiobook(chapters)) {
    const last = chapters[chapters.length - 1];
    return (last.start_ms ?? 0) + (last.duration_ms ?? 0);
  }
  return chapters.reduce((sum, ch) => sum + (ch.duration_ms ?? 0), 0);
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
        return { index: i, offsetMs: Math.max(0, clamped - start) };
      }
    }
    return { index: chapters.length - 1, offsetMs: 0 };
  }
  let acc = 0;
  for (let i = 0; i < chapters.length; i += 1) {
    const dur = chapters[i].duration_ms ?? 0;
    if (clamped <= acc + dur || i === chapters.length - 1) {
      return { index: i, offsetMs: Math.max(0, clamped - acc) };
    }
    acc += dur;
  }
  return { index: 0, offsetMs: 0 };
}
