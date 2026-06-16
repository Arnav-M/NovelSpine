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
import { LiveRegionProvider, useLiveRegion, useThrottledProgressAnnounce } from "./a11y/LiveRegionContext";
import SkipLink from "./a11y/SkipLink";
import { useRovingTabIndex } from "./a11y/useRovingTabIndex";
import type { LogEntry } from "./components/ActivityLog";
import ProgressFooter, { type ProgressState } from "./components/ProgressFooter";
import SettingsModal from "./components/SettingsModal";
import ToastStack, { type ToastItem } from "./components/ToastStack";
import { audiobookDisplayName, unifiedProjectFolderFor } from "./lib/files";
import MiniPlayerBar from "./player/MiniPlayerBar";
import PlayerOverlays from "./player/PlayerOverlays";
import { PlayerProvider } from "./player/PlayerContext";
import AudiobookTab from "./tabs/AudiobookTab";
import DocumentTab from "./tabs/DocumentTab";
import PlayerTab from "./tabs/PlayerTab";

type TabId = "document" | "audiobook" | "player";

const TABS: { id: TabId; label: string; icon: string; panelId: string }[] = [
  { id: "document", label: "Document", icon: "📄", panelId: "panel-document" },
  { id: "audiobook", label: "Audiobook", icon: "🎧", panelId: "panel-audiobook" },
  { id: "player", label: "Player", icon: "▶", panelId: "panel-player" },
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
  return (
    <LiveRegionProvider>
      <AppShell />
    </LiveRegionProvider>
  );
}

