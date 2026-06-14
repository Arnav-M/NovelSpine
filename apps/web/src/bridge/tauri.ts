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
  if (!isTauri()) return;
  const { Command } = await import("@tauri-apps/plugin-shell");
  const win = navigator.userAgent.includes("Windows");
  if (win) {
    await Command.create("reveal-item", ["/select,", path]).spawn();
  } else if (navigator.userAgent.includes("Mac")) {
    await Command.create("reveal-item", ["-R", path]).spawn();
  } else {
    await Command.create("reveal-item", [path]).spawn();
  }
}

export async function openPath(path: string): Promise<void> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(path);
    return;
  }
  const { API_BASE } = await import("../api/client");
  window.open(`${API_BASE}/media?path=${encodeURIComponent(path)}`, "_blank");
}

export async function toAssetUrl(path: string | null | undefined): Promise<string | null> {
  const { resolveMediaUrl } = await import("../lib/files");
  return resolveMediaUrl(path);
}
