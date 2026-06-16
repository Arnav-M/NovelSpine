import { API_BASE } from "../api/client";
import type { LibraryItem } from "../api/client";
import { isTauri } from "../bridge/tauri";

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function clampSpeed(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0.5, n));
}

export function nearestSpeed(value: unknown): (typeof SPEED_OPTIONS)[number] {
  const n = clampSpeed(value);
  let best: (typeof SPEED_OPTIONS)[number] = 1;
  let diff = Infinity;
  for (const option of SPEED_OPTIONS) {
    const d = Math.abs(option - n);
    if (d < diff) {
      diff = d;
      best = option;
    }
  }
  return best;
}

export function clampVolumePercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 85;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export async function resolveMediaUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  if (isTauri()) {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    return convertFileSrc(path);
  }
  return `${API_BASE}/media?path=${encodeURIComponent(path)}`;
}

export async function resolveSpeedMediaUrl(path: string, speed: number): Promise<string | null> {
  if (!path) return null;
  if (Math.abs(speed - 1) < 0.01) return resolveMediaUrl(path);
  let res: Response;
  try {
    res = await fetch(
      `${API_BASE}/media/speed?path=${encodeURIComponent(path)}&speed=${encodeURIComponent(String(speed))}`,
    );
  } catch (err) {
    throw new Error(
      err instanceof TypeError
        ? "Could not reach Novelflow API — try restarting the app."
        : err instanceof Error
          ? err.message
          : String(err),
    );
  }
  if (!res.ok) {
    throw new Error(`Speed variant failed (${res.status})`);
  }
  const data = (await res.json()) as { path: string };
  return resolveMediaUrl(data.path);
}

export async function stageLocalFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/files/stage`, { method: "POST", body: form });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Upload failed (${res.status})`);
  }
  const data = (await res.json()) as { path: string };
  return data.path;
}

export function pathFromDataTransfer(dataTransfer: DataTransfer): File | null {
  const files = dataTransfer.files;
  if (files.length > 0) return files[0] ?? null;
  return null;
}

export async function resolveDroppedPath(file: File): Promise<string> {
  const electronPath = (file as File & { path?: string }).path;
  if (electronPath && electronPath.includes("\\")) return electronPath;
  if (electronPath && electronPath.includes("/")) return electronPath;
  return stageLocalFile(file);
}

export function parentDir(path: string): string {
  const parts = path.split(/[/\\]/);
  parts.pop();
  if (!parts.length) return "";
  const sep = path.includes("\\") ? "\\" : "/";
  return parts.join(sep);
}

export function pathsEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

export function baseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/** Stable book stem (matches Python ``book_stem``). */
export function bookStem(path: string): string {
  let stem = baseName(path);
  if (stem.includes(".")) stem = stem.slice(0, stem.lastIndexOf("."));
  if (stem.endsWith(".readable")) stem = stem.slice(0, -".readable".length);
  if (stem.includes(".audiobook_")) stem = stem.split(".audiobook_", 1)[0];
  else if (stem.includes(".audiobook")) stem = stem.split(".audiobook", 1)[0];
  return stem;
}

/** Project folder for a PDF, markdown, or audiobook path (matches Python ``project_folder_for``). */
export function projectFolderFor(sourcePath: string): string {
  const trimmed = sourcePath.trim();
  if (!trimmed) return "";
  const sep = trimmed.includes("\\") ? "\\" : "/";
  const parent = parentDir(trimmed);
  const stem = bookStem(trimmed);
  if (!stem) return parent;
  if (parent && baseName(parent) === stem) return parent;
  return parent ? `${parent}${sep}${stem}` : stem;
}

/**
 * Parent library folder for prefs / player scan (contains per-book subfolders).
 * e.g. ``…/Books/Book.pdf`` → ``…/Books/``, not ``…/Books/Book/``.
 */
export function unifiedProjectFolderFor(sourcePath: string): string {
  const bookFolder = projectFolderFor(sourcePath);
  if (!bookFolder) return "";
  const parent = parentDir(bookFolder);
  return parent || bookFolder;
}

/** Human-readable audiobook title (matches Python ``_audiobook_display_name``). */
export function audiobookDisplayName(path: string): string {
  const name = baseName(path);
  const fmt = audioFormatLabel(name);
  if (name.endsWith(".chapters.json")) {
    return audiobookDisplayNameFromStem(name.slice(0, -".chapters.json".length), "");
  }
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  if (name.includes(".audiobook.")) {
    const book = name.split(".audiobook.", 1)[0];
    return formatDisplayTitle(book, fmt);
  }
  return audiobookDisplayNameFromStem(stem, fmt);
}

