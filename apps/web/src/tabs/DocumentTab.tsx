import { useCallback, useRef, useState } from "react";
import { startConvert, type Prefs } from "../api/client";
import { useModalA11y } from "../a11y/useModalA11y";
import { useLiveRegion } from "../a11y/LiveRegionContext";
import { isTauri, openPath, pickFile, pickFolder, revealInExplorer } from "../bridge/tauri";
import AudiobookSettingsModal from "../components/AudiobookSettingsModal";
import WorkTabLayout from "../components/WorkTabLayout";
import type { ProgressState } from "../components/ProgressFooter";
import type { LogEntry } from "../components/ActivityLog";
import { usePlayer } from "../player/PlayerContext";
import {
  joinOutputPath,
  pathFromDataTransfer,
  resolveDroppedPath,
  suggestedProjectFolderOutput,
} from "../lib/files";

interface Props {
  sourcePath: string;
  onSourceChange: (path: string) => void;
  onMarkdownReady: (path: string) => void;
  markdownPath: string;
  projectFolder: string;
  onProjectFolderChange: (folder: string) => Promise<void>;
  prefs: Prefs;
  onPrefsChange: (patch: Prefs) => Promise<void>;
  lastAudiobook: string;
  onPlayInApp: () => void;
  busy: boolean;
  activeJobId: string | null;
  onLog: (text: string, tone?: LogEntry["tone"]) => void;
  logEntries: LogEntry[];
  onClearLog: () => void;
  logCollapsed: boolean;
  onLogCollapsedChange: (collapsed: boolean) => void;
  autoExpandLog: boolean;
  startConvertJobTracking: (jobId: string, title: string, message: string) => () => void;
  startAudiobookJobTracking: (jobId: string, title: string, message: string) => () => void;
  setProgress: (state: ProgressState | ((prev: ProgressState) => ProgressState)) => void;
}

