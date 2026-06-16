import { useCallback, useEffect, useSyncExternalStore } from "react";

export type ReaderDisplayMode = "follow" | "browse";

type ReaderPanelStore = {
  displayMode: ReaderDisplayMode;
  followPlayback: boolean;
};

let store: ReaderPanelStore = {
  displayMode: "follow",
  followPlayback: true,
};

let lastActiveChapter = -1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ReaderPanelStore {
  return store;
}

export function useReaderPanelState(activeChapter: number) {
  const { displayMode, followPlayback } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  useEffect(() => {
    if (lastActiveChapter !== activeChapter) {
      lastActiveChapter = activeChapter;
      store = { ...store, followPlayback: true };
      emit();
    }
  }, [activeChapter]);

  const setDisplayMode = useCallback(
    (mode: ReaderDisplayMode | ((prev: ReaderDisplayMode) => ReaderDisplayMode)) => {
      store = {
        ...store,
        displayMode: typeof mode === "function" ? mode(store.displayMode) : mode,
      };
      emit();
    },
    [],
  );

  const setFollowPlayback = useCallback((follow: boolean) => {
    store = { ...store, followPlayback: follow };
    emit();
  }, []);

  return { displayMode, followPlayback, setDisplayMode, setFollowPlayback };
}
