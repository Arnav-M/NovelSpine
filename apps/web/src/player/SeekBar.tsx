interface Props {
  value: number;
  max: number;
  disabled?: boolean;
  onChange: (ms: number) => void;
  className?: string;
  ariaLabel?: string;
  valueText?: string;
}

export default function SeekBar({
  value,
  max,
  disabled,
  onChange,
  className = "",
  ariaLabel = "Seek",
  valueText,
}: Props) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`seek-bar ${className}`}>
      <div className="seek-bar-track">
        <div className="seek-bar-fill" style={{ width: `${pct}%` }} />
        <div className="seek-bar-thumb" style={{ left: `${pct}%` }} />
        <input
          type="range"
          min={0}
          max={max || 1}
          value={Math.min(value, max || 1)}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="seek-bar-input"
          aria-label={ariaLabel}
          aria-valuetext={valueText}
        />
      </div>
    </div>
  );
}
