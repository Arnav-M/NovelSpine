import { isTauri as checkIsTauri } from "@tauri-apps/api/core";

export function isTauri(): boolean {
  return checkIsTauri();
}

function normalizeDialogSelection(selected: string | string[] | null): string | null {
  if (selected === null) return null;
  if (Array.isArray(selected)) return selected[0] ?? null;
  return selected;
}

export async function pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    filters,
  });
  return normalizeDialogSelection(selected);
}

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: defaultPath?.trim() || undefined,
    });
    return normalizeDialogSelection(selected);
  }

  const { pickFolderDialog } = await import("../api/client");
  return pickFolderDialog();
}

export async function revealInExplorer(path: string): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error("No path to reveal.");
  }
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("reveal_in_explorer", { path: trimmed });
    return;
  }
  throw new Error("Reveal in Explorer is available in the desktop app.");
}

export async function openPath(path: string): Promise<void> {
  await openPathWithApp(path);
}

/** Show the system "Open with" picker (Windows) or open with the default app. */
export async function openPathWithApp(path: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("open_with_app", { path });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message || "Could not open the audiobook file.");
    }
    return;
  }
  const { API_BASE } = await import("../api/client");
  window.open(`${API_BASE}/media?path=${encodeURIComponent(path)}`, "_blank");
}

export async function toAssetUrl(path: string | null | undefined): Promise<string | null> {
  const { resolveMediaUrl } = await import("../lib/files");
  return resolveMediaUrl(path);
}
