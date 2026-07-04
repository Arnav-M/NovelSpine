import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const STORAGE_KEY = "novelspine.player.columnWidths";
export const DEFAULT_CHAPTERS_WIDTH = 260;
export const DEFAULT_READER_WIDTH = 260;
/** Matches `--player-content-width` in styles.css — keeps book progress fully visible. */
export const MIN_PLAYER_CENTER_WIDTH = 820;
export const MAX_CHAPTERS_WIDTH = 560;
export const MAX_READER_WIDTH = 1600;
export const PLAYER_RESIZE_COL_WIDTH = 12;
export const PLAYER_SIDEBAR_NOTCH_WIDTH = 16;
export const PLAYER_SIDEBAR_COLLAPSED_NOTCH_WIDTH = 26;
export const PLAYER_SIDEBAR_COLLAPSED_GAP = 8;
export const PLAYER_SIDEBAR_COLLAPSED_WIDTH =
  PLAYER_SIDEBAR_COLLAPSED_NOTCH_WIDTH + PLAYER_SIDEBAR_COLLAPSED_GAP;

export interface PlayerColumnWidths {
  chapters: number;
  reader: number;
}

export interface PlayerColumnResizeOptions {
  gridRef: RefObject<HTMLElement | null>;
  chaptersSidebarOpen: boolean;
  readerSidebarOpen: boolean;
}

function readStoredWidths(): PlayerColumnWidths {
  if (typeof window === "undefined") {
    return { chapters: DEFAULT_CHAPTERS_WIDTH, reader: DEFAULT_READER_WIDTH };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { chapters: DEFAULT_CHAPTERS_WIDTH, reader: DEFAULT_READER_WIDTH };
    }
    const data = JSON.parse(raw) as Partial<PlayerColumnWidths>;
    return {
      chapters: clampChaptersWidth(data.chapters ?? DEFAULT_CHAPTERS_WIDTH),
      reader: clampStoredReaderWidth(data.reader ?? DEFAULT_READER_WIDTH),
    };
  } catch {
    return { chapters: DEFAULT_CHAPTERS_WIDTH, reader: DEFAULT_READER_WIDTH };
  }
}

export function clampChaptersWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CHAPTERS_WIDTH;
  return Math.min(MAX_CHAPTERS_WIDTH, Math.max(DEFAULT_CHAPTERS_WIDTH, Math.round(value)));
}

function clampStoredReaderWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_READER_WIDTH;
  return Math.min(MAX_READER_WIDTH, Math.max(DEFAULT_READER_WIDTH, Math.round(value)));
}

export function clampReaderWidth(value: number, maxReaderWidth: number): number {
  const max = Math.max(DEFAULT_READER_WIDTH, maxReaderWidth);
  return Math.min(max, Math.max(DEFAULT_READER_WIDTH, Math.round(value)));
}

function persistWidths(widths: PlayerColumnWidths): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    /* ignore quota errors */
  }
}

function maxReaderWidthForLayout(
  containerWidth: number,
  chaptersSidebarOpen: boolean,
  readerSidebarOpen: boolean,
  chaptersWidth: number,
): number {
  if (containerWidth <= 0) return MAX_READER_WIDTH;

  let reserved = MIN_PLAYER_CENTER_WIDTH;
  if (chaptersSidebarOpen) {
    reserved += chaptersWidth + PLAYER_RESIZE_COL_WIDTH;
  } else {
    reserved += PLAYER_SIDEBAR_COLLAPSED_WIDTH;
  }
  if (readerSidebarOpen) {
    reserved += PLAYER_RESIZE_COL_WIDTH;
  } else {
    reserved += PLAYER_SIDEBAR_COLLAPSED_WIDTH;
  }

  return Math.max(DEFAULT_READER_WIDTH, containerWidth - reserved);
}

export function usePlayerColumnWidths({
  gridRef,
  chaptersSidebarOpen,
  readerSidebarOpen,
}: PlayerColumnResizeOptions) {
  const [widths, setWidths] = useState<PlayerColumnWidths>(readStoredWidths);
  const widthsRef = useRef(widths);
  const [resizing, setResizing] = useState<"chapters" | "reader" | null>(null);
  const resizeOptionsRef = useRef({ chaptersSidebarOpen, readerSidebarOpen });
  const gridRefStable = gridRef;

  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  useEffect(() => {
    resizeOptionsRef.current = { chaptersSidebarOpen, readerSidebarOpen };
  }, [chaptersSidebarOpen, readerSidebarOpen]);

  const measureMaxReaderWidth = useCallback(
    (chaptersWidth = widthsRef.current.chapters) => {
      const container = gridRefStable.current;
      const { chaptersSidebarOpen: chaptersOpen, readerSidebarOpen: readerOpen } =
        resizeOptionsRef.current;
      const containerWidth = container?.getBoundingClientRect().width ?? 0;
      return maxReaderWidthForLayout(
        containerWidth,
        chaptersOpen,
        readerOpen,
        chaptersWidth,
      );
    },
    [gridRefStable],
  );

  const setChaptersWidth = useCallback((next: number) => {
    const chapters = clampChaptersWidth(next);
    setWidths((prev) => {
      if (chapters === prev.chapters) return prev;
      const updated = { chapters, reader: prev.reader };
      persistWidths(updated);
      return updated;
    });
  }, []);

  useEffect(() => {
    const container = gridRefStable.current;
    if (!container) return;

    const clampReaderToLayout = () => {
      const maxReader = measureMaxReaderWidth();
      setWidths((prev) => {
        const reader = clampReaderWidth(prev.reader, maxReader);
        if (reader === prev.reader) return prev;
        const updated = { ...prev, reader };
        persistWidths(updated);
        return updated;
      });
    };

    clampReaderToLayout();
    const ro = new ResizeObserver(clampReaderToLayout);
    ro.observe(container);
    return () => ro.disconnect();
  }, [gridRefStable, measureMaxReaderWidth, chaptersSidebarOpen, readerSidebarOpen, widths.chapters]);

  const beginResize = useCallback(
    (edge: "chapters" | "reader", clientX: number) => {
      const startX = clientX;
      const startWidths = { ...widthsRef.current };
      setResizing(edge);

      const onMove = (event: PointerEvent) => {
        event.preventDefault();
        const delta = event.clientX - startX;
        if (edge === "chapters") {
          setChaptersWidth(startWidths.chapters + delta);
        } else {
          const maxReader = maxReaderWidthForLayout(
            gridRefStable.current?.getBoundingClientRect().width ?? 0,
            resizeOptionsRef.current.chaptersSidebarOpen,
            resizeOptionsRef.current.readerSidebarOpen,
            startWidths.chapters,
          );
          const nextReader = clampReaderWidth(startWidths.reader - delta, maxReader);
          setWidths((prev) => {
            if (nextReader === prev.reader) return prev;
            const updated = { ...prev, reader: nextReader };
            persistWidths(updated);
            return updated;
          });
        }
      };

      const onEnd = () => {
        setResizing(null);
        document.body.classList.remove("player-column-resizing");
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onEnd);
        document.removeEventListener("pointercancel", onEnd);
      };

      document.body.classList.add("player-column-resizing");
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onEnd);
      document.addEventListener("pointercancel", onEnd);
    },
    [gridRefStable, setChaptersWidth],
  );

  return {
    widths,
    resizing,
    beginResize,
    minCenterWidth: MIN_PLAYER_CENTER_WIDTH,
  };
}
