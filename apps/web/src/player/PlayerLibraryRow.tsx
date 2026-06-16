import { memo, useCallback } from "react";
import { revealInExplorer } from "../bridge/tauri";
import AudiobookSelector from "./AudiobookSelector";
import { usePlayerLibrary } from "./PlayerContext";

function PlayerLibraryRow() {
  const { items, selected, projectFolder, loadItem, refreshLibrary } = usePlayerLibrary();

  const onSelect = useCallback((item: (typeof items)[number]) => {
    void loadItem(item);
  }, [loadItem]);

  const onRevealFolder = useCallback(() => {
    if (!projectFolder) return;
    void revealInExplorer(projectFolder).catch((err: unknown) => {
      console.error(err);
    });
  }, [projectFolder]);

  const onRefresh = useCallback(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  return (
    <AudiobookSelector
      items={items}
      selectedPath={selected?.audio_path ?? ""}
      projectFolder={projectFolder}
      onSelect={onSelect}
      onRevealFolder={onRevealFolder}
      onRefresh={onRefresh}
    />
  );
}

export default memo(PlayerLibraryRow);
