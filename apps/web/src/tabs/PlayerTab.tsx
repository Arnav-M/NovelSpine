import { useEffect, useRef, useState, type CSSProperties } from "react";
import KeyboardShortcutsModal from "../components/KeyboardShortcutsModal";
import { baseName } from "../lib/files";
import ChapterPanel from "../player/ChapterPanel";
import BookReaderPanel from "../player/BookReaderPanel";
import PanelResizeHandle from "../player/PanelResizeHandle";
import PlayerLibraryRow from "../player/PlayerLibraryRow";
import { usePlayerLibrary, usePlayerPlayback } from "../player/PlayerContext";
import PlayerStage from "../player/PlayerStage";
import { usePlayerColumnWidths } from "../player/usePlayerColumnWidths";

const DESKTOP_BREAKPOINT = "(min-width: 900px)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : true,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(target.closest(".chapter-sidebar, .reader-sidebar, [role='dialog']"));
}

interface PlayerTabProps {
  onOpenDocument?: () => void;
}

function PlayerChaptersOverlay() {
  const { chapters, activeChapter, seekChapter } = usePlayerPlayback();

  if (!chapters.length) return null;

  return (
    <ChapterPanel
      chapters={chapters}
      activeChapter={activeChapter}
      open
      onSelect={(i) => void seekChapter(i)}
    />
  );
}

function PlayerKeyboardHandler({ onOpenShortcuts }: { onOpenShortcuts: () => void }) {
  const { togglePlay, skipSeconds, seekChapter, activeChapter } = usePlayerPlayback();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        onOpenShortcuts();
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        void togglePlay();
        return;
      }

      if (e.key === "ArrowLeft" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        skipSeconds(-10);
        return;
      }

      if (e.key === "ArrowRight" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        skipSeconds(10);
        return;
      }

      if (e.key === "[") {
        e.preventDefault();
        void seekChapter(activeChapter - 1);
        return;
      }

      if (e.key === "]") {
        e.preventDefault();
        void seekChapter(activeChapter + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeChapter, onOpenShortcuts, seekChapter, skipSeconds, togglePlay]);

  return null;
}

function PlayerMobileFooter({
  chaptersOpen,
  chapterCount,
  onToggleChapters,
}: {
  chaptersOpen: boolean;
  chapterCount: number;
  onToggleChapters: () => void;
}) {
  return (
    <div className="player-footer">
      <button
        type="button"
        className={`btn btn-ghost ${chaptersOpen ? "active" : ""}`}
        disabled={!chapterCount}
        aria-label={chaptersOpen ? "Hide chapter list" : "Show chapter list"}
        aria-expanded={chaptersOpen}
        onClick={onToggleChapters}
      >
        ☰ Chapters
      </button>
    </div>
  );
}

