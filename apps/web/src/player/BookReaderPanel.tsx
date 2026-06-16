import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getChapterText } from "../api/client";
import { usePlayerPlayback } from "./PlayerContext";
import { lineSeekMs, readerLineState } from "./readerTiming";
import { ReadingPanelIcon } from "./SidebarPanelIcons";
import { useReaderPanelState } from "./useReaderPanelState";

interface Props {
  markdownPath: string | null;
  audioPath: string | null;
  chapterId: string | null;
  activeChapter: number;
  chapterTitle: string;
  chapterMs: number;
  chapterDurationMs: number;
  playbackSpeed?: number;
  collapsed?: boolean;
  part?: "all" | "header" | "body";
  onToggleCollapse?: () => void;
}

function BookReaderPanel({
  markdownPath,
  audioPath,
  chapterId,
  activeChapter,
  chapterTitle,
  chapterMs,
  chapterDurationMs,
  playbackSpeed = 1,
  collapsed = false,
  part = "all",
  onToggleCollapse,
}: Props) {
  const { seekChapter } = usePlayerPlayback();
  const { displayMode, followPlayback, setDisplayMode, setFollowPlayback } =
    useReaderPanelState(activeChapter);
  const listRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const followPlaybackRef = useRef(followPlayback);
  const ignoreUserScrollUntilRef = useRef(0);
  const [lines, setLines] = useState<string[]>([]);
  const [lineWeights, setLineWeights] = useState<number[]>([]);
  const [lineStartMs, setLineStartMs] = useState<number[]>([]);
  const [sectionDurationMs, setSectionDurationMs] = useState(0);
  const [sectionTitle, setSectionTitle] = useState("");
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "empty">("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    followPlaybackRef.current = followPlayback;
  }, [followPlayback]);

  useEffect(() => {
    if (!markdownPath) {
      setLines([]);
      setLineWeights([]);
      setLineStartMs([]);
      setSectionDurationMs(0);
      setSectionTitle("");
      setLoadError(null);
      setLoadState("idle");
      return;
    }

    let cancelled = false;
    setLoadState("loading");
    setLoadError(null);

    void getChapterText(markdownPath, activeChapter, chapterTitle || undefined, {
      audioPath,
      chapterId,
    })
      .then((data) => {
        if (cancelled) return;
        setSectionTitle(data.title);
        setLines(data.lines);
        setLineWeights(
          data.line_weights?.length === data.lines.length
            ? data.line_weights
            : data.lines.map((line) => Math.max(line.split(/\s+/).filter(Boolean).length, 1)),
        );
        setLineStartMs(
          data.line_start_ms?.length === data.lines.length ? data.line_start_ms : [],
        );
        setSectionDurationMs(data.section_duration_ms ?? 0);
        setLoadState(data.lines.length > 0 ? "ready" : "empty");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLines([]);
        setLineWeights([]);
        setLineStartMs([]);
        setSectionDurationMs(0);
        setSectionTitle(chapterTitle);
        setLoadError(err instanceof Error ? err.message : "Could not load chapter text.");
        setLoadState("empty");
      });

    return () => {
      cancelled = true;
    };
  }, [activeChapter, audioPath, chapterId, chapterTitle, markdownPath]);

  useEffect(() => {
    lineRefs.current.length = lines.length;
  }, [lines.length]);

  const { index: currentLine, lineProgress } = useMemo(
    () =>
      readerLineState(lineWeights, lineStartMs, chapterMs, chapterDurationMs, {
        playbackSpeed,
        sectionDurationMs,
      }),
    [chapterDurationMs, chapterMs, lineStartMs, lineWeights, playbackSpeed, sectionDurationMs],
  );

  const markProgrammaticScroll = useCallback(() => {
    // Grace period covers layout reflow after line reveal in follow mode.
    ignoreUserScrollUntilRef.current = Date.now() + 350;
  }, []);

  const scrollToActiveLine = useCallback(() => {
    if (currentLine < 0) return;
    const el = lineRefs.current[currentLine];
    const list = listRef.current;
    if (!el || !list) return;
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const viewTop = list.scrollTop;
    const viewBottom = viewTop + list.clientHeight;
    let nextScrollTop: number | null = null;
    if (elTop < viewTop + list.clientHeight * 0.3) {
      nextScrollTop = Math.max(0, elTop - list.clientHeight * 0.38);
    } else if (elBottom > viewBottom - list.clientHeight * 0.3) {
      nextScrollTop = elBottom - list.clientHeight * 0.62;
    }
    if (nextScrollTop == null) return;
    markProgrammaticScroll();
    list.scrollTop = nextScrollTop;
  }, [currentLine, markProgrammaticScroll]);

  useEffect(() => {
    if (collapsed || !followPlayback) return;
    scrollToActiveLine();
  }, [collapsed, currentLine, followPlayback, scrollToActiveLine]);

  const handleListScroll = useCallback(() => {
    if (Date.now() < ignoreUserScrollUntilRef.current) return;
    if (!followPlaybackRef.current) return;
    setFollowPlayback(false);
  }, [setFollowPlayback]);

  const handleLineClick = useCallback(
    (lineIndex: number) => {
      const ms = lineSeekMs(lineIndex, lineWeights, lineStartMs, chapterDurationMs, {
        playbackSpeed,
        sectionDurationMs,
      });
      void seekChapter(activeChapter, ms);
      markProgrammaticScroll();
      setFollowPlayback(true);
    },
    [
      activeChapter,
      chapterDurationMs,
      lineStartMs,
      lineWeights,
      markProgrammaticScroll,
      playbackSpeed,
      sectionDurationMs,
      seekChapter,
      setFollowPlayback,
    ],
  );

  const visibleLineCount =
    displayMode === "browse"
      ? lines.length
      : currentLine >= 0
        ? Math.min(lines.length, currentLine + 3)
        : lines.length > 0
          ? 1
          : 0;

  const showHeader = part === "all" || part === "header";
  const showBody = (part === "all" || part === "body") && !collapsed;

  return (
    <aside
      className={`reader-sidebar ${collapsed ? "reader-sidebar--collapsed" : ""}${part !== "all" ? ` reader-sidebar--${part}` : ""}`}
      aria-label="Book reader"
    >
      {showHeader && (
      <div className="reader-sidebar-header-panel">
        <div className="reader-sidebar-topbar">
          {onToggleCollapse && (
            <button
              type="button"
              className="reader-sidebar-notch"
              aria-expanded={!collapsed}
              aria-controls="player-reader-sidebar-body"
              aria-label={collapsed ? "Show reading panel" : "Hide reading panel"}
              title={collapsed ? "Show reading panel" : "Hide reading panel"}
              onClick={onToggleCollapse}
            >
              {collapsed ? (
                <ReadingPanelIcon className="sidebar-notch-glyph" />
              ) : (
                <span
                  className="reader-sidebar-notch-icon reader-sidebar-notch-icon--open"
                  aria-hidden="true"
                />
              )}
            </button>
          )}
          <div className="reader-sidebar-header">
            <strong>Reading</strong>
            {loadState === "ready" && (
              <div className="reader-sidebar-header-actions">
                <button
                  type="button"
                  className={`reader-sidebar-mode-btn${displayMode === "browse" ? " reader-sidebar-mode-btn--active" : ""}`}
                  aria-pressed={displayMode === "browse"}
                  title={
                    displayMode === "browse"
                      ? "Showing full chapter — switch to follow-along reveal"
                      : "Show full chapter text"
                  }
                  onClick={() =>
                    setDisplayMode((mode) => (mode === "follow" ? "browse" : "follow"))
                  }
                >
                  {displayMode === "browse" ? "Follow" : "Full"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      )}
      {showBody && (
      <div id="player-reader-sidebar-body" className="reader-sidebar-body-panel">
        {sectionTitle && loadState === "ready" && (
          <div className="reader-sidebar-chapter-bar" title={sectionTitle}>
            {sectionTitle}
          </div>
        )}
        <div ref={listRef} className="reader-sidebar-list" onScroll={handleListScroll}>
          {loadState === "idle" && (
            <p className="reader-sidebar-placeholder">Load an audiobook to follow along.</p>
          )}
          {loadState === "loading" && (
            <p className="reader-sidebar-placeholder">Loading text…</p>
          )}
          {loadState === "empty" && (
            <p className="reader-sidebar-placeholder">
              {loadError ??
                (markdownPath
                  ? "No readable text for this chapter."
                  : "No markdown linked to this book.")}
            </p>
          )}
          {loadState === "ready" && (
            <div
              className="reader-sidebar-lines"
              role="doc-subtitle"
              aria-live="polite"
              aria-atomic="false"
            >
              {lines.slice(0, visibleLineCount).map((line, i) => {
                const isActive = i === currentLine;
                const isPast = currentLine >= 0 && i < currentLine;
                const isUpcoming = currentLine >= 0 && i > currentLine;
                const isAnnouncement = i === 0 && /^chapter\b/i.test(line);
                return (
                  <div
                    key={`${activeChapter}-${i}-${line.slice(0, 24)}`}
                    ref={(el) => {
                      lineRefs.current[i] = el;
                    }}
                    role="button"
                    tabIndex={0}
                    className={`reader-sidebar-line-row${isActive ? " reader-sidebar-line-row--active" : ""}${isPast ? " reader-sidebar-line-row--past" : ""}${isUpcoming ? " reader-sidebar-line-row--upcoming" : ""}${isAnnouncement ? " reader-sidebar-line-row--announcement" : ""}`}
                    aria-current={isActive ? "true" : undefined}
                    title="Click to seek to this line"
                    onClick={() => handleLineClick(i)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleLineClick(i);
                      }
                    }}
                  >
                    <span className="reader-sidebar-line-marker" aria-hidden="true" />
                    <div className="reader-sidebar-line-content">
                      <p className="reader-sidebar-line">{line}</p>
                      {isActive && (
                        <div
                          className="reader-sidebar-line-progress"
                          style={{ width: `${Math.round(lineProgress * 100)}%` }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <p className="reader-sidebar-hint">
          {!followPlayback && loadState === "ready" ? (
            <button
              type="button"
              className="reader-sidebar-resume-follow"
              onClick={() => {
                setFollowPlayback(true);
              }}
            >
              Resume follow
            </button>
          ) : (
            <>
              <span className="reader-sidebar-hint-line">Highlighted line tracks playback.</span>
              {displayMode === "browse" && (
                <span className="reader-sidebar-hint-line">Click a line to seek audio.</span>
              )}
            </>
          )}
        </p>
      </div>
      )}
    </aside>
  );
}

export default memo(BookReaderPanel);