function audioFormatLabel(name: string): string {
  if (name.endsWith(".chapters.json")) return "";
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function formatDisplayTitle(title: string, fmt: string, variant?: string): string {
  if (variant !== undefined) {
    const parts = fmt ? [variant, fmt] : [variant];
    return `${title} (${parts.join(", ")})`;
  }
  return fmt ? `${title} (${fmt})` : title;
}

function audiobookDisplayNameFromStem(stem: string, fmt: string): string {
  const numbered = stem.match(/^(.+)\.audiobook_(\d+)$/);
  if (numbered) return formatDisplayTitle(numbered[1], fmt, numbered[2]);
  const legacy = stem.match(/^(.+)\.audiobook-(\d+)$/);
  if (legacy) return formatDisplayTitle(legacy[1], fmt, legacy[2]);
  if (stem.endsWith(".audiobook") || stem.includes(".audiobook.")) {
    return formatDisplayTitle(stem.split(".audiobook", 1)[0], fmt);
  }
  return formatDisplayTitle(stem.replace(/\.chapters$/, ""), fmt);
}

/** Prefer the library scan label; fall back to ``audiobookDisplayName``. */
export function libraryLabelForPath(
  items: Pick<LibraryItem, "audio_path" | "label">[],
  audioPath: string,
): string {
  const item = items.find((row) => pathsEqual(row.audio_path, audioPath));
  return item?.label ?? audiobookDisplayName(audioPath);
}

/** Higher = newer numbered rebuild (``.audiobook_2.m4b`` beats ``.audiobook.m4b``). */
export function audiobookVariantRank(path: string): number {
  const name = baseName(path);
  const numbered = name.match(/\.audiobook[_-](\d+)\.[^.]+$/i);
  if (numbered) return Number.parseInt(numbered[1], 10);
  if (/\.audiobook\.[^.]+$/i.test(name)) return 0;
  return -1;
}

/** True for merged audiobook files (not sidecars or markdown). */
export function isMergedAudiobookPath(path: string): boolean {
  return /\.(m4b|mp3|m4a)$/i.test(baseName(path));
}

/** Pick the best library row when several audiobooks share one markdown source. */
export function pickLibraryItemForMarkdown(
  items: LibraryItem[],
  markdownPath: string,
  preferredAudioPath?: string,
): LibraryItem | undefined {
  const matches = items.filter(
    (item) =>
      isMergedAudiobookPath(item.audio_path) &&
      item.markdown_path &&
      pathsEqual(item.markdown_path, markdownPath),
  );
  if (!matches.length) return undefined;
  if (preferredAudioPath) {
    const preferred = matches.find((item) => pathsEqual(item.audio_path, preferredAudioPath));
    if (preferred) return preferred;
  }
  return matches
    .slice()
    .sort((a, b) => audiobookVariantRank(b.audio_path) - audiobookVariantRank(a.audio_path))[0];
}

/** Default readable markdown name for a PDF (matches convert_pdf: `<stem>.readable.md`). */
export function suggestedReadableMarkdownName(sourcePath: string): string {
  const file = baseName(sourcePath);
  if (/\.pdf$/i.test(file)) return file.replace(/\.pdf$/i, ".readable.md");
  const stem = file.includes(".") ? file.slice(0, file.lastIndexOf(".")) : file;
  return `${stem}.readable.md`;
}

export function suggestedReadableMarkdownOutput(sourcePath: string): {
  folder: string;
  fileName: string;
  fullPath: string;
} {
  const folder = parentDir(sourcePath);
  const fileName = suggestedReadableMarkdownName(sourcePath);
  const sep = sourcePath.includes("\\") ? "\\" : "/";
  const fullPath = folder ? `${folder}${sep}${fileName}` : fileName;
  return { folder, fileName, fullPath };
}

/** ``Book/Book.readable.md`` beside ``Book.pdf`` when using project folders. */
export function suggestedProjectFolderOutput(sourcePath: string): {
  folder: string;
  fileName: string;
  fullPath: string;
} {
  const folder = projectFolderFor(sourcePath);
  const stem = bookStem(sourcePath);
  if (!folder || !stem) return { folder: "", fileName: "", fullPath: "" };
  const sep = sourcePath.includes("\\") ? "\\" : "/";
  const fileName = `${stem}.readable.md`;
  return { folder, fileName, fullPath: `${folder}${sep}${fileName}` };
}

export function splitOutputPath(fullPath: string): { folder: string; fileName: string } {
  const trimmed = fullPath.trim();
  if (!trimmed) return { folder: "", fileName: "" };
  const parts = trimmed.split(/[/\\]/);
  const fileName = parts.pop() ?? "";
  const sep = trimmed.includes("\\") ? "\\" : "/";
  return { folder: parts.join(sep), fileName };
}

export function joinOutputPath(folder: string, fileName: string, fallbackFolder = ""): string {
  const name = fileName.trim();
  if (!name) return "";
  const dir = folder.trim() || fallbackFolder.trim();
  if (!dir) return name;
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[/\\]+$/, "")}${sep}${name}`;
}

export { SPEED_OPTIONS };
