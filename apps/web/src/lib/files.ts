import { API_BASE } from "../api/client";
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
  const res = await fetch(
    `${API_BASE}/media/speed?path=${encodeURIComponent(path)}&speed=${encodeURIComponent(String(speed))}`,
  );
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

export function baseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
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
