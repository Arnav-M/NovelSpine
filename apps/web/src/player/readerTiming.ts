export interface ReaderLineState {
  index: number;
  lineProgress: number;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function scaleLineStarts(
  lineStartMs: number[],
  sectionDurationMs: number,
  chapterDurationMs: number,
): number[] {
  if (
    lineStartMs.length <= 0 ||
    sectionDurationMs <= 0 ||
    chapterDurationMs <= 0 ||
    Math.abs(sectionDurationMs - chapterDurationMs) < 50
  ) {
    return lineStartMs;
  }
  const scale = chapterDurationMs / sectionDurationMs;
  return lineStartMs.map((ms) => Math.round(ms * scale));
}

/** Map playback position to the active reader line using precomputed timestamps. */
function readerLineStateFromTimestamps(
  lineStartMs: number[],
  chapterMs: number,
  chapterDurationMs: number,
): ReaderLineState {
  if (lineStartMs.length <= 0) {
    return { index: -1, lineProgress: 0 };
  }

  const t = Math.min(chapterDurationMs, Math.max(0, chapterMs));
  let index = 0;
  for (let i = lineStartMs.length - 1; i >= 0; i -= 1) {
    if (t >= lineStartMs[i]) {
      index = i;
      break;
    }
  }

  const start = lineStartMs[index];
  const end =
    index + 1 < lineStartMs.length
      ? lineStartMs[index + 1]
      : Math.max(chapterDurationMs, start + 1);
  const lineProgress = end > start ? clamp((t - start) / (end - start)) : 0;
  return { index, lineProgress };
}

/** Fallback: map playback position using per-line word weights. */
function readerLineStateFromWeights(
  weights: number[],
  chapterMs: number,
  chapterDurationMs: number,
): ReaderLineState {
  if (weights.length <= 0) {
    return { index: -1, lineProgress: 0 };
  }
  if (chapterDurationMs <= 0) {
    return { index: 0, lineProgress: 0 };
  }

  const totalWeight = weights.reduce((sum, w) => sum + Math.max(w, 1), 0);
  const t = Math.min(chapterDurationMs, Math.max(0, chapterMs));
  const progress = t / chapterDurationMs;

  let cumulative = 0;
  for (let i = 0; i < weights.length; i += 1) {
    const share = Math.max(weights[i], 1) / totalWeight;
    const next = cumulative + share;
    if (progress <= next || i === weights.length - 1) {
      const lineProgress = share > 0 ? clamp((progress - cumulative) / share) : 0;
      return { index: i, lineProgress };
    }
    cumulative = next;
  }

  return { index: weights.length - 1, lineProgress: 1 };
}

function resolveScaledLineStarts(
  weights: number[],
  lineStartMs: number[] | null | undefined,
  chapterDurationMs: number,
  sectionDurationMs: number,
): number[] {
  if (lineStartMs && lineStartMs.length === weights.length && lineStartMs.length > 0) {
    return scaleLineStarts(lineStartMs, sectionDurationMs, chapterDurationMs);
  }
  return [];
}

/** Playback ms for seeking when the user clicks a reader line. */
export function lineSeekMs(
  lineIndex: number,
  weights: number[],
  lineStartMs: number[] | null | undefined,
  chapterDurationMs: number,
  options?: {
    playbackSpeed?: number;
    sectionDurationMs?: number;
  },
): number {
  if (lineIndex < 0 || lineIndex >= weights.length || chapterDurationMs <= 0) return 0;

  const speed = options?.playbackSpeed ?? 1;
  const scaledStarts = resolveScaledLineStarts(
    weights,
    lineStartMs,
    chapterDurationMs,
    options?.sectionDurationMs ?? 0,
  );

  if (scaledStarts.length > 0) {
    const timingMs = scaledStarts[lineIndex] ?? 0;
    return speed > 0 ? timingMs / speed : timingMs;
  }

  const totalWeight = weights.reduce((sum, w) => sum + Math.max(w, 1), 0);
  let cumulative = 0;
  for (let i = 0; i < lineIndex; i += 1) {
    cumulative += Math.max(weights[i], 1) / totalWeight;
  }
  const timingMs = cumulative * chapterDurationMs;
  return speed > 0 ? timingMs / speed : timingMs;
}

export function readerLineState(
  weights: number[],
  lineStartMs: number[] | null | undefined,
  chapterMs: number,
  chapterDurationMs: number,
  options?: {
    playbackSpeed?: number;
    sectionDurationMs?: number;
  },
): ReaderLineState {
  const speed = options?.playbackSpeed ?? 1;
  const timingMs = speed > 0 ? chapterMs * speed : chapterMs;
  const scaledStarts = resolveScaledLineStarts(
    weights,
    lineStartMs,
    chapterDurationMs,
    options?.sectionDurationMs ?? 0,
  );

  if (scaledStarts.length > 0) {
    return readerLineStateFromTimestamps(scaledStarts, timingMs, chapterDurationMs);
  }
  return readerLineStateFromWeights(weights, timingMs, chapterDurationMs);
}
