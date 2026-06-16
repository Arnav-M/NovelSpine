import { useCallback, useEffect, useState } from "react";

interface Options {
  itemCount: number;
  activeIndex: number;
  orientation?: "horizontal" | "vertical";
  loop?: boolean;
  /** When false, activeIndex changes do not move roving focus (e.g. chapter list during playback). */
  syncActiveIndex?: boolean;
  onActivate?: (index: number) => void;
}

/** Roving tabindex + arrow keys for tab lists and menus. */
export function useRovingTabIndex({
  itemCount,
  activeIndex,
  orientation = "horizontal",
  loop = true,
  syncActiveIndex = true,
  onActivate,
}: Options) {
  const [focusedIndex, setFocusedIndex] = useState(activeIndex);

  useEffect(() => {
    if (syncActiveIndex) setFocusedIndex(activeIndex);
  }, [activeIndex, syncActiveIndex]);

  const getTabIndex = useCallback(
    (index: number) => (index === focusedIndex ? 0 : -1),
    [focusedIndex],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      const prevKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
      const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";

      if (e.key === prevKey || e.key === nextKey) {
        e.preventDefault();
        const delta = e.key === nextKey ? 1 : -1;
        let next = index + delta;
        if (loop) {
          next = (next + itemCount) % itemCount;
        } else {
          next = Math.max(0, Math.min(itemCount - 1, next));
        }
        setFocusedIndex(next);
        onActivate?.(next);
        return;
      }

      if (e.key === "Home") {
        e.preventDefault();
        setFocusedIndex(0);
        onActivate?.(0);
        return;
      }

      if (e.key === "End") {
        e.preventDefault();
        const last = itemCount - 1;
        setFocusedIndex(last);
        onActivate?.(last);
      }
    },
    [itemCount, loop, onActivate, orientation],
  );

  return { focusedIndex, setFocusedIndex, getTabIndex, onKeyDown };
}
