import { useEffect, useRef } from "react";
import type { Chapter } from "../api/client";
import { useRovingTabIndex } from "../a11y/useRovingTabIndex";
import { formatTime } from "./timeUtils";

interface Props {
  chapters: Chapter[];
  activeChapter: number;
  open: boolean;
  collapsed?: boolean;
  part?: "all" | "header" | "body";
  onToggleCollapse?: () => void;
  onSelect: (index: number) => void;
}

export default function ChapterPanel({
  chapters,
  activeChapter,
  open,
  collapsed = false,
  part = "all",
  onToggleCollapse,
  onSelect,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { getTabIndex, onKeyDown, setFocusedIndex } = useRovingTabIndex({
    itemCount: chapters.length,
    activeIndex: activeChapter,
    syncActiveIndex: false,
    orientation: "vertical",
    onActivate: (index) => {
      buttonRefs.current[index]?.focus();
    },
  });

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open || collapsed || !listRef.current) return;
    const activeEl = buttonRefs.current[activeChapter];
    const list = listRef.current;
    if (!activeEl) return;
    const itemTop = activeEl.offsetTop;
    const itemBottom = itemTop + activeEl.offsetHeight;
    if (itemTop < list.scrollTop) {
      list.scrollTop = itemTop;
    } else if (itemBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = itemBottom - list.clientHeight;
    }
  }, [activeChapter, collapsed, open]);

  useEffect(() => {
    if (open && !collapsed && !wasOpenRef.current) {
      setFocusedIndex(activeChapter);
      buttonRefs.current[activeChapter]?.focus({ preventScroll: true });
    }
    wasOpenRef.current = open && !collapsed;
  }, [activeChapter, collapsed, open, setFocusedIndex]);

  if (!open) return null;

  const showHeader = part === "all" || part === "header";
  const showBody = (part === "all" || part === "body") && !collapsed;
  const empty = chapters.length === 0;

  if (empty && part === "body" && !collapsed) {
    return (
      <aside
        className="chapter-sidebar chapter-sidebar--body chapter-sidebar--empty"
        aria-label="Chapters"
      >
        <div id="player-chapter-sidebar-body" className="chapter-sidebar-body-panel">
          <p className="chapter-sidebar-placeholder">Load an audiobook to browse chapters.</p>
        </div>
      </aside>
    );
  }

  if (empty && part === "header") {
    return (
      <aside className="chapter-sidebar chapter-sidebar--header" aria-label="Chapters">
        <div className="chapter-sidebar-header-panel">
          <div className="chapter-sidebar-topbar">
            {onToggleCollapse && (
              <button
                type="button"
                className="chapter-sidebar-notch"
                aria-expanded={!collapsed}
                aria-controls="player-chapter-sidebar-body"
                aria-label={collapsed ? "Show chapters" : "Hide chapters"}
                title={collapsed ? "Show chapters" : "Hide chapters"}
                onClick={onToggleCollapse}
              >
                <span
                  className={`chapter-sidebar-notch-icon ${collapsed ? "" : "chapter-sidebar-notch-icon--open"}`}
                  aria-hidden="true"
                />
              </button>
            )}
            <div className="chapter-sidebar-header">
              <strong>Chapters</strong>
              <span className="chapter-sidebar-count">0</span>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  if (empty) return null;

  return (
    <aside
      className={`chapter-sidebar ${collapsed ? "chapter-sidebar--collapsed" : ""}${part !== "all" ? ` chapter-sidebar--${part}` : ""}`}
      aria-label="Chapters"
    >
      {showHeader && (
      <div className="chapter-sidebar-header-panel">
        <div className="chapter-sidebar-topbar">
          {onToggleCollapse && (
            <button
              type="button"
              className="chapter-sidebar-notch"
              aria-expanded={!collapsed}
              aria-controls="player-chapter-sidebar-body"
              aria-label={collapsed ? "Show chapters" : "Hide chapters"}
              title={collapsed ? "Show chapters" : "Hide chapters"}
              onClick={onToggleCollapse}
            >
              <span
                className={`chapter-sidebar-notch-icon ${collapsed ? "" : "chapter-sidebar-notch-icon--open"}`}
                aria-hidden="true"
              />
            </button>
          )}
          <div className="chapter-sidebar-header">
            <strong>Chapters</strong>
            <span className="chapter-sidebar-count">{chapters.length}</span>
          </div>
        </div>
      </div>
      )}
      {showBody && (
      <div id="player-chapter-sidebar-body" className="chapter-sidebar-body-panel">
        <div ref={listRef} className="chapter-sidebar-list" role="listbox" aria-label="Chapter list">
          {chapters.map((ch, i) => (
            <button
              key={ch.id ?? `${ch.title}-${i}`}
              ref={(el) => {
                buttonRefs.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={activeChapter === i}
              aria-current={activeChapter === i ? "true" : undefined}
              tabIndex={collapsed ? -1 : getTabIndex(i)}
              className={`chapter-sidebar-item ${activeChapter === i ? "active" : ""}`}
              onClick={() => onSelect(i)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" ||
                  e.key === " " ||
                  e.key.startsWith("Arrow") ||
                  e.key === "Home" ||
                  e.key === "End"
                ) {
                  e.stopPropagation();
                }
                onKeyDown(e, i);
              }}
            >
              <span className="chapter-sidebar-title">{ch.title}</span>
              <span className="chapter-sidebar-duration">{formatTime(ch.duration_ms ?? 0)}</span>
            </button>
          ))}
        </div>
        <p className="chapter-sidebar-hint">
          <span className="chapter-sidebar-hint-line">Press Enter to jump to a chapter.</span>
          <span className="chapter-sidebar-hint-line">Use arrow keys to move.</span>
        </p>
      </div>
      )}
    </aside>
  );
}
