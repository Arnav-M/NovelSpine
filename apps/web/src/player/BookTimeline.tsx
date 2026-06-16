import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
} from "react";
import type { Chapter } from "../api/client";
import BookTimelineSegment from "./BookTimelineSegment";
import {
  bookMsToPixelX,
  buildTimelineSegments,
  formatTime,
  pixelXToBookMs,
  seekBookMs,
  totalBookDurationMs,
} from "./timeUtils";

interface Props {
  chapters: Chapter[];
  currentMs: number;
  disabled?: boolean;
  onSeek: (bookMs: number) => void;
}

const SEGMENT_GAP = 6;

function waveLiftAtPixel(
  startPx: number,
  endPx: number,
  hoverPx: number,
  sigmaPx: number,
): number {
  const dist =
    hoverPx < startPx ? startPx - hoverPx : hoverPx > endPx ? hoverPx - endPx : 0;
  return Math.exp(-(dist * dist) / (2 * sigmaPx * sigmaPx));
}

function segmentWidthExpr(weight: number, gapCount: number): string {
  if (gapCount <= 0) return `${weight * 100}%`;
  return `calc((100% - ${gapCount * SEGMENT_GAP}px) * ${weight})`;
}

const BookTimelineHeader = memo(function BookTimelineHeader({
  bookMs,
  total,
}: {
  bookMs: number;
  total: number;
}) {
  return (
    <div className="book-timeline-header">
      <span className="book-timeline-label">Book progress</span>
      <span className="book-timeline-times">
        {formatTime(bookMs)} / {formatTime(total)}
      </span>
    </div>
  );
});

