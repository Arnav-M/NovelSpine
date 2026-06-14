import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  healthCheck,
  getPrefs,
  savePrefs,
  subscribeJobEvents,
  cancelJob,
  type JobEvent,
  type Prefs,
} from "./api/client";
import type { LogEntry } from "./components/ActivityLog";
import ProgressFooter, { type ProgressState } from "./components/ProgressFooter";
import SettingsModal from "./components/SettingsModal";
import ToastStack, { type ToastItem } from "./components/ToastStack";
import MiniPlayerBar from "./player/MiniPlayerBar";
import { PlayerProvider } from "./player/PlayerContext";
import AudiobookTab from "./tabs/AudiobookTab";
import DocumentTab from "./tabs/DocumentTab";
import PlayerTab from "./tabs/PlayerTab";

type TabId = "document" | "audiobook" | "player";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "document", label: "Document", icon: "📄" },
  { id: "audiobook", label: "Audiobook", icon: "🎧" },
  { id: "player", label: "Player", icon: "▶" },
];

const IDLE_PROGRESS: ProgressState = {
  title: "Ready",
  message: "Choose a PDF or markdown file to begin.",
  progress: 0,
  tone: "idle",
  busy: false,
};

function formatEta(percent: number, startedMs: number): string {
  if (percent <= 0 || percent >= 100) return "";
  const elapsedSec = (Date.now() - startedMs) / 1000;
  const totalSec = elapsedSec / (percent / 100);
  const remaining = totalSec - elapsedSec;
  if (!Number.isFinite(remaining) || remaining <= 0) return "";
  const m = Math.floor(remaining / 60);
  const s = Math.floor(remaining % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function App() {
  const [tab, setTab] = useState<TabId>("document");
  const [apiOk, setApiOk] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourcePath, setSourcePath] = useState("");
  const [markdownPath, setMarkdownPath] = useState("");
  const [lastAudiobook, setLastAudiobook] = useState("");
  const [progress, setProgress] = useState<ProgressState>(IDLE_PROGRESS);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([
    { id: "boot", text: "Novelflow desktop UI loaded.", tone: "muted" },
  ]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobKind, setActiveJobKind] = useState<"convert" | "audiobook" | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const jobStartRef = useRef<number | null>(null);

  const logCollapsed = prefs.log_collapsed !== false;

  const appendLog = useCallback((text: string, tone: LogEntry["tone"] = "normal") => {
    setLogEntries((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, text, tone }]);
  }, []);

  const pushToast = useCallback((message: string, kind: ToastItem["kind"] = "info") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const clearLog = useCallback(() => {
    setLogEntries([]);
    appendLog("Activity log cleared.", "muted");
  }, [appendLog]);

  const updatePrefs = useCallback(async (patch: Prefs) => {
    const res = await savePrefs({ ...prefs, ...patch });
    setPrefs(res.data);
  }, [prefs]);

  const onLogCollapsedChange = useCallback(
    (collapsed: boolean) => {
      void updatePrefs({ log_collapsed: collapsed });
    },
    [updatePrefs],
  );

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        await healthCheck();
        if (cancelled) return;
        setApiOk(true);
        const res = await getPrefs();
        if (cancelled) return;
        setPrefs(res.data);
        appendLog("Connected to Novelflow API.", "muted");
      } catch (err) {
        if (cancelled) return;
        setApiOk(false);
        appendLog(
          `API unavailable: ${err instanceof Error ? err.message : String(err)}. Start the sidecar on port 8765.`,
          "danger",
        );
        pushToast("API offline — start the sidecar on port 8765.", "danger");
      }
    }
    void boot();
    const timer = window.setInterval(() => {
      void healthCheck()
        .then(() => setApiOk(true))
        .catch(() => setApiOk(false));
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [appendLog, pushToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "l") {
        e.preventDefault();
        clearLog();
      }
      if (e.ctrlKey && e.key === "Enter" && tab === "document" && !progress.busy) {
        e.preventDefault();
        document.getElementById("doc-convert-trigger")?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearLog, progress.busy, tab]);

  const handleJobEvent = useCallback(
    (event: JobEvent) => {
      if (event.type === "log" && typeof event.message === "string") {
        appendLog(event.message);
      }
      if (event.type === "progress" && typeof event.percent === "number") {
        const percent = event.percent as number;
        const started = jobStartRef.current;
        setProgress((prev) => ({
          ...prev,
          progress: percent,
          busy: true,
          tone: "running",
          eta: started ? formatEta(percent, started) : undefined,
        }));
      }
      if (event.type === "done") {
        const result = event.result;
        if (typeof result === "string") {
          if (result.toLowerCase().endsWith(".md")) {
            setMarkdownPath(result);
            appendLog(`Markdown ready: ${result}`);
            pushToast("Markdown conversion complete.", "success");
          } else {
            appendLog(`Job finished: ${result}`);
          }
        } else if (result && typeof result === "object") {
          const payload = result as Record<string, unknown>;
          if (typeof payload.markdown_path === "string") {
            setMarkdownPath(payload.markdown_path);
            appendLog(`Markdown ready: ${payload.markdown_path}`);
            pushToast("Markdown conversion complete.", "success");
          }
          if (typeof payload.audiobook_path === "string") {
            setLastAudiobook(payload.audiobook_path);
            appendLog(`Audiobook ready: ${payload.audiobook_path}`);
            pushToast("Audiobook created.", "success");
          }
        }
        setProgress((prev) => ({
          ...prev,
          progress: 100,
          tone: "success",
          busy: false,
          message: prev.message || "Done.",
          eta: undefined,
        }));
        jobStartRef.current = null;
      }
      if (event.type === "state" && typeof event.state === "string") {
        const state = event.state as string;
        if (state === "done") {
          setProgress((prev) => ({
            ...prev,
            progress: 100,
            tone: "success",
            busy: false,
            message: prev.message || "Done.",
            eta: undefined,
          }));
          jobStartRef.current = null;
        } else if (state === "error") {
          const msg = typeof event.message === "string" ? event.message : "Job failed.";
          setProgress((prev) => ({
            ...prev,
            tone: "danger",
            busy: false,
            message: msg,
            eta: undefined,
          }));
          pushToast(msg, "danger");
          jobStartRef.current = null;
        } else if (state === "cancelled") {
          setProgress((prev) => ({
            ...prev,
            tone: "danger",
            busy: false,
            message: "Cancelled.",
            eta: undefined,
          }));
          jobStartRef.current = null;
        }
      }
      if (event.type === "error" && typeof event.message === "string") {
        appendLog(event.message, "danger");
        pushToast(event.message, "danger");
      }
    },
    [appendLog, pushToast],
  );

  const startJobTracking = useCallback(
    (jobId: string, title: string, message: string, kind: "convert" | "audiobook" = "convert") => {
      setActiveJobId(jobId);
      setActiveJobKind(kind);
      jobStartRef.current = Date.now();
      setProgress({
        title,
        message,
        progress: 0,
        tone: "running",
        busy: true,
        jobId,
      });
      appendLog(`${title} started (${jobId.slice(0, 8)}…).`, "muted");
      return subscribeJobEvents(jobId, {
        onEvent: handleJobEvent,
        onError: (err) => appendLog(err.message, "danger"),
        onEnd: () => {
          setActiveJobId(null);
          setActiveJobKind(null);
        },
      });
    },
    [appendLog, handleJobEvent],
  );

  const handleSourceChange = useCallback((path: string) => {
    setSourcePath(path);
    if (path.toLowerCase().endsWith(".md")) {
      setMarkdownPath(path);
    }
  }, []);

  const libraryDir = useMemo(
    () => String(prefs.audiobook_library_dir ?? ""),
    [prefs.audiobook_library_dir],
  );

  const autoExpandDocumentLog = progress.busy && activeJobKind === "convert";
  const autoExpandAudiobookLog = progress.busy && activeJobKind === "audiobook";

  return (
    <PlayerProvider
      libraryDir={libraryDir}
      lastAudiobook={lastAudiobook}
      markdownPath={markdownPath}
      prefs={prefs}
      onPrefsChange={updatePrefs}
      onLog={appendLog}
    >
      <div className="app-shell">
        <header className="app-header">
          <div className="app-brand">
            <h1>Novelflow</h1>
            <p>PDF → markdown → audiobook</p>
          </div>
          <div className="header-actions">
            <span className={`status-pill ${apiOk ? "ok" : ""}`}>
              <span className="status-dot" />
              {apiOk ? "API connected" : "API offline"}
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
          </div>
        </header>

        <nav className="tab-bar" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tab-btn ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </nav>

        <main className="app-main">
          {tab === "document" && (
            <DocumentTab
              sourcePath={sourcePath}
              onSourceChange={handleSourceChange}
              onMarkdownReady={setMarkdownPath}
              markdownPath={markdownPath}
              prefs={prefs}
              busy={progress.busy}
              activeJobId={activeJobId}
              onLog={appendLog}
              logEntries={logEntries}
              onClearLog={clearLog}
              logCollapsed={logCollapsed}
              onLogCollapsedChange={onLogCollapsedChange}
              autoExpandLog={autoExpandDocumentLog}
              startJobTracking={(jobId, title, message) =>
                startJobTracking(jobId, title, message, "convert")
              }
              setProgress={setProgress}
            />
          )}
          {tab === "audiobook" && (
            <AudiobookTab
              sourcePath={sourcePath}
              markdownPath={markdownPath}
              prefs={prefs}
              onPrefsChange={updatePrefs}
              busy={progress.busy}
              activeJobId={activeJobId}
              onLog={appendLog}
              lastAudiobook={lastAudiobook}
              onPlayInApp={() => setTab("player")}
              logEntries={logEntries}
              onClearLog={clearLog}
              logCollapsed={logCollapsed}
              onLogCollapsedChange={onLogCollapsedChange}
              autoExpandLog={autoExpandAudiobookLog}
              startJobTracking={(jobId, title, message) =>
                startJobTracking(jobId, title, message, "audiobook")
              }
              setProgress={setProgress}
            />
          )}
          {tab === "player" && <PlayerTab />}
        </main>

        {tab !== "player" && <MiniPlayerBar onOpenPlayer={() => setTab("player")} />}

        <ProgressFooter
          state={progress}
          onCancel={async () => {
            if (!activeJobId) return;
            await cancelJob(activeJobId);
            appendLog("Cancel requested.", "muted");
          }}
        />

        <ToastStack toasts={toasts} />

        {settingsOpen && (
          <SettingsModal
            prefs={prefs}
            onClose={() => setSettingsOpen(false)}
            onSave={async (patch) => {
              await updatePrefs(patch);
              appendLog("Settings saved.", "muted");
              setSettingsOpen(false);
            }}
          />
        )}
      </div>
    </PlayerProvider>
  );
}