function AppShell() {
  const { announce } = useLiveRegion();
  const announceProgress = useThrottledProgressAnnounce();
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
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const tabIndex = TABS.findIndex((t) => t.id === tab);
  const tabButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { focusedIndex, getTabIndex, onKeyDown: onTabKeyDown } = useRovingTabIndex({
    itemCount: TABS.length,
    activeIndex: tabIndex >= 0 ? tabIndex : 0,
    orientation: "horizontal",
    onActivate: (index) => setTab(TABS[index].id),
  });

  useEffect(() => {
    tabButtonRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

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

  const onProjectFolderChange = useCallback(
    async (folder: string) => {
      const trimmed = folder.trim();
      if (!trimmed) return;
      await updatePrefs({ project_folder: trimmed });
    },
    [updatePrefs],
  );

  const handleSourceChange = useCallback(
    (path: string) => {
      setSourcePath(path);
      if (path.toLowerCase().endsWith(".md")) {
        setMarkdownPath(path);
      }
      const folder = unifiedProjectFolderFor(path);
      if (folder) void onProjectFolderChange(folder);
    },
    [onProjectFolderChange],
  );

  const projectFolder = useMemo(
    () => String(prefs.project_folder ?? prefs.audiobook_library_dir ?? ""),
    [prefs.project_folder, prefs.audiobook_library_dir],
  );

  const onLogCollapsedChange = useCallback(
    (collapsed: boolean) => {
      void updatePrefs({ log_collapsed: collapsed });
    },
    [updatePrefs],
  );

  useEffect(() => {
    let cancelled = false;

    async function waitForApi(attempts = 40, delayMs = 500): Promise<boolean> {
      for (let i = 0; i < attempts; i += 1) {
        try {
          await healthCheck();
          return true;
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
      }
      return false;
    }

    async function boot() {
      const connected = await waitForApi();
      if (cancelled) return;
      if (connected) {
        setApiOk(true);
        try {
          const res = await getPrefs();
          if (cancelled) return;
          let data = res.data;
          const legacy = String(data.audiobook_library_dir ?? "").trim();
          if (!String(data.project_folder ?? "").trim() && legacy) {
            const migrated = await savePrefs({ ...data, project_folder: legacy });
            if (cancelled) return;
            data = migrated.data;
          }
          setPrefs(data);
        } catch {
          /* prefs optional on first connect */
        }
        appendLog("Connected to Novelflow API.", "muted");
        return;
      }

      setApiOk(false);
      appendLog(
        "API unavailable. The bundled backend did not start — try restarting Novelflow.",
        "danger",
      );
      pushToast("API offline — restart the app.", "danger");
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
        setProgress((prev) => {
          announceProgress(prev.title, percent);
          return {
            ...prev,
            progress: percent,
            busy: true,
            tone: "running",
            eta: started ? formatEta(percent, started) : undefined,
          };
        });
      }
      if (event.type === "done") {
        const result = event.result;
        if (typeof result === "string") {
          if (result.toLowerCase().endsWith(".md")) {
            setMarkdownPath(result);
            appendLog(`Markdown ready: ${result}`);
            pushToast("Markdown conversion complete.", "success");
            announce("Markdown conversion complete.", "assertive");
          } else {
            appendLog(`Job finished: ${result}`);
          }
        } else if (result && typeof result === "object") {
          const payload = result as Record<string, unknown>;
          if (payload.unchanged === true) {
            const note =
              typeof payload.message === "string"
                ? payload.message
                : "Audiobook already matches this markdown.";
            if (typeof payload.audiobook_path === "string") {
              setLastAudiobook(payload.audiobook_path);
            }
            appendLog(note, "muted");
            pushToast(note, "warn");
            announce(note, "assertive");
            setProgress((prev) => ({
              ...prev,
              progress: 100,
              tone: "success",
              busy: false,
              message: "Already up to date.",
              eta: undefined,
            }));
            jobStartRef.current = null;
            return;
          }
          if (typeof payload.markdown_path === "string") {
            setMarkdownPath(payload.markdown_path);
            appendLog(`Markdown ready: ${payload.markdown_path}`);
            pushToast("Markdown conversion complete.", "success");
          }
          if (typeof payload.audiobook_path === "string") {
            setLastAudiobook(payload.audiobook_path);
            appendLog(`Audiobook ready: ${audiobookDisplayName(payload.audiobook_path)}`);
            pushToast(`Audiobook created: ${audiobookDisplayName(payload.audiobook_path)}`, "success");
            announce(`Audiobook created: ${audiobookDisplayName(payload.audiobook_path)}`, "assertive");
          }
        }
        setProgress((prev) => ({
          ...prev,
          progress: 100,
          tone: "success",
          busy: false,
          message: "Done.",
          eta: undefined,
        }));
        announce("Job complete.", "assertive");
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
            message: "Done.",
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
          announce(msg, "assertive");
          jobStartRef.current = null;
        } else if (state === "cancelled") {
          setProgress((prev) => ({
            ...prev,
            tone: "danger",
            busy: false,
            message: "Cancelled.",
            eta: undefined,
          }));
          announce("Job cancelled.", "assertive");
          jobStartRef.current = null;
        }
      }
      if (event.type === "error" && typeof event.message === "string") {
        appendLog(event.message, "danger");
        pushToast(event.message, "danger");
        announce(event.message, "assertive");
      }
    },
    [announce, announceProgress, appendLog, pushToast],
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
      announce(`${title} started.`, "assertive");
      return subscribeJobEvents(jobId, {
        onEvent: handleJobEvent,
        onError: (err) => appendLog(err.message, "danger"),
        onEnd: () => {
          setActiveJobId(null);
          setActiveJobKind(null);
        },
      });
    },
    [announce, appendLog, handleJobEvent],
  );

  const autoExpandDocumentLog = progress.busy && activeJobKind === "convert";
  const autoExpandAudiobookLog = progress.busy && activeJobKind === "audiobook";

  return (
    <PlayerProvider
      projectFolder={projectFolder}
      lastAudiobook={lastAudiobook}
      markdownPath={markdownPath}
      prefs={prefs}
      onPrefsChange={updatePrefs}
      onLog={appendLog}
    >
      <div className="app-shell">
        <SkipLink />
        <header className="app-header" aria-label="Novelflow">
          <div className="app-brand">
            <h1>Novelflow</h1>
            <p>PDF → markdown → audiobook</p>
          </div>
          <div className="header-actions">
            <span
              className={`status-pill ${apiOk ? "ok" : ""}`}
              role="status"
              aria-label={apiOk ? "API connected" : "API offline"}
            >
              <span className="status-dot" aria-hidden="true" />
              <span className="sr-only">{apiOk ? "API connected" : "API offline"}</span>
              {apiOk ? "API connected" : "API offline"}
            </span>
            <button
              ref={settingsButtonRef}
              type="button"
              className="btn btn-ghost"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              Settings
            </button>
          </div>
        </header>

        <nav className="tab-bar" role="tablist" aria-label="Main sections">
          {TABS.map((t, index) => (
            <button
              key={t.id}
              ref={(el) => {
                tabButtonRefs.current[index] = el;
              }}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={t.panelId}
              tabIndex={getTabIndex(index)}
              className={`tab-btn ${tab === t.id ? "active" : ""}`}
              aria-label={t.label}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKeyDown(e, index)}
            >
              <span aria-hidden="true">{t.icon}</span> {t.label}
            </button>
          ))}
        </nav>

        <main id="main-content" className="app-main">
          {tab === "document" && (
            <div
              role="tabpanel"
              id="panel-document"
              aria-labelledby="tab-document"
              tabIndex={0}
            >
              <DocumentTab
              sourcePath={sourcePath}
              onSourceChange={handleSourceChange}
              onMarkdownReady={setMarkdownPath}
              markdownPath={markdownPath}
              projectFolder={projectFolder}
              onProjectFolderChange={onProjectFolderChange}
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
            </div>
          )}
          {tab === "audiobook" && (
            <div
              role="tabpanel"
              id="panel-audiobook"
              aria-labelledby="tab-audiobook"
              tabIndex={0}
            >
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
            </div>
          )}
          {tab === "player" && (
            <div role="tabpanel" id="panel-player" aria-labelledby="tab-player" tabIndex={0}>
              <PlayerTab onOpenDocument={() => setTab("document")} />
            </div>
          )}
        </main>

        {tab !== "player" && <MiniPlayerBar onOpenPlayer={() => setTab("player")} />}

        <footer aria-label="Job progress">
          <ProgressFooter
            state={progress}
            onCancel={async () => {
              if (!activeJobId) return;
              await cancelJob(activeJobId);
              appendLog("Cancel requested.", "muted");
            }}
          />
        </footer>

        <ToastStack toasts={toasts} />

        <PlayerOverlays />

        {settingsOpen && (
          <SettingsModal
            prefs={prefs}
            returnFocusRef={settingsButtonRef}
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
