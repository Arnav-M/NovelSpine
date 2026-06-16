import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import LiveRegion, { type LivePoliteness } from "./LiveRegion";

interface LiveRegionContextValue {
  announce: (message: string, politeness?: LivePoliteness) => void;
}

const LiveRegionContext = createContext<LiveRegionContextValue | null>(null);

export function LiveRegionProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const [politeness, setPoliteness] = useState<LivePoliteness>("polite");
  const announce = useCallback((text: string, mode: LivePoliteness = "polite") => {
    setPoliteness(mode);
    setMessage(text);
  }, []);

  const value = useMemo(() => ({ announce }), [announce]);

  return (
    <LiveRegionContext.Provider value={value}>
      {children}
      <LiveRegion message={message} politeness={politeness} />
    </LiveRegionContext.Provider>
  );
}

export function useLiveRegion() {
  const ctx = useContext(LiveRegionContext);
  if (!ctx) {
    throw new Error("useLiveRegion must be used within LiveRegionProvider");
  }
  return ctx;
}

/** Throttle progress announcements to avoid spamming the screen reader. */
export function useThrottledProgressAnnounce() {
  const { announce } = useLiveRegion();
  const lastRef = useRef("");

  return useCallback(
    (title: string, percent: number) => {
      const bucket = Math.floor(percent / 10) * 10;
      const key = `${title}:${bucket}`;
      if (key === lastRef.current) return;
      lastRef.current = key;
      announce(`${title}, ${bucket} percent complete.`);
    },
    [announce],
  );
}
