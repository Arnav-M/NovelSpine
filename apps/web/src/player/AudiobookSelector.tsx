import { memo } from "react";
import type { LibraryItem } from "../api/client";
import { pathsEqual } from "../lib/files";

interface Props {
  items: LibraryItem[];
  selectedPath: string;
  projectFolder: string;
  onSelect: (item: LibraryItem) => void;
  onRevealFolder: () => void;
  onRefresh: () => void;
}

function AudiobookSelector({
  items,
  selectedPath,
  projectFolder,
  onSelect,
  onRevealFolder,
  onRefresh,
}: Props) {
  const comboValue = items.some((item) => pathsEqual(item.audio_path, selectedPath))
    ? selectedPath
    : "";

  return (
    <div className="player-library-bar">
      <div className="library-bar-unified">
        <label className="sr-only" htmlFor="player-audiobook-select">
          Select audiobook
        </label>
        <select
          id="player-audiobook-select"
          className="library-combo"
          aria-label="Select audiobook"
          value={comboValue}
          onChange={(e) => {
            const item = items.find((i) => pathsEqual(i.audio_path, e.target.value));
            if (item) onSelect(item);
          }}
        >
          <option value="">Select audiobook…</option>
          {items.map((item) => (
            <option key={item.audio_path} value={item.audio_path}>
              {item.label}
            </option>
          ))}
        </select>
        <div className="player-library-bar-actions">
          <button
            type="button"
            className="btn btn-ghost btn-icon library-bar-inline-btn"
            disabled={!projectFolder}
            aria-label="Reveal library folder in Explorer"
            title="Reveal library folder"
            onClick={onRevealFolder}
          >
            ↗
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon library-bar-inline-btn"
            aria-label="Refresh audiobook library"
            title="Refresh library"
            onClick={onRefresh}
          >
            ↻
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(AudiobookSelector, (prev, next) => {
  return (
    prev.selectedPath === next.selectedPath &&
    prev.projectFolder === next.projectFolder &&
    prev.items === next.items &&
    prev.onSelect === next.onSelect &&
    prev.onRevealFolder === next.onRevealFolder &&
    prev.onRefresh === next.onRefresh
  );
});