export default function DocumentTab({
  sourcePath,
  onSourceChange,
  onMarkdownReady,
  markdownPath,
  projectFolder,
  onProjectFolderChange,
  prefs,
  onPrefsChange,
  lastAudiobook,
  onPlayInApp,
  busy,
  activeJobId,
  onLog,
  logEntries,
  onClearLog,
  logCollapsed,
  onLogCollapsedChange,
  autoExpandLog,
  startConvertJobTracking,
  startAudiobookJobTracking,
  setProgress,
}: Props) {
  const player = usePlayer();
  const [keepRaw, setKeepRaw] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [staging, setStaging] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [audiobookOpen, setAudiobookOpen] = useState(false);
  const [outputFileName, setOutputFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const advancedDialogRef = useRef<HTMLDivElement>(null);
  const advancedTriggerRef = useRef<HTMLButtonElement>(null);
  const audiobookTriggerRef = useRef<HTMLButtonElement>(null);
  const { announce } = useLiveRegion();

  useModalA11y(advancedDialogRef, {
    open: advancedOpen,
    onClose: () => setAdvancedOpen(false),
    returnFocusRef: advancedTriggerRef,
  });

  const isPdf = sourcePath.toLowerCase().endsWith(".pdf");
  const isMarkdown = sourcePath.toLowerCase().endsWith(".md");
  const outputReady = Boolean(markdownPath);
  const audiobookReady = Boolean(lastAudiobook);
  const bookOutputFolder = sourcePath ? suggestedProjectFolderOutput(sourcePath).folder : "";
  const customOutputPath =
    outputFileName.trim() && bookOutputFolder
      ? joinOutputPath(bookOutputFolder, outputFileName.trim())
      : "";

  const applySource = useCallback(
    async (path: string) => {
      onSourceChange(path);
      if (path.toLowerCase().endsWith(".md")) onMarkdownReady(path);
    },
    [onMarkdownReady, onSourceChange],
  );

  const chooseFile = useCallback(async () => {
    if (isTauri()) {
      const picked = await pickFile([{ name: "Documents", extensions: ["pdf", "md"] }]);
      if (picked) await applySource(picked);
      return;
    }
    fileInputRef.current?.click();
  }, [applySource]);

  const onFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setStaging(true);
      try {
        const path = await resolveDroppedPath(file);
        await applySource(path);
        onLog(`Staged ${file.name} for processing.`, "muted");
      } catch (err) {
        onLog(err instanceof Error ? err.message : String(err), "danger");
      } finally {
        setStaging(false);
      }
    },
    [applySource, onLog],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = pathFromDataTransfer(e.dataTransfer);
      if (!file) return;
      setStaging(true);
      try {
        const path = await resolveDroppedPath(file);
        await applySource(path);
        onLog(`Dropped ${file.name}.`, "muted");
      } catch (err) {
        onLog(err instanceof Error ? err.message : String(err), "danger");
      } finally {
        setStaging(false);
      }
    },
    [applySource, onLog],
  );

  const convert = useCallback(async () => {
    if (!sourcePath || !isPdf || busy) return;
    try {
      setProgress({
        title: "Converting PDF",
        message: "Extracting text…",
        progress: 0,
        tone: "running",
        busy: true,
      });
      const { job_id } = await startConvert({
        pdf_path: sourcePath,
        keep_raw: keepRaw,
        output_path: customOutputPath || undefined,
        use_project_folder: !customOutputPath,
      });
      unsubscribeRef.current?.();
      unsubscribeRef.current = startConvertJobTracking(job_id, "Convert PDF", "Extracting text…");
      announce("PDF conversion started.", "assertive");
    } catch (err) {
      onLog(err instanceof Error ? err.message : String(err), "danger");
      setProgress((prev) => ({ ...prev, busy: false, tone: "danger", message: "Conversion failed." }));
    }
  }, [announce, busy, customOutputPath, isPdf, keepRaw, onLog, setProgress, sourcePath, startConvertJobTracking]);

  const openAudiobook = useCallback(async () => {
    if (!lastAudiobook) return;
    try {
      await openPath(lastAudiobook);
    } catch (err) {
      onLog(err instanceof Error ? err.message : String(err), "danger");
    }
  }, [lastAudiobook, onLog]);

  const playInApp = useCallback(async () => {
    if (!lastAudiobook) return;
    await player.loadFromPath(lastAudiobook);
    onPlayInApp();
  }, [lastAudiobook, onPlayInApp, player]);

  const openAdvanced = useCallback(() => {
    if (outputFileName.trim()) {
      setOutputFileName(outputFileName.trim());
    } else if (sourcePath && isPdf) {
      setOutputFileName(suggestedProjectFolderOutput(sourcePath).fileName);
    } else {
      setOutputFileName("");
    }
    setAdvancedOpen(true);
  }, [isPdf, outputFileName, sourcePath]);

  const clearAdvancedOutput = useCallback(() => {
    setOutputFileName("");
    setAdvancedOpen(false);
  }, []);

  const changeProjectFolder = useCallback(async () => {
    try {
      const folder = await pickFolder(projectFolder || undefined);
      if (folder) await onProjectFolderChange(folder);
    } catch (err) {
      onLog(err instanceof Error ? err.message : String(err), "danger");
    }
  }, [onLog, onProjectFolderChange, projectFolder]);

  const revealProjectFolder = useCallback(async () => {
    if (!projectFolder) return;
    try {
      await revealInExplorer(projectFolder);
    } catch (err) {
      onLog(err instanceof Error ? err.message : String(err), "danger");
    }
  }, [onLog, projectFolder]);

  return (
    <WorkTabLayout
      logEntries={logEntries}
      onClearLog={onClearLog}
      autoExpand={autoExpandLog}
      logCollapsedPref={logCollapsed}
      onLogCollapsedChange={onLogCollapsedChange}
    >
      <div className="tab-panel">
        <h2 className="section-heading">Create</h2>
        <p className="section-subtitle">
          Add a PDF or markdown file, then create markdown or an audiobook.
        </p>

        <div className="card">
          <div className="form-row project-folder-row">
            <label htmlFor="doc-library-folder">Library folder</label>
            <div className="form-row-controls">
              <input
                id="doc-library-folder"
                type="text"
                className="library-path-input"
                readOnly
                value={projectFolder}
                placeholder="Parent folder for your books — set when you pick a document"
                aria-describedby={projectFolder ? undefined : "doc-library-hint"}
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!projectFolder}
                aria-label="Reveal library folder in Explorer"
                onClick={() => void revealProjectFolder()}
              >
                Reveal
              </button>
              <button
                type="button"
                className="btn"
                aria-label="Change library folder"
                onClick={() => void changeProjectFolder()}
              >
                Change…
              </button>
            </div>
            {!projectFolder && (
              <p id="doc-library-hint" className="estimate muted">
                Choose a document to set the library folder automatically, or use Change.
              </p>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.md,application/pdf,text/markdown"
            hidden
            onChange={(e) => void onFileInput(e)}
          />
          <div
            className={`dropzone ${dragOver ? "dragover" : ""} ${!sourcePath && !staging ? "dropzone-clickable" : ""}`}
            role={!sourcePath && !staging ? "button" : undefined}
            tabIndex={!sourcePath && !staging ? 0 : undefined}
            aria-label={
              staging
                ? "Uploading file"
                : sourcePath
                  ? `Selected file: ${sourcePath.split(/[/\\]/).pop()}`
                  : "Drop PDF or markdown file, or press Enter to browse"
            }
            onClick={() => {
              if (!sourcePath && !staging) void chooseFile();
            }}
            onKeyDown={(e) => {
              if (!sourcePath && !staging && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                void chooseFile();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => void onDrop(e)}
          >
            {staging ? (
              <p className="dropzone-title">Uploading file…</p>
            ) : sourcePath ? (
              <div className="file-chip" onClick={(e) => e.stopPropagation()}>
                <div>
                  <strong>{sourcePath.split(/[/\\]/).pop()}</strong>
                  <span>{sourcePath}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label="Clear selected file"
                  onClick={() => onSourceChange("")}
                >
                  Clear
                </button>
              </div>
            ) : (
              <>
                <p className="dropzone-title">Drop a PDF or markdown file</p>
                <p className="dropzone-hint">or click to browse</p>
              </>
            )}
          </div>

          <div className="action-row">
            <button
              id="doc-convert-trigger"
              type="button"
              className="btn btn-accent"
              disabled={!isPdf || busy || staging}
              onClick={() => void convert()}
            >
              Create MD
            </button>
            <button
              ref={audiobookTriggerRef}
              type="button"
              className="btn btn-accent"
              disabled={!(isPdf || isMarkdown) || busy || staging}
              onClick={() => setAudiobookOpen(true)}
            >
              Create audiobook
            </button>
            <button type="button" className="btn btn-ghost" disabled={!isPdf} ref={advancedTriggerRef} onClick={openAdvanced} aria-label="Advanced markdown output options">
              Advanced…
            </button>
          </div>

          <label className="checkbox-row">
            <input type="checkbox" checked={keepRaw} onChange={(e) => setKeepRaw(e.target.checked)} />
            Keep raw extraction (.raw.md beside the PDF)
          </label>

          {isMarkdown && (
            <p className="estimate">Markdown loaded — use Create audiobook to generate audio.</p>
          )}
          {outputReady && (
            <p className="estimate muted">Markdown: {markdownPath.split(/[/\\]/).pop()}</p>
          )}
          {audiobookReady && (
            <div className="action-row">
              <button type="button" className="btn" disabled={!audiobookReady} onClick={() => void openAudiobook()}>
                Open audiobook
              </button>
              <button type="button" className="btn" disabled={!audiobookReady} onClick={() => void playInApp()}>
                Play in app
              </button>
            </div>
          )}
          {activeJobId && busy && <p className="estimate">Job in progress…</p>}
        </div>
      </div>

      {audiobookOpen && (
        <AudiobookSettingsModal
          sourcePath={sourcePath}
          markdownPath={markdownPath}
          prefs={prefs}
          onPrefsChange={onPrefsChange}
          busy={busy}
          onLog={onLog}
          startJobTracking={startAudiobookJobTracking}
          setProgress={setProgress}
          onClose={() => setAudiobookOpen(false)}
          returnFocusRef={audiobookTriggerRef}
        />
      )}

      {advancedOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setAdvancedOpen(false)}>
          <div
            ref={advancedDialogRef}
            className="modal modal-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="advanced-output-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="advanced-output-title">Markdown file name</h2>
            <p className="section-subtitle">
              Output stays in the book&apos;s subfolder under the library folder. Override the readable
              markdown file name only.
            </p>

            <div className="form-row">
              <label htmlFor="adv-output-name">File name</label>
              <input
                id="adv-output-name"
                type="text"
                value={outputFileName}
                onChange={(e) => setOutputFileName(e.target.value)}
                placeholder="Book.readable.md"
              />
            </div>

            {outputFileName.trim() && bookOutputFolder && (
              <p className="estimate">
                Will save to: {joinOutputPath(bookOutputFolder, outputFileName.trim())}
              </p>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={clearAdvancedOutput}>
                Use default
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setAdvancedOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </WorkTabLayout>
  );
}
