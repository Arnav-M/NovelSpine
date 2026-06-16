import { useMemo, useRef, useState } from "react";
import type { Section } from "../api/client";
import { useModalA11y } from "../a11y/useModalA11y";

interface Props {
  sections: Section[];
  enabled: Record<string, boolean>;
  onChange: (enabled: Record<string, boolean>) => void;
  onClose: () => void;
}

export default function SectionPickerModal({ sections, enabled, onChange, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");

  useModalA11y(dialogRef, { open: true, onClose, initialFocusRef: searchRef });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(
      (s) => s.title.toLowerCase().includes(q) || s.kind.toLowerCase().includes(q),
    );
  }, [search, sections]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="section-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="section-picker-title">Select sections</h2>
        <label className="sr-only" htmlFor="section-search">
          Search sections
        </label>
        <input
          ref={searchRef}
          id="section-search"
          type="search"
          className="section-search"
          placeholder="Search sections…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="section-picker-list" role="group" aria-label="Audiobook sections">
          {filtered.map((s) => (
            <label key={s.id} className="section-item">
              <input
                type="checkbox"
                checked={enabled[s.id] ?? false}
                onChange={(e) => onChange({ ...enabled, [s.id]: e.target.checked })}
              />
              <span>
                {s.title} ({s.kind}, {s.word_count} words)
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
