import { useEffect, useRef } from "react";

export interface LogEntry {
  id: string;
  text: string;
  tone?: "normal" | "muted" | "danger";
}

interface Props {
  entries: LogEntry[];
  onClear: () => void;
  embedded?: boolean;
}

export default function ActivityLog({ entries, onClear, embedded }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <section
      ref={scrollRef}
      className={`activity-log ${embedded ? "activity-log-embedded" : ""}`}
      aria-label="Activity log"
    >
      {!embedded && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <strong style={{ fontSize: 11, color: "var(--muted)" }}>Activity</strong>
          <button type="button" className="btn btn-ghost" style={{ padding: "0 4px", fontSize: 11 }} onClick={onClear}>
            Clear (Ctrl+L)
          </button>
        </div>
      )}
      {entries.map((entry) => (
        <p key={entry.id} className={`activity-log-entry ${entry.tone ?? "normal"}`}>
          {entry.text}
        </p>
      ))}
    </section>
  );
}

export type { LogEntry as ActivityLogEntry };
