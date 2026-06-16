import { useEffect, useRef, useState } from "react";

export type LivePoliteness = "polite" | "assertive";

interface Props {
  message: string;
  politeness?: LivePoliteness;
}

/** Visually hidden live region for screen reader announcements. */
export default function LiveRegion({ message, politeness = "polite" }: Props) {
  const [announcement, setAnnouncement] = useState("");
  const lastMessage = useRef("");

  useEffect(() => {
    if (!message || message === lastMessage.current) return;
    lastMessage.current = message;
    setAnnouncement("");
    const id = window.requestAnimationFrame(() => {
      setAnnouncement(message);
    });
    return () => window.cancelAnimationFrame(id);
  }, [message]);

  return (
    <div className="sr-only" role="status" aria-live={politeness} aria-atomic="true">
      {announcement}
    </div>
  );
}
