import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getSections,
  listVoices,
  previewVoice,
  startAudiobook,
  type Prefs,
  type Section,
  type Voice,
} from "../api/client";
import { openPath, toAssetUrl } from "../bridge/tauri";
import SectionPickerModal from "../components/SectionPickerModal";
import WorkTabLayout from "../components/WorkTabLayout";
import type { LogEntry } from "../components/ActivityLog";
import type { ProgressState } from "../components/ProgressFooter";
import { usePlayer } from "../player/PlayerContext";
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
  activeJobId: string | null;
  onLog: (text: string, tone?: LogEntry["tone"]) => void;
  onPlayInApp: () => void;
  lastAudiobook: string;
  logEntries: LogEntry[];
  onClearLog: () => void;
  logCollapsed: boolean;
  onLogCollapsedChange: (collapsed: boolean) => void;
  autoExpandLog: boolean;
  startJobTracking: (jobId: string, title: string, message: string) => () => void;
  setProgress: (state: ProgressState | ((prev: ProgressState) => ProgressState)) => void;
}

export default function AudiobookTab({
  sourcePath,
  markdownPath,
  prefs,
  onPrefsChange,
  busy,
  activeJobId,
  onLog,
  onPlayInApp,
  lastAudiobook,
  logEntries,
  onClearLog,
  logCollapsed,
  onLogCollapsedChange,
  autoExpandLog,
  startJobTracking,
  setProgress,
}: Props) {
  const player = usePlayer();
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

  const displayPath = sourcePath || markdownPath;

  const mdPath = useMemo(() => {
    if (markdownPath) return markdownPath;
    if (sourcePath.toLowerCase().endsWith(".md")) return sourcePath;
    return "";
  }, [markdownPath, sourcePath]);

  const outputReady = Boolean(lastAudiobook);

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
      });
      startJobTracking(job_id, "Create audiobook", "Synthesizing audio…");
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
    onLog,
    onPrefsChange,
    preset,
    setProgress,
    sourcePath,
    startJobTracking,
    voiceId,
  ]);

  const openAudiobook = useCallback(async () => {
    if (!lastAudiobook) return;
    await openPath(lastAudiobook);
  }, [lastAudiobook]);

  const playInApp = useCallback(async () => {
    if (!lastAudiobook) return;
    await player.loadFromPath(lastAudiobook);
    onPlayInApp();
  }, [lastAudiobook, onPlayInApp, player]);

  return (
    <WorkTabLayout
      logEntries={logEntries}
      onClearLog={onClearLog}
      autoExpand={autoExpandLog}
      logCollapsedPref={logCollapsed}
      onLogCollapsedChange={onLogCollapsedChange}
    >
      <div className="tab-panel">
        <h2 className="section-heading">Audiobook</h2>
        <p className="section-subtitle">
          Pick a voice, format, and sections, then create the audiobook. Source comes from the Document tab.
        </p>

        <div className="card">
          <div className="form-row">
            <label htmlFor="ab-source">Source</label>
            <input
              id="ab-source"
              type="text"
              readOnly
              value={displayPath}
              placeholder="Convert a document on the Document tab first…"
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
              <button type="button" className="btn" disabled={!voiceId || previewing} onClick={() => void preview()}>
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
                onClick={() => setPickerOpen(true)}
              >
                Select sections…
              </button>
            </div>

            {!mdPath ? (
              <p className="audiobook-estimate-empty">Load a document to see section stats and duration.</p>
            ) : !sections.length ? (
              <p className="audiobook-estimate-empty">Loading sections…</p>
            ) : (
              <div className="audiobook-estimate-card">
                {stats.words > 0 ? (
                  <p className="audiobook-estimate-line">{estimateLine}</p>
                ) : (
                  <p className="audiobook-estimate-empty">No sections selected — choose a preset or pick sections.</p>
                )}
              </div>
            )}
          </div>

          <div className="action-row">
            <button
              type="button"
              className="btn btn-accent"
              disabled={!(sourcePath || mdPath) || busy}
              onClick={() => void createAudiobook()}
            >
              Create audiobook
            </button>
            <button type="button" className="btn" disabled={!outputReady} onClick={() => void openAudiobook()}>
              Open audiobook
            </button>
            <button type="button" className="btn" disabled={!outputReady} onClick={() => void playInApp()}>
              Play in app
            </button>
          </div>
          {activeJobId && busy && <p className="estimate">Audiobook job running…</p>}
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
    </WorkTabLayout>
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
