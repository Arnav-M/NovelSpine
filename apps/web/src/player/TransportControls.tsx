interface Props {
  playing: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  size?: "default" | "mini";
}

export default function TransportControls({
  playing,
  disabled,
  onToggle,
  onPrev,
  onNext,
  onSkipBack,
  onSkipForward,
  canPrev = true,
  canNext = true,
  size = "default",
}: Props) {
  return (
    <div className={`transport-controls ${size === "mini" ? "transport-mini" : ""}`}>
      <button type="button" className="transport-btn" disabled={disabled || !canPrev} onClick={onPrev} aria-label="Previous chapter">
        |◀
      </button>
      <button type="button" className="transport-btn" disabled={disabled} onClick={onSkipBack} aria-label="Back 10 seconds">
        ↺10
      </button>
      <button
        type="button"
        className="transport-btn transport-play"
        disabled={disabled}
        onClick={onToggle}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <button type="button" className="transport-btn" disabled={disabled} onClick={onSkipForward} aria-label="Forward 10 seconds">
        10↻
      </button>
      <button type="button" className="transport-btn" disabled={disabled || !canNext} onClick={onNext} aria-label="Next chapter">
        ▶|
      </button>
    </div>
  );
}
