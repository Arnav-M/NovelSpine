import type { Section } from "../api/client";

/** Typical Edge TTS narration pace (matches legacy Tk GUI). */
export const AUDIOBOOK_WORDS_PER_MINUTE = 155;

export interface SectionSelectionStats {
  selectedCount: number;
  totalCount: number;
  words: number;
  totalWords: number;
  chapters: number;
  minutes: number;
}

export function selectionStats(
  sections: Section[],
  enabled: Record<string, boolean>,
): SectionSelectionStats {
  let selectedCount = 0;
  let words = 0;
  let totalWords = 0;
  let chapters = 0;

  for (const s of sections) {
    const wc = s.word_count ?? 0;
    totalWords += wc;
    if (!enabled[s.id]) continue;
    selectedCount += 1;
    words += wc;
    if (s.kind === "chapter") chapters += 1;
  }

  return {
    selectedCount,
    totalCount: sections.length,
    words,
    totalWords,
    chapters,
    minutes: words / AUDIOBOOK_WORDS_PER_MINUTE,
  };
}

export function formatAudiobookDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
  const totalMin = Math.max(1, Math.round(minutes));
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return `${hours} hr ${mins.toString().padStart(2, "0")} min`;
}

export function formatWordCount(n: number): string {
  return Math.max(0, n).toLocaleString();
}