export default function BookTimeline({ chapters, currentMs, disabled, onSeek }: Props) {
  const segmentsRef = useRef<HTMLDivElement>(null);
  const segmentsWrapRef = useRef<HTMLDivElement>(null);
  const chapterTooltipRef = useRef<HTMLDivElement>(null);
  const segmentsRectRef = useRef<DOMRect | null>(null);
  const segmentElsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const segmentPixelBoundsRef = useRef<{ startPx: number; endPx: number }[]>([]);
  const waveSigmaPxRef = useRef(48);
  const peakIndexRef = useRef(-1);
  const hoverRafRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<{ pixelX: number; clientX: number; bookMs: number } | null>(
    null,
  );

  const [hoverActive, setHoverActive] = useState(false);
  const [peakIndex, setPeakIndex] = useState(-1);
  const [seeking, setSeeking] = useState(false);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [segmentsWidth, setSegmentsWidth] = useState(0);
  const [chapterTooltipLeftPx, setChapterTooltipLeftPx] = useState<number | null>(null);
  const lastSeekEmitRef = useRef(0);
  const pendingSeekMsRef = useRef<number | null>(null);

  const total = totalBookDurationMs(chapters);
  const segments = useMemo(() => buildTimelineSegments(chapters), [chapters]);
  const gapCount = Math.max(0, segments.length - 1);

  const segmentWeights = useMemo(() => {
    if (!segments.length) return [];
    if (total > 0) return segments.map((seg) => seg.dur / total);
    return segments.map(() => 1 / segments.length);
  }, [segments, total]);

  const segmentWidths = useMemo(
    () => segmentWeights.map((weight) => segmentWidthExpr(weight, gapCount)),
    [gapCount, segmentWeights],
  );

  useLayoutEffect(() => {
    segmentElsRef.current.length = segments.length;
    peakIndexRef.current = -1;
  }, [segments.length]);

  useLayoutEffect(() => {
    const el = segmentsRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.getBoundingClientRect().width;
      setSegmentsWidth(width);
      segmentsRectRef.current = el.getBoundingClientRect();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chapters.length, segments.length]);

  const waveSigmaPx = useMemo(() => {
    if (segmentsWidth <= 0) return 48;
    return Math.max(24, Math.min(88, segmentsWidth * 0.07));
  }, [segmentsWidth]);

  const segmentPixelBounds = useMemo(() => {
    if (segmentsWidth <= 0) return segments.map(() => ({ startPx: 0, endPx: 0 }));
    return segments.map((seg) => ({
      startPx: bookMsToPixelX(segments, total, seg.start, segmentsWidth, SEGMENT_GAP),
      endPx: bookMsToPixelX(segments, total, seg.end, segmentsWidth, SEGMENT_GAP),
    }));
  }, [segments, segmentsWidth, total]);

  segmentPixelBoundsRef.current = segmentPixelBounds;
  waveSigmaPxRef.current = waveSigmaPx;

  useLayoutEffect(() => {
    if (!hoverActive || peakIndex < 0 || segmentsWidth <= 0 || !segments[peakIndex]?.title) {
      setChapterTooltipLeftPx(null);
      return;
    }

    const wrap = segmentsWrapRef.current;
    const tooltip = chapterTooltipRef.current;
    const bounds = segmentPixelBounds[peakIndex];
    if (!wrap || !tooltip || !bounds) {
      setChapterTooltipLeftPx(null);
      return;
    }

    const wrapWidth = wrap.getBoundingClientRect().width;
    const tipWidth = tooltip.getBoundingClientRect().width;
    const centerPx = (bounds.startPx + bounds.endPx) / 2;
    const edgePad = 4;
    const maxLeft = Math.max(edgePad, wrapWidth - tipWidth - edgePad);
    const leftPx = Math.min(maxLeft, Math.max(edgePad, centerPx - tipWidth / 2));
    setChapterTooltipLeftPx(leftPx);
  }, [hoverActive, peakIndex, segmentPixelBounds, segments, segmentsWidth]);

  const registerEl = useCallback((index: number, el: HTMLButtonElement | null) => {
    segmentElsRef.current[index] = el;
  }, []);

  const resetWaveDom = useCallback(() => {
    const els = segmentElsRef.current;
    if (peakIndexRef.current >= 0) {
      els[peakIndexRef.current]?.classList.remove("book-timeline-segment-peak");
      peakIndexRef.current = -1;
      setPeakIndex(-1);
    }
    for (const el of els) {
      if (!el) continue;
      el.style.transform = "";
      el.style.zIndex = "";
      el.classList.remove("book-timeline-segment-wave");
    }
  }, []);

  const applyWaveTransforms = useCallback((pixelX: number) => {
    const bounds = segmentPixelBoundsRef.current;
    const sigma = waveSigmaPxRef.current;
    const els = segmentElsRef.current;

    let peak = -1;
    for (let i = 0; i < bounds.length; i += 1) {
      const { startPx, endPx } = bounds[i] ?? { startPx: 0, endPx: 0 };
      const lift = waveLiftAtPixel(startPx, endPx, pixelX, sigma);
      const el = els[i];
      if (!el) continue;

      if (lift > 0.01) {
        el.style.transform = `scaleY(${(1 + lift * 0.35).toFixed(3)})`;
        if (lift > 0.15) {
          el.style.zIndex = String(Math.min(2, Math.round(lift * 10)));
        } else {
          el.style.zIndex = "";
        }
        el.classList.toggle("book-timeline-segment-wave", lift > 0.1);
      } else {
        el.style.transform = "";
        el.style.zIndex = "";
        el.classList.remove("book-timeline-segment-wave");
      }

      if (pixelX >= startPx && pixelX <= endPx) {
        peak = i;
      }
    }

    if (peak < 0) {
      let bestLift = 0.2;
      bounds.forEach(({ startPx, endPx }, i) => {
        const lift = waveLiftAtPixel(startPx, endPx, pixelX, sigma);
        if (lift > bestLift) {
          bestLift = lift;
          peak = i;
        }
      });
    }

    if (peak !== peakIndexRef.current) {
      if (peakIndexRef.current >= 0) {
        els[peakIndexRef.current]?.classList.remove("book-timeline-segment-peak");
      }
      peakIndexRef.current = peak;
      setPeakIndex(peak);
      if (peak >= 0) {
        els[peak]?.classList.add("book-timeline-segment-peak");
      }
    }
  }, []);

  const applyHover = useCallback(
    (pixelX: number, _clientX: number, _bookMs: number) => {
      setHoverActive(true);
      applyWaveTransforms(pixelX);
    },
    [applyWaveTransforms],
  );

  const updateHover = useCallback(
    (clientX: number) => {
      if (disabled || seeking) return;
      const el = segmentsRef.current;
      if (!el || total <= 0 || segmentsWidth <= 0) return;

      let rect = segmentsRectRef.current;
      if (!rect || rect.width <= 0) {
        rect = el.getBoundingClientRect();
        segmentsRectRef.current = rect;
      }
      if (rect.width <= 0) return;

      const pixelX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const bookMs = pixelXToBookMs(segments, total, pixelX, segmentsWidth, SEGMENT_GAP);
      pendingHoverRef.current = { pixelX, clientX, bookMs };

      if (hoverRafRef.current != null) return;
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        const pending = pendingHoverRef.current;
        if (!pending) return;
        applyHover(pending.pixelX, pending.clientX, pending.bookMs);
      });
    },
    [applyHover, disabled, seeking, segments, segmentsWidth, total],
  );

  const clearHover = useCallback(() => {
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    pendingHoverRef.current = null;
    peakIndexRef.current = -1;
    setPeakIndex(-1);
    resetWaveDom();
    setHoverActive(false);
  }, [resetWaveDom]);

  const finishScrub = useCallback(() => {
    if (pendingSeekMsRef.current != null) {
      onSeek(pendingSeekMsRef.current);
      pendingSeekMsRef.current = null;
    }
    setSeeking(false);
    setScrubMs(null);
    lastSeekEmitRef.current = 0;
  }, [onSeek]);

  const emitScrub = useCallback(
    (clientX: number, forceSeek = false) => {
      const el = segmentsRef.current;
      if (!el || total <= 0 || segmentsWidth <= 0 || disabled) return;

      const rect = el.getBoundingClientRect();
      segmentsRectRef.current = rect;
      const pixelX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const ms = pixelXToBookMs(segments, total, pixelX, segmentsWidth, SEGMENT_GAP);

      setScrubMs(ms);
      setHoverActive(true);
      applyWaveTransforms(pixelX);

      pendingSeekMsRef.current = ms;
      const now = Date.now();
      if (forceSeek || now - lastSeekEmitRef.current >= 100) {
        lastSeekEmitRef.current = now;
        pendingSeekMsRef.current = null;
        onSeek(ms);
      }
    },
    [applyWaveTransforms, disabled, onSeek, segments, segmentsWidth, total],
  );

  const handleScrubPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      setSeeking(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      emitScrub(e.clientX, true);
    },
    [disabled, emitScrub],
  );

  const handleScrubPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        emitScrub(e.clientX);
        return;
      }
      updateHover(e.clientX);
    },
    [emitScrub, updateHover],
  );

  const handleScrubPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        emitScrub(e.clientX, true);
        e.currentTarget.releasePointerCapture(e.pointerId);
        finishScrub();
      }
    },
    [emitScrub, finishScrub],
  );

  const handleScrubPointerLeave = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) return;
      clearHover();
    },
    [clearHover],
  );

  const handleScrubKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (disabled || total <= 0) return;
      const bookMs = Math.min(Math.max(0, currentMs), total);
      const displayMs = scrubMs != null ? Math.min(Math.max(0, scrubMs), total) : bookMs;
      const step = Math.max(5000, Math.round(total * 0.01));
      let next = displayMs;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        next = Math.max(0, displayMs - step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next = Math.min(total, displayMs + step);
      } else if (e.key === "Home") {
        e.preventDefault();
        next = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        next = total;
      } else {
        return;
      }
      onSeek(next);
    },
    [currentMs, disabled, onSeek, scrubMs, total],
  );

  useLayoutEffect(() => {
    if (!hoverActive) {
      resetWaveDom();
    }
  }, [hoverActive, resetWaveDom]);

  const handleTracksPointerLeave = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (seeking) return;
      const related = e.relatedTarget;
      if (related instanceof Node && e.currentTarget.contains(related)) return;
      clearHover();
    },
    [clearHover, seeking],
  );

  const handleBodyPointerLeave = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (seeking) return;
      const related = e.relatedTarget;
      if (related instanceof Node && e.currentTarget.contains(related)) return;
      clearHover();
    },
    [clearHover, seeking],
  );

  if (!chapters.length || total <= 0) return null;

  const bookMs = Math.min(Math.max(0, currentMs), total);
  const displayMs = scrubMs != null ? Math.min(Math.max(0, scrubMs), total) : bookMs;
  const seekPosition = seekBookMs(chapters, displayMs);
  const activeChapterTitle = chapters[seekPosition.index]?.title ?? "";
  const ariaValueText = activeChapterTitle
    ? `${activeChapterTitle}, ${formatTime(displayMs)} of ${formatTime(total)}`
    : `${formatTime(displayMs)} of ${formatTime(total)}`;
  const playheadLeftPx =
    segmentsWidth > 0
      ? bookMsToPixelX(segments, total, displayMs, segmentsWidth, SEGMENT_GAP)
      : 0;
  const showPlayhead = (displayMs > 0 || seeking) && segmentsWidth > 0;
  const playheadStyle = showPlayhead
    ? {
        left: `${playheadLeftPx}px`,
        transform: "translateX(-50%)",
      }
    : undefined;

  const peakChapterTitle =
    hoverActive && peakIndex >= 0 ? segments[peakIndex]?.title : null;

  const peakBounds = peakIndex >= 0 ? segmentPixelBounds[peakIndex] : null;
  const chapterTooltipStyle =
    chapterTooltipLeftPx != null
      ? { left: `${chapterTooltipLeftPx}px`, transform: "none" as const }
      : peakBounds
        ? {
            left: `${(peakBounds.startPx + peakBounds.endPx) / 2}px`,
            transform: "translateX(-50%)" as const,
          }
        : undefined;

  return (
    <div className={`book-timeline ${hoverActive ? "book-timeline--hovered" : ""}`}>
      <div
        className={`book-timeline-body ${hoverActive ? "book-timeline-body--hovered" : ""}`}
        onPointerLeave={handleBodyPointerLeave}
      >
        <BookTimelineHeader bookMs={displayMs} total={total} />
        <div className="book-timeline-tracks" onPointerLeave={handleTracksPointerLeave}>
          <div ref={segmentsWrapRef} className="book-timeline-segments-wrap">
            {peakChapterTitle && (
              <div
                ref={chapterTooltipRef}
                className={`book-timeline-chapter-tooltip${
                  chapterTooltipLeftPx == null ? " book-timeline-chapter-tooltip--centered" : ""
                }`}
                style={chapterTooltipStyle}
                role="tooltip"
              >
                {peakChapterTitle}
              </div>
            )}
            <div ref={segmentsRef} className="book-timeline-segments" aria-hidden={disabled}>
              {segments.map((seg) => {
                const fillPct =
                  displayMs <= seg.start
                    ? 0
                    : displayMs >= seg.end
                      ? 100
                      : seg.dur > 0
                        ? Math.min(100, ((displayMs - seg.start) / seg.dur) * 100)
                        : 0;

                return (
                  <BookTimelineSegment
                    key={seg.index}
                    seg={seg}
                    width={segmentWidths[seg.index] ?? segmentWidthExpr(0, gapCount)}
                    fillPct={fillPct}
                    disabled={disabled}
                    onSeek={onSeek}
                    registerEl={registerEl}
                  />
                );
              })}
              {showPlayhead && (
                <div className="book-timeline-playhead" style={playheadStyle} aria-hidden />
              )}
            </div>
          </div>
          <div
            className="book-timeline-scrubber"
            aria-label="Seek book position"
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={displayMs}
            aria-valuetext={ariaValueText}
            aria-disabled={disabled}
            onKeyDown={handleScrubKeyDown}
            onPointerEnter={() => {
              if (!disabled) setHoverActive(true);
            }}
            onPointerDown={handleScrubPointerDown}
            onPointerMove={handleScrubPointerMove}
            onPointerUp={handleScrubPointerUp}
            onPointerCancel={handleScrubPointerUp}
            onPointerLeave={handleScrubPointerLeave}
          />
        </div>
      </div>
    </div>
  );
}
