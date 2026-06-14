import { useEffect, useRef } from "react";
import type { Chapter } from "../api/client";
import { formatTime } from "./timeUtils";

interface Props {
  chapters: Chapter[];
  activeChapter: number;
  open: boolean;
  onSelect: (index: number) => void;
}

export default function ChapterPanel({ chapters, activeChapter, open, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !activeRef.current || !listRef.current) return;
    activeRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeChapter, open]);

  if (!chapters.length || !open) return null;

  return (
    <aside className="chapter-sidebar" aria-label="Chapters">
      <div className="chapter-sidebar-header">
        <strong>Chapters</strong>
        <span className="chapter-sidebar-count">{chapters.length}</span>
      </div>
      <div ref={listRef} className="chapter-sidebar-list">
        {chapters.map((ch, i) => (
          <button
            key={`${ch.title}-${i}`}
            ref={i === activeChapter ? activeRef : undefined}
            type="button"
            className={`chapter-sidebar-item ${activeChapter === i ? "active" : ""}`}
            onDoubleClick={() => onSelect(i)}
            onClick={() => onSelect(i)}
          >
            <span className="chapter-sidebar-title">{ch.title}</span>
            <span className="chapter-sidebar-duration">{formatTime(ch.duration_ms ?? 0)}</span>
          </button>
        ))}
      </div>
      <p className="chapter-sidebar-hint">Click or double-click to jump</p>
    </aside>
  );
}
