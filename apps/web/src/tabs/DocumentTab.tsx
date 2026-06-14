import { useCallback, useRef, useState } from "react";
import { startConvert } from "../api/client";
import { isTauri, pickFile, pickFolder, revealInExplorer } from "../bridge/tauri";
import WorkTabLayout from "../components/WorkTabLayout";
import type { ProgressState } from "../components/ProgressFooter";
import type { LogEntry } from "../components/ActivityLog";
import type { Prefs } from "../api/client";
import {
  joinOutputPath,
  pathFromDataTransfer,
  resolveDroppedPath,
  splitOutputPath,
  suggestedReadableMarkdownOutput,
} from "../lib/files";

interface Props {
  sourcePath: string;
  onSourceChange: (path: string) => void;
  onMarkdownReady: (path: string) => void;
  markdownPath: string;
  prefs: Prefs;
  busy: boolean;
  activeJobId: string | null;
  onLog: (text: string, tone?: LogEntry["tone"]) => void;
  logEntries: LogEntry[];
  onClearLog: () => void;
  logCollapsed: boolean;
  onLogCollapsedChange: (collapsed: boolean) => void;
  autoExpandLog: boolean;
  startJobTracking: (jobId: string, title: string, message: string) => () => void;
  setProgress: (state: ProgressState | ((prev: ProgressState) => ProgressState)) => void;
}

export default function DocumentTab({
  sourcePath,
  onSourceChange,
  onMarkdownReady,
  markdownPath,
  busy,
  activeJobId,
  onLog,
  logEntries,
  onClearLog,
  logCollapsed,
  onLogCollapsedChange,
  autoExpandLog,
  startJobTracking,
  setProgress,
}: Props) {
  const [keepRaw, setKeepRaw] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [staging, setStaging] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [outputPath, setOutputPath] = useState("");
  const [outputFolder, setOutputFolder] = useState("");
  const [outputFileName, setOutputFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const isPdf = sourcePath.toLowerCase().endsWith(".pdf");
  const isMarkdown = sourcePath.toLowerCase().endsWith(".md");
  const outputReady = Boolean(markdownPath);

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
        output_path: outputPath.trim() || undefined,
      });
      unsubscribeRef.current?.();
      unsubscribeRef.current = startJobTracking(job_id, "Convert PDF", "Extracting text…");
    } catch (err) {
      onLog(err instanceof Error ? err.message : String(err), "danger");
      setProgress((prev) => ({ ...prev, busy: false, tone: "danger", message: "Conversion failed." }));
    }
  }, [busy, isPdf, keepRaw, onLog, outputPath, setProgress, sourcePath, startJobTracking]);

  const openAdvanced = useCallback(() => {
    if (outputPath.trim()) {
      const { folder, fileName } = splitOutputPath(outputPath);
      setOutputFolder(folder);
      setOutputFileName(fileName);
    } else if (sourcePath && isPdf) {
      const suggested = suggestedReadableMarkdownOutput(sourcePath);
      setOutputFolder(suggested.folder);
      setOutputFileName(suggested.fileName);
    } else {
      setOutputFolder("");
      setOutputFileName("");
    }
    setAdvancedOpen(true);
  }, [isPdf, outputPath, sourcePath]);

  const chooseOutputFolder = useCallback(async () => {
    const defaultPath =
      outputFolder.trim() || (sourcePath ? suggestedReadableMarkdownOutput(sourcePath).folder : "");
    setAdvancedOpen(false);
    try {
      const folder = await pickFolder(defaultPath || undefined);
      if (folder) setOutputFolder(folder);
    } catch (err) {
      onLog(err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setAdvancedOpen(true);
    }
  }, [onLog, outputFolder, sourcePath]);

  const saveAdvancedOutput = useCallback(() => {
    const fallbackFolder = sourcePath ? suggestedReadableMarkdownOutput(sourcePath).folder : "";
    setOutputPath(joinOutputPath(outputFolder, outputFileName, fallbackFolder));
    setAdvancedOpen(false);
  }, [outputFileName, outputFolder, sourcePath]);

  const clearAdvancedOutput = useCallback(() => {
    setOutputFolder("");
    setOutputFileName("");
    setOutputPath("");
    setAdvancedOpen(false);
  }, []);

  const openFolder = useCallback(async () => {
    const path = markdownPath || sourcePath;
    if (!path) return;
    if (isTauri()) {
      await revealInExplorer(path);
    } else {
      onLog("Open folder is available in the desktop app.", "muted");
    }
  }, [markdownPath, onLog, sourcePath]);

  return (
    <WorkTabLayout
      logEntries={logEntries}
      onClearLog={onClearLog}
      autoExpand={autoExpandLog}
      logCollapsedPref={logCollapsed}
      onLogCollapsedChange={onLogCollapsedChange}
    >
      <div className="tab-panel">
        <h2 className="section-heading">Source document</h2>
        <p className="section-subtitle">
          Drop a PDF or markdown file here, or click the area below to browse.
        </p>

        <div className="card">
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
                <button type="button" className="btn btn-ghost" onClick={() => onSourceChange("")}>
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
              Convert to markdown
            </button>
            <button type="button" className="btn btn-ghost" onClick={openAdvanced}>
              Advanced…
            </button>
            <button type="button" className="btn btn-ghost" disabled={!outputReady && !sourcePath} onClick={() => void openFolder()}>
              Open folder
            </button>
          </div>

          <label className="checkbox-row">
            <input type="checkbox" checked={keepRaw} onChange={(e) => setKeepRaw(e.target.checked)} />
            Keep raw extraction (.raw.md beside the PDF)
          </label>

          {isMarkdown && (
            <p className="estimate">Markdown loaded — open the Audiobook tab to create audio.</p>
          )}
          {activeJobId && busy && <p className="estimate">Conversion in progress…</p>}
        </div>
      </div>

      {advancedOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setAdvancedOpen(false)}>
          <div className="modal modal-wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Advanced output</h2>
            <p className="section-subtitle">
              Choose where to save the readable markdown. Defaults match the PDF name and folder.
            </p>

            <div className="form-row">
              <label htmlFor="adv-output-folder">Output folder</label>
              <div className="form-row-controls">
                <input
                  id="adv-output-folder"
                  type="text"
                  value={outputFolder}
                  onChange={(e) => setOutputFolder(e.target.value)}
                  placeholder="Same folder as the PDF"
                />
                <button type="button" className="btn" onClick={() => void chooseOutputFolder()}>
                  Browse…
                </button>
              </div>
            </div>

            <div className="form-row">
              <label htmlFor="adv-output-name">File name</label>
              <input
                id="adv-output-name"
                type="text"
                value={outputFileName}
                onChange={(e) => setOutputFileName(e.target.value)}
                placeholder="book.readable.md"
              />
            </div>

            {outputFileName.trim() && (
              <p className="estimate">
                Will save to:{" "}
                {joinOutputPath(
                  outputFolder,
                  outputFileName,
                  sourcePath ? suggestedReadableMarkdownOutput(sourcePath).folder : "",
                )}
              </p>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={clearAdvancedOutput}>
                Use default
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setAdvancedOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-accent" onClick={saveAdvancedOutput}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </WorkTabLayout>
  );
}
