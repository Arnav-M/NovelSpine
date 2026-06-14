import { useMemo, useState } from "react";
import type { Section } from "../api/client";

interface Props {
  sections: Section[];
  enabled: Record<string, boolean>;
  onChange: (enabled: Record<string, boolean>) => void;
  onClose: () => void;
}

export default function SectionPickerModal({ sections, enabled, onChange, onClose }: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(
      (s) => s.title.toLowerCase().includes(q) || s.kind.toLowerCase().includes(q),
    );
  }, [search, sections]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>Select sections</h2>
        <input
          type="search"
          className="section-search"
          placeholder="Search sections…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="section-picker-list">
          {filtered.map((s) => (
            <label key={s.id} className="section-item">
              <input
                type="checkbox"
                checked={enabled[s.id] ?? false}
                onChange={(e) => onChange({ ...enabled, [s.id]: e.target.checked })}
              />
              <span>{s.title}</span>
              <span className="section-meta">
                {s.kind} · {s.word_count} words
              </span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
