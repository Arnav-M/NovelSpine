/** Sidecar URL — Vite proxy in browser dev; direct localhost in Tauri (dev + prod). */
function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export const API_BASE =
  isTauriRuntime() || !import.meta.env.DEV
    ? "http://127.0.0.1:8765"
    : "/novelflow-api";

export interface Voice {
  id: string;
  label: string;
  engine: string;
  locale: string;
}

export interface Section {
  id: string;
  title: string;
  kind: string;
  enabled: boolean;
  order: number;
  word_count: number;
}

export interface SectionsResponse {
  book_title: string;
  author: string | null;
  source_markdown: string;
  sections: Section[];
}

export interface LibraryItem {
  label: string;
  audio_path: string;
  markdown_path: string | null;
  cover_path: string | null;
}

export interface Chapter {
  id?: string | null;
  title: string;
  duration_ms: number;
  file: string | null;
  start_ms: number;
}

export interface ChaptersResponse {
  audio_path: string;
  playable_path: string | null;
  chapters: Chapter[];
}

export interface ChapterTextResponse {
  title: string;
  lines: string[];
  line_weights: number[];
  line_start_ms?: number[];
  section_duration_ms?: number;
  announcement_ms?: number;
}

export interface JobStatus {
  job_id: string;
  kind: string;
  state: "pending" | "running" | "done" | "error" | "cancelled";
  progress: number;
  message: string;
}

export interface JobEvent {
  type: string;
  [key: string]: unknown;
}

export type Prefs = Record<string, unknown>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
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
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function healthCheck(): Promise<{ status: string }> {
  return request("/health");
}

export async function pickFolderDialog(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/pick-folder`, { method: "POST" });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Folder picker failed (${res.status})`);
  }
  const data = (await res.json()) as { path: string | null };
  return data.path ?? null;
}

export async function listVoices(engine = "edge"): Promise<Voice[]> {
  return request(`/voices?engine=${encodeURIComponent(engine)}`);
}

export async function getSections(path: string): Promise<SectionsResponse> {
  return request(`/sections?path=${encodeURIComponent(path)}`);
}

export async function getLibrary(root: string): Promise<LibraryItem[]> {
  if (!root.trim()) return [];
  const list = await request<LibraryItem[]>(`/library?root=${encodeURIComponent(root)}`);
  return Array.isArray(list) ? list : [];
}

export async function stageFile(file: File): Promise<{ path: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/files/stage`, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`);
  }
  return res.json() as Promise<{ path: string }>;
}

export async function getChapters(path: string, probe = true): Promise<ChaptersResponse> {
  return request(
    `/chapters?path=${encodeURIComponent(path)}&probe=${probe ? "true" : "false"}`,
  );
}

export async function getChapterText(
  markdownPath: string,
  chapterIndex: number,
  chapterTitle?: string,
  options?: {
    audioPath?: string | null;
    chapterId?: string | null;
  },
): Promise<ChapterTextResponse> {
  let url = `/reader/chapter-text?markdown_path=${encodeURIComponent(markdownPath)}&chapter_index=${chapterIndex}`;
  if (chapterTitle) {
    url += `&chapter_title=${encodeURIComponent(chapterTitle)}`;
  }
  if (options?.audioPath) {
    url += `&audio_path=${encodeURIComponent(options.audioPath)}`;
  }
  if (options?.chapterId) {
    url += `&chapter_id=${encodeURIComponent(options.chapterId)}`;
  }
  return request<ChapterTextResponse>(url);
}

export async function getMediaSpeedPath(path: string, speed: number): Promise<{ path: string }> {
  return request(
    `/media/speed?path=${encodeURIComponent(path)}&speed=${encodeURIComponent(String(speed))}`,
  );
}

export async function getCover(
  path: string,
  markdownPath?: string | null,
): Promise<{ cover_path: string | null }> {
  let url = `/cover?path=${encodeURIComponent(path)}`;
  if (markdownPath) {
    url += `&markdown_path=${encodeURIComponent(markdownPath)}`;
  }
  return request(url);
}

export async function getPrefs(): Promise<{ data: Prefs }> {
  return request("/prefs");
}

export async function savePrefs(data: Prefs): Promise<{ data: Prefs }> {
  return request("/prefs", { method: "PUT", body: JSON.stringify({ data }) });
}

export async function getResume(): Promise<Record<string, unknown>> {
  const data = await request<Record<string, unknown> | null>("/resume");
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

export async function saveResume(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request("/resume", { method: "PUT", body: JSON.stringify(data) });
}

export interface ConvertJobRequest {
  pdf_path: string;
  output_path?: string | null;
  keep_raw?: boolean;
  use_project_folder?: boolean;
}

export interface AudiobookJobRequest {
  source_path: string;
  markdown_path?: string | null;
  output_path?: string | null;
  use_existing_md?: boolean;
  engine?: string;
  voice?: string | null;
  audio_format?: "m4b" | "mp3" | "m4a";
  disabled_section_ids?: string[];
  chapters_and_title_only?: boolean;
  use_project_folder?: boolean;
  audiobook_only?: boolean;
}

export async function startConvert(body: ConvertJobRequest): Promise<{ job_id: string }> {
  return request("/jobs/convert", { method: "POST", body: JSON.stringify(body) });
}

export async function startAudiobook(body: AudiobookJobRequest): Promise<{ job_id: string }> {
  return request("/jobs/audiobook", { method: "POST", body: JSON.stringify(body) });
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  return request(`/jobs/${encodeURIComponent(jobId)}`);
}

export async function cancelJob(jobId: string): Promise<{ cancelled: boolean }> {
  return request(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
}

export async function previewVoice(voice: string, engine = "edge"): Promise<{ preview_path: string }> {
  return request(
    `/preview-voice?voice=${encodeURIComponent(voice)}&engine=${encodeURIComponent(engine)}`,
    { method: "POST" },
  );
}

export function subscribeJobEvents(
  jobId: string,
  handlers: {
    onEvent?: (event: JobEvent) => void;
    onError?: (error: Error) => void;
    onEnd?: () => void;
  },
): () => void {
  const source = new EventSource(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/events`);

  source.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data) as JobEvent;
      handlers.onEvent?.(event);
      if (event.type === "end") {
        handlers.onEnd?.();
        source.close();
      }
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  source.onerror = () => {
    handlers.onError?.(new Error("Job event stream disconnected."));
    source.close();
  };

  return () => source.close();
}
