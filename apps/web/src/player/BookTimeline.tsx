import { useCallback, useMemo, useRef, useState } from "react";
import type { Chapter } from "../api/client";
import { formatTime, isMergedAudiobook, totalBookDurationMs } from "./timeUtils";

interface Props {
  chapters: Chapter[];
  currentMs: number;
  activeChapter: number;
  disabled?: boolean;
  onSeek: (bookMs: number) => void;
}

interface Segment {
  start: number;
  end: number;
  dur: number;
  index: number;
  title: string;
}

export default function BookTimeline({ chapters, currentMs, activeChapter, disabled, onSeek }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ label: string; x: number; y: number } | null>(null);
  const [seeking, setSeeking] = useState(false);

  const total = totalBookDurationMs(chapters);

  const segments: Segment[] = useMemo(() => {
    let acc = 0;
    const merged = isMergedAudiobook(chapters);
    return chapters.map((ch, i) => {
      const dur = ch.duration_ms ?? 0;
      const start = merged ? (ch.start_ms ?? acc) : acc;
      acc += dur;
      return { start, end: start + dur, dur, index: i, title: ch.title };
    });
  }, [chapters]);

  const chapterTitleAtX = useCallback(
    (clientX: number): string | null => {
      const body = bodyRef.current;
      if (!body || total <= 0) return null;
      const rect = body.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const bookMs = frac * total;
      for (const seg of segments) {
        const isLast = seg.index === segments.length - 1;
        if (bookMs >= seg.start && (bookMs < seg.end || isLast)) {
          return seg.title;
        }
      }
      return null;
    },
    [segments, total],
  );

  if (!chapters.length || total <= 0) return null;

  const pct = Math.min(100, (currentMs / total) * 100);

  const onTimelineMove = (e: React.MouseEvent) => {
    if (disabled || seeking) {
      setTooltip(null);
      return;
    }
    const label = chapterTitleAtX(e.clientX);
    if (label) {
      setTooltip({ label, x: e.clientX, y: e.clientY });
    } else {
      setTooltip(null);
    }
  };

  return (
    <div className="book-timeline">
      <div className="book-timeline-header">
        <span className="book-timeline-label">Book progress</span>
        <span className="book-timeline-times">
          {formatTime(currentMs)} / {formatTime(total)}
        </span>
      </div>
      <div
        ref={bodyRef}
        className="book-timeline-body"
        onMouseMove={onTimelineMove}
        onMouseLeave={() => {
          setTooltip(null);
          setSeeking(false);
        }}
      >
        <div className="book-timeline-segments" aria-hidden={disabled}>
          {segments.map((seg) => {
            let state: "played" | "current" | "upcoming" = "upcoming";
            if (seg.index < activeChapter) state = "played";
            else if (seg.index === activeChapter) state = "current";
            return (
              <button
                key={seg.index}
                type="button"
                className={`book-timeline-segment book-timeline-segment-${state}`}
                style={{ flex: seg.dur || 1 }}
                disabled={disabled}
                onClick={() => onSeek(seg.start)}
              />
            );
          })}
          <div className="book-timeline-playhead" style={{ left: `${pct}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={total}
          value={Math.min(currentMs, total)}
          disabled={disabled}
          className="book-timeline-input"
          aria-label="Seek book position"
          onPointerDown={() => setSeeking(true)}
          onPointerUp={() => setSeeking(false)}
          onPointerCancel={() => setSeeking(false)}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
      </div>

      {tooltip && (
        <div
          className="book-timeline-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          role="tooltip"
        >
          {tooltip.label}
        </div>
      )}
    </div>
  );
}
