import { memo } from "react";
import type { TimelineSegment } from "./timeUtils";

interface Props {
  seg: TimelineSegment;
  width: string;
  fillPct: number;
  disabled?: boolean;
  onSeek: (bookMs: number) => void;
  registerEl: (index: number, el: HTMLButtonElement | null) => void;
}

function BookTimelineSegment({
  seg,
  width,
  fillPct,
  disabled,
  onSeek,
  registerEl,
}: Props) {
  const isComplete = fillPct >= 100;
  const isPartial = fillPct > 0 && fillPct < 100;

  return (
    <button
      ref={(el) => registerEl(seg.index, el)}
      type="button"
      className="book-timeline-segment"
      style={{
        flex: "0 0 auto",
        width,
      }}
      disabled={disabled}
      title={seg.title}
      aria-label={seg.title}
      onClick={() => onSeek(seg.start)}
    >
      <span className="book-timeline-segment-track">
        {(isComplete || isPartial) && (
          <span
            className="book-timeline-segment-fill"
            style={{ width: `${fillPct}%` }}
            data-complete={isComplete}
            data-active={isPartial}
          />
        )}
      </span>
    </button>
  );
}

export default memo(BookTimelineSegment, (prev, next) => {
  return (
    prev.width === next.width &&
    prev.fillPct === next.fillPct &&
    prev.disabled === next.disabled &&
    prev.seg.index === next.seg.index &&
    prev.registerEl === next.registerEl
  );
});
