import { useEffect, useRef, useState, type RefObject } from "react";
import { listVoices, type Prefs } from "../api/client";
import { useModalA11y } from "../a11y/useModalA11y";

const FORMATS = ["m4b", "mp3", "m4a"] as const;

interface Props {
  prefs: Prefs;
  onClose: () => void;
  onSave: (patch: Prefs) => Promise<void>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export default function SettingsModal({ prefs, onClose, onSave, returnFocusRef }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [format, setFormat] = useState(String(prefs.default_audio_format ?? "m4b"));
  const [voice, setVoice] = useState(String(prefs.default_voice ?? ""));
  const [engine, setEngine] = useState(String(prefs.default_engine ?? "edge"));
  const [rememberSpeed, setRememberSpeed] = useState(Boolean(prefs.remember_speed ?? true));
  const [audiobookOnlyCleanup, setAudiobookOnlyCleanup] = useState(
    Boolean(prefs.audiobook_only_cleanup ?? false),
  );
  const [voiceLabels, setVoiceLabels] = useState<{ id: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useModalA11y(dialogRef, { open: true, onClose, returnFocusRef });

  useEffect(() => {
    void listVoices(engine).then((voices) =>
      setVoiceLabels(voices.map((v) => ({ id: v.id, label: v.label }))),
    );
  }, [engine]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="settings-title">Settings</h2>

        <div className="form-row">
          <label htmlFor="set-format">Default format</label>
          <select id="set-format" value={format} onChange={(e) => setFormat(e.target.value)}>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label htmlFor="set-voice">Default voice</label>
          <select id="set-voice" value={voice} onChange={(e) => setVoice(e.target.value)}>
            {voiceLabels.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label htmlFor="set-engine">Engine</label>
          <select id="set-engine" value={engine} onChange={(e) => setEngine(e.target.value)}>
            <option value="edge">edge</option>
          </select>
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={rememberSpeed}
            onChange={(e) => setRememberSpeed(e.target.checked)}
          />
          Remember playback speed
        </label>

        <h3 style={{ marginTop: 24, fontSize: 14 }}>Output files</h3>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={audiobookOnlyCleanup}
            onChange={(e) => setAudiobookOnlyCleanup(e.target.checked)}
          />
          After audiobook creation, remove intermediate files (keeps audiobook, chapters, and cover)
        </label>

        <h3 style={{ marginTop: 24, fontSize: 14 }}>Keyboard shortcuts</h3>
        <ul className="shortcut-list">
          <li>Ctrl+Enter — Convert to markdown</li>
          <li>Ctrl+L — Clear the activity log</li>
          <li>Space — Play / pause the player</li>
        </ul>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-accent"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void onSave({
                default_audio_format: format,
                default_voice: voice,
                default_engine: engine,
                remember_speed: rememberSpeed,
                audiobook_only_cleanup: audiobookOnlyCleanup,
              }).finally(() => setSaving(false));
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