export default function PlayerTab({ onOpenDocument }: PlayerTabProps) {
  const {
    projectFolder,
    chapterCount,
    chaptersSidebarOpen,
    readerSidebarOpen,
    chaptersOpenMobile,
    setChaptersOpenMobile,
    toggleChaptersSidebar,
    toggleReaderSidebar,
    toggleChaptersMobile,
  } = usePlayerLibrary();
  const isWide = useMediaQuery(DESKTOP_BREAKPOINT);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const chaptersVisible = isWide || chaptersOpenMobile;
  const libraryLabel = projectFolder ? baseName(projectFolder) : "";

  useEffect(() => {
    if (isWide) setChaptersOpenMobile(false);
  }, [isWide, setChaptersOpenMobile]);

  return (
    <div
      className={`tab-panel player-tab ${chaptersVisible ? "chapters-open" : ""} ${isWide ? "player-wide" : "player-narrow"} ${chaptersSidebarOpen ? "chapters-sidebar-open" : "chapters-sidebar-collapsed"} ${readerSidebarOpen ? "reader-sidebar-open" : "reader-sidebar-collapsed"}`}
    >
      <PlayerKeyboardHandler onOpenShortcuts={() => setShortcutsOpen(true)} />

      <div className="player-library-header-row">
        {projectFolder ? (
          <h2 className="player-library-header">
            <span className="player-library-header-label">Library</span>
            <span className="player-library-header-name">{libraryLabel}</span>
          </h2>
        ) : (
          <p id="player-library-hint" className="player-library-header player-library-header-hint">
            {onOpenDocument ? (
              <>
                Set the library folder on the{" "}
                <button type="button" className="btn-link" onClick={onOpenDocument}>
                  Create tab
                </button>{" "}
                to scan for audiobooks.
              </>
            ) : (
              "Set the library folder on the Create tab to scan for audiobooks."
            )}
          </p>
        )}
        <button
          type="button"
          className="btn btn-ghost player-shortcuts-btn"
          aria-label="Keyboard shortcuts help"
          onClick={() => setShortcutsOpen(true)}
        >
          ? Shortcuts
        </button>
      </div>

      <PlayerMainRow
        isWide={isWide}
        chapterCount={chapterCount}
        chaptersSidebarOpen={chaptersSidebarOpen}
        readerSidebarOpen={readerSidebarOpen}
        chaptersOpenMobile={chaptersOpenMobile}
        showChaptersToggle={!isWide}
        onToggleChaptersSidebar={toggleChaptersSidebar}
        onToggleReaderSidebar={toggleReaderSidebar}
        onToggleChaptersMobile={toggleChaptersMobile}
      />

      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function PlayerMainRow({
  isWide,
  chapterCount,
  chaptersSidebarOpen,
  readerSidebarOpen,
  chaptersOpenMobile,
  showChaptersToggle,
  onToggleChaptersSidebar,
  onToggleReaderSidebar,
  onToggleChaptersMobile,
}: {
  isWide: boolean;
  chapterCount: number;
  chaptersSidebarOpen: boolean;
  readerSidebarOpen: boolean;
  chaptersOpenMobile: boolean;
  showChaptersToggle: boolean;
  onToggleChaptersSidebar: () => void;
  onToggleReaderSidebar: () => void;
  onToggleChaptersMobile: () => void;
}) {
  const { readerMarkdownPath, selected } = usePlayerLibrary();
  const { chapters, activeChapter, chapterTitle, chapterMs, chapterDurationMs, speed, seekChapter } =
    usePlayerPlayback();
  const chaptersVisible = isWide || chaptersOpenMobile;
  const gridRef = useRef<HTMLDivElement>(null);
  const { widths, resizing, beginResize, minCenterWidth } = usePlayerColumnWidths({
    gridRef,
    chaptersSidebarOpen,
    readerSidebarOpen,
  });
  const columnStyle = {
    "--player-chapters-width": `${widths.chapters}px`,
    "--player-reader-width": `${widths.reader}px`,
    "--player-center-min-width": `${minCenterWidth}px`,
  } as CSSProperties;
  const showChapterResize = chaptersSidebarOpen;
  const showReaderResize = readerSidebarOpen;
  const sidecarChapter = chapters[activeChapter];

  if (isWide) {
    const gridClass = ["player-main-grid", resizing ? "player-main-grid--resizing" : ""]
      .filter(Boolean)
      .join(" ");

    return (
      <div ref={gridRef} className={gridClass} style={columnStyle}>
        <div
          className={`player-grid-col player-grid-col--chapters${chaptersSidebarOpen ? "" : " is-collapsed"}`}
        >
          <div className="player-grid-col-header">
            <ChapterPanel
              part="header"
              chapters={chapters}
              activeChapter={activeChapter}
              open
              collapsed={!chaptersSidebarOpen}
              onToggleCollapse={onToggleChaptersSidebar}
              onSelect={(i) => void seekChapter(i)}
            />
          </div>
          {chaptersSidebarOpen && (
            <div className="player-grid-col-body">
              <ChapterPanel
                part="body"
                chapters={chapters}
                activeChapter={activeChapter}
                open
                onSelect={(i) => void seekChapter(i)}
              />
            </div>
          )}
        </div>

        {showChapterResize && (
          <PanelResizeHandle
            className="player-grid-resize player-grid-resize--chapters"
            label="Resize chapters panel"
            active={resizing === "chapters"}
            onDragStart={(clientX) => beginResize("chapters", clientX)}
          />
        )}

        <div className="player-grid-col player-grid-col--center">
          <div className="player-grid-col-header">
            <div className="player-library-row">
              <PlayerLibraryRow />
            </div>
          </div>
          <div className="player-grid-col-body">
            <PlayerStage />
          </div>
        </div>

        {showReaderResize && (
          <PanelResizeHandle
            className="player-grid-resize player-grid-resize--reader"
            label="Resize reading panel and player width"
            active={resizing === "reader"}
            onDragStart={(clientX) => beginResize("reader", clientX)}
          />
        )}

        <div
          className={`player-grid-col player-grid-col--reader${readerSidebarOpen ? "" : " is-collapsed"}`}
        >
          <div className="player-grid-col-header">
            <BookReaderPanel
              part="header"
              markdownPath={readerMarkdownPath}
              audioPath={selected?.audio_path ?? null}
              chapterId={sidecarChapter?.id ?? null}
              activeChapter={activeChapter}
              chapterTitle={chapterTitle}
              chapterMs={chapterMs}
              chapterDurationMs={chapterDurationMs}
              playbackSpeed={speed}
              collapsed={!readerSidebarOpen}
              onToggleCollapse={onToggleReaderSidebar}
            />
          </div>
          {readerSidebarOpen && (
            <div className="player-grid-col-body">
              <BookReaderPanel
                part="body"
                markdownPath={readerMarkdownPath}
                audioPath={selected?.audio_path ?? null}
                chapterId={sidecarChapter?.id ?? null}
                activeChapter={activeChapter}
                chapterTitle={chapterTitle}
                chapterMs={chapterMs}
                chapterDurationMs={chapterDurationMs}
                playbackSpeed={speed}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`player-main-row ${chaptersVisible ? "chapters-open" : ""}${resizing ? " player-main-row--resizing" : ""}`}
      style={columnStyle}
    >
      {chaptersVisible && <PlayerChaptersOverlay />}

      <div className="player-content">
        <div className="player-library-row">
          <PlayerLibraryRow />
        </div>
        <PlayerStage />
        {showChaptersToggle && (
          <PlayerMobileFooter
            chaptersOpen={chaptersOpenMobile}
            chapterCount={chapterCount}
            onToggleChapters={onToggleChaptersMobile}
          />
        )}
      </div>
    </div>
  );
}
