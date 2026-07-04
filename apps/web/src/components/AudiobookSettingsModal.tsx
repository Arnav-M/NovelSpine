import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getSections,
  listVoices,
  previewVoice,
  startAudiobook,
  type Prefs,
  type Section,
  type Voice,
} from "../api/client";
import { useModalA11y } from "../a11y/useModalA11y";
import { toAssetUrl } from "../bridge/tauri";
import SectionPickerModal from "./SectionPickerModal";
import type { LogEntry } from "./ActivityLog";
import type { ProgressState } from "./ProgressFooter";
import {
  formatAudiobookDuration,
  formatWordCount,
  selectionStats,
} from "../lib/audiobookEstimate";

const PRESETS = ["All sections", "Title + chapters", "Chapters only", "None"] as const;
const FORMATS = ["m4b", "mp3", "m4a"] as const;

interface Props {
  sourcePath: string;
  markdownPath: string;
  prefs: Prefs;
  onPrefsChange: (patch: Prefs) => Promise<void>;
  busy: boolean;
  onLog: (text: string, tone?: LogEntry["tone"]) => void;
  startJobTracking: (jobId: string, title: string, message: string) => () => void;
  setProgress: (state: ProgressState | ((prev: ProgressState) => ProgressState)) => void;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

export default function AudiobookSettingsModal({
  sourcePath,
  markdownPath,
  prefs,
  onPrefsChange,
  busy,
  onLog,
  startJobTracking,
  setProgress,
  onClose,
  returnFocusRef,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const engine = String(prefs.default_engine ?? "edge");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState(String(prefs.default_voice ?? ""));
  const [format, setFormat] = useState<(typeof FORMATS)[number]>(
    (String(prefs.default_audio_format ?? "m4b") as (typeof FORMATS)[number]) || "m4b",
  );
  const [sections, setSections] = useState<Section[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>("Title + chapters");
  const [bookTitle, setBookTitle] = useState("");
  const [author, setAuthor] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useModalA11y(dialogRef, { open: true, onClose, returnFocusRef });

  const displayPath = sourcePath || markdownPath;

  const mdPath = useMemo(() => {
    if (markdownPath) return markdownPath;
    if (sourcePath.toLowerCase().endsWith(".md")) return sourcePath;
    return "";
  }, [markdownPath, sourcePath]);

  const isPdfSource = sourcePath.toLowerCase().endsWith(".pdf");
  const convertingMarkdown = busy && !mdPath && isPdfSource;

  const stats = useMemo(() => selectionStats(sections, enabled), [enabled, sections]);

  const estimateLine = useMemo(() => {
    if (!stats.words) return "";
    const parts = [
      bookTitle || "Untitled",
      ...(author && author !== bookTitle ? [author] : []),
      `~${formatAudiobookDuration(stats.minutes)}`,
      `${stats.selectedCount} of ${stats.totalCount} sections`,
      `≈ ${formatWordCount(stats.words)} words`,
      `${stats.chapters} chapter${stats.chapters === 1 ? "" : "s"}`,
    ];
    if (stats.totalWords !== stats.words) {
      parts.push(`${formatWordCount(stats.totalWords)} words in book`);
    }
    return parts.join(" · ");
  }, [author, bookTitle, stats]);

  useEffect(() => {
    void listVoices(engine)
      .then(setVoices)
      .catch((err) => onLog(err instanceof Error ? err.message : String(err), "danger"));
  }, [engine, onLog]);

  useEffect(() => {
    if (!voiceId && voices.length) setVoiceId(voices[0].id);
  }, [voiceId, voices]);

  useEffect(() => {
    if (!mdPath) {
      setSections([]);
      setEnabled({});
      setBookTitle("");
      setAuthor(null);
      return;
    }
    void getSections(mdPath)
      .then((res) => {
        setSections(res.sections);
        setBookTitle(res.book_title);
        setAuthor(res.author);
        const next: Record<string, boolean> = {};
        for (const s of res.sections) next[s.id] = s.enabled;
        setPreset("Title + chapters");
        applyPreset("Title + chapters", res.sections, next, setEnabled);
      })
      .catch((err) => {
        onLog(err instanceof Error ? err.message : String(err), "danger");
      });
  }, [mdPath, onLog]);

  const disabledIds = useMemo(
    () => sections.filter((s) => !enabled[s.id]).map((s) => s.id),
    [enabled, sections],
  );

  const onPresetChange = (value: (typeof PRESETS)[number]) => {
    setPreset(value);
    applyPreset(value, sections, { ...enabled }, setEnabled);
  };

  const preview = useCallback(async () => {
    if (!voiceId || previewing) return;
    setPreviewing(true);
    try {
      const { preview_path } = await previewVoice(voiceId, engine);
      const url = await toAssetUrl(preview_path);
      if (url) {
        const audio = new Audio(url);
        await audio.play();
      }
      onLog("Voice preview playing.", "muted");
    } catch (err) {
      onLog(err instanceof Error ? err.message : String(err), "danger");
    } finally {
      setPreviewing(false);
    }
  }, [engine, onLog, previewing, voiceId]);

  const createAudiobook = useCallback(async () => {
    const useExistingMd = Boolean(mdPath);
    const src = sourcePath || mdPath;
    if (!src || busy) return;
    if (useExistingMd && !mdPath) return;
    try {
      await onPrefsChange({
        default_voice: voiceId,
        default_engine: engine,
        default_audio_format: format,
      });
      setProgress({
        title: "Creating audiobook",
        message: "Synthesizing audio…",
        progress: 0,
        tone: "running",
        busy: true,
      });
      const { job_id } = await startAudiobook({
        source_path: src,
        markdown_path: useExistingMd ? mdPath : null,
        use_existing_md: useExistingMd,
        engine,
        voice: voiceId,
        audio_format: format,
        disabled_section_ids: disabledIds,
        chapters_and_title_only: preset === "Title + chapters",
        use_project_folder: true,
        audiobook_only: Boolean(prefs.audiobook_only_cleanup),
      });
      startJobTracking(job_id, "Create audiobook", "Synthesizing audio…");
      onClose();
    } catch (err) {
      onLog(err instanceof Error ? err.message : String(err), "danger");
      setProgress((prev) => ({ ...prev, busy: false, tone: "danger", message: "Audiobook failed." }));
    }
  }, [
    busy,
    disabledIds,
    engine,
    format,
    mdPath,
    onClose,
    onLog,
    onPrefsChange,
    preset,
    prefs.audiobook_only_cleanup,
    setProgress,
    sourcePath,
    startJobTracking,
    voiceId,
  ]);

  return (
    <>
      <div className="modal-backdrop" role="presentation" onClick={onClose}>
        <div
          ref={dialogRef}
          className="modal modal-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="audiobook-settings-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="audiobook-settings-title">Audiobook settings</h2>
          <p className="section-subtitle">
            Pick a voice, format, and sections, then create the audiobook.
          </p>

          <div className="form-row">
            <label htmlFor="ab-source">Source</label>
            <input
              id="ab-source"
              type="text"
              readOnly
              value={displayPath}
              placeholder="Select a document first…"
            />
          </div>

          <div className="form-row">
            <label htmlFor="ab-voice">Voice</label>
            <div className="form-row-controls">
              <select id="ab-voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} ({v.id})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                disabled={!voiceId || previewing}
                aria-label="Preview selected voice"
                onClick={() => void preview()}
              >
                ▶ Preview
              </button>
            </div>
          </div>

          <div className="form-row">
            <label htmlFor="ab-format">Format</label>
            <select
              id="ab-format"
              value={format}
              onChange={(e) => setFormat(e.target.value as (typeof FORMATS)[number])}
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row section-preset-block">
            <label htmlFor="ab-preset">Sections preset</label>
            <div className="action-row section-preset-controls">
              <select
                id="ab-preset"
                value={preset}
                disabled={!sections.length}
                onChange={(e) => onPresetChange(e.target.value as (typeof PRESETS)[number])}
              >
                {PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!sections.length}
                aria-label="Select audiobook sections"
                onClick={() => setPickerOpen(true)}
              >
                Select sections…
              </button>
            </div>

            {!mdPath ? (
              <p className="audiobook-estimate-empty">
                {convertingMarkdown
                  ? "Creating markdown to load sections…"
                  : "Markdown not ready yet — sections will load after conversion, or pick a markdown file."}
              </p>
            ) : !sections.length ? (
              <p className="audiobook-estimate-empty">Loading sections…</p>
            ) : (
              <div className="audiobook-estimate-card" aria-live="polite" aria-atomic="true">
                {stats.words > 0 ? (
                  <p className="audiobook-estimate-line">{estimateLine}</p>
                ) : (
                  <p className="audiobook-estimate-empty">
                    No sections selected — choose a preset or pick sections.
                  </p>
                )}
              </div>
            )}
          </div>

          {Boolean(prefs.audiobook_only_cleanup) && (
            <p className="estimate muted">
              Intermediate files will be removed when done — only the audiobook, chapter index, and cover are kept.
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-accent"
              disabled={!(sourcePath || mdPath) || busy}
              aria-label={
                !(sourcePath || mdPath)
                  ? "Create audiobook, load a document first"
                  : busy
                    ? "Create audiobook, job in progress"
                    : "Create audiobook"
              }
              onClick={() => void createAudiobook()}
            >
              Create audiobook
            </button>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <SectionPickerModal
          sections={sections}
          enabled={enabled}
          onChange={setEnabled}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}

function applyPreset(
  preset: (typeof PRESETS)[number],
  sections: Section[],
  map: Record<string, boolean>,
  setEnabled: (v: Record<string, boolean>) => void,
) {
  for (const s of sections) {
    if (preset === "All sections") map[s.id] = true;
    else if (preset === "None") map[s.id] = false;
    else if (preset === "Chapters only") map[s.id] = s.kind === "chapter";
    else map[s.id] = s.kind === "chapter" || s.kind === "title";
  }
  setEnabled({ ...map });
}
