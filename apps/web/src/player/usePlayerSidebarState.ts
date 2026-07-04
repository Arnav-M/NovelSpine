import { useCallback, useState } from "react";

const STORAGE_KEY = "novelspine.player.sidebarState";

export interface PlayerSidebarState {
  chaptersOpen: boolean;
  readerOpen: boolean;
  chaptersOpenMobile: boolean;
}

const DEFAULT_STATE: PlayerSidebarState = {
  chaptersOpen: true,
  readerOpen: true,
  chaptersOpenMobile: true,
};

function readStoredSidebarState(): PlayerSidebarState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const data = JSON.parse(raw) as Partial<PlayerSidebarState>;
    return {
      chaptersOpen: data.chaptersOpen !== false,
      readerOpen: data.readerOpen !== false,
      chaptersOpenMobile: data.chaptersOpenMobile !== false,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function persistSidebarState(state: PlayerSidebarState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota errors */
  }
}

export function usePlayerSidebarState() {
  const [state, setState] = useState<PlayerSidebarState>(readStoredSidebarState);

  const setChaptersOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setState((prev) => {
      const chaptersOpen = typeof next === "function" ? next(prev.chaptersOpen) : next;
      if (chaptersOpen === prev.chaptersOpen) return prev;
      const updated = { ...prev, chaptersOpen };
      persistSidebarState(updated);
      return updated;
    });
  }, []);

  const setReaderOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setState((prev) => {
      const readerOpen = typeof next === "function" ? next(prev.readerOpen) : next;
      if (readerOpen === prev.readerOpen) return prev;
      const updated = { ...prev, readerOpen };
      persistSidebarState(updated);
      return updated;
    });
  }, []);

  const setChaptersOpenMobile = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setState((prev) => {
      const chaptersOpenMobile = typeof next === "function" ? next(prev.chaptersOpenMobile) : next;
      if (chaptersOpenMobile === prev.chaptersOpenMobile) return prev;
      const updated = { ...prev, chaptersOpenMobile };
      persistSidebarState(updated);
      return updated;
    });
  }, []);

  const toggleChapters = useCallback(() => {
    setChaptersOpen((open) => !open);
  }, [setChaptersOpen]);

  const toggleReader = useCallback(() => {
    setReaderOpen((open) => !open);
  }, [setReaderOpen]);

  const toggleChaptersMobile = useCallback(() => {
    setChaptersOpenMobile((open) => !open);
  }, [setChaptersOpenMobile]);

  return {
    chaptersSidebarOpen: state.chaptersOpen,
    readerSidebarOpen: state.readerOpen,
    chaptersOpenMobile: state.chaptersOpenMobile,
    setChaptersSidebarOpen: setChaptersOpen,
    setReaderSidebarOpen: setReaderOpen,
    setChaptersOpenMobile,
    toggleChaptersSidebar: toggleChapters,
    toggleReaderSidebar: toggleReader,
    toggleChaptersMobile,
  };
}
