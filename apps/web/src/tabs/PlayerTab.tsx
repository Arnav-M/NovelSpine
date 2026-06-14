import { useEffect, useRef, useState } from "react";
import { usePlayer } from "../player/PlayerContext";
import BookTimeline from "../player/BookTimeline";
import ChapterPanel from "../player/ChapterPanel";
import SeekBar from "../player/SeekBar";
import TransportControls from "../player/TransportControls";
import { chapterLabel, formatTime } from "../player/timeUtils";
import { SPEED_OPTIONS } from "../lib/files";

export default function PlayerTab() {
  const p = usePlayer();
  const comboRef = useRef<HTMLSelectElement>(null);
  const [chaptersOpen, setChaptersOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.code !== "Space" ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      e.preventDefault();
      void p.togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const selectedPath = p.selected?.audio_path ?? "";

  return (
    <div className={`tab-panel player-tab ${chaptersOpen ? "chapters-open" : ""}`}>
      <div className="player-library-bar">
        <div className="player-library-path-row">
          <input
            type="text"
            className="library-path-input"
            value={p.libraryDraft}
            onChange={(e) => p.setLibraryDraft(e.target.value)}
            onBlur={() => void p.applyLibraryPath()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void p.applyLibraryPath();
            }}
            placeholder="Library folder path…"
          />
          <button type="button" className="btn" onClick={() => void p.chooseLibrary()}>
            Browse…
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void p.refreshLibrary()}>
            Refresh
          </button>
        </div>
        <div className="player-library-select-row">
          <select
            ref={comboRef}
            className="library-combo"
            value={selectedPath}
            onChange={(e) => {
              const item = p.items.find((i) => i.audio_path === e.target.value);
              if (item) void p.loadItem(item);
            }}
          >
            <option value="">Select audiobook…</option>
            {p.items.map((item) => (
              <option key={item.audio_path} value={item.audio_path}>
                {item.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={!p.selected} onClick={() => void p.openAudiobook()}>
            Open
          </button>
        </div>
      </div>

      <div className={`player-main-row ${chaptersOpen ? "chapters-open" : ""}`}>
        <ChapterPanel
          chapters={p.chapters}
          activeChapter={p.activeChapter}
          open={chaptersOpen}
          onSelect={(i) => void p.seekChapter(i)}
        />

        <div className="player-stage">
          {p.coverUrl ? (
            <img src={p.coverUrl} alt="" className="player-cover-large" />
          ) : (
            <div className="player-cover-large placeholder">🎧</div>
          )}

          <h2 className="player-chapter-title">
            {p.chapters.length
              ? chapterLabel(p.activeChapter, p.chapters.length)
              : "No chapter"}
          </h2>
          <p className="player-book-subtitle">{p.subtitle}</p>
          {p.chapterTitle && p.chapters.length > 0 && (
            <p className="player-chapter-name">{p.chapterTitle}</p>
          )}

          {p.speedStatus && <p className="player-speed-status">{p.speedStatus}</p>}

          <div className="player-controls-center">
            <div className="player-chapter-seek">
              <span className="time-label">{formatTime(p.chapterMs)}</span>
              <SeekBar
                value={p.chapterMs}
                max={p.chapterDurationMs || 1}
                disabled={!p.loaded}
                onChange={(ms) => void p.seekChapter(p.activeChapter, ms)}
              />
              <span className="time-label">{formatTime(p.chapterDurationMs)}</span>
            </div>

            <TransportControls
              playing={p.playing}
              disabled={!p.loaded}
              onToggle={() => void p.togglePlay()}
              onPrev={() => void p.seekChapter(p.activeChapter - 1)}
              onNext={() => void p.seekChapter(p.activeChapter + 1)}
              onSkipBack={() => p.skipSeconds(-10)}
              onSkipForward={() => p.skipSeconds(10)}
              canPrev={p.activeChapter > 0}
              canNext={p.activeChapter < p.chapters.length - 1}
            />
          </div>

          <div className="player-volume-speed">
            <div className="volume-control-spotify">
              <span className="volume-icon" aria-hidden="true">
                🔈
              </span>
              <SeekBar
                className="volume-bar"
                value={Math.round(p.volume * 100)}
                max={100}
                disabled={!p.loaded}
                onChange={(v) => p.setVolume(v)}
              />
            </div>
            <label className="player-speed-label">
              Speed
              <select
                className="player-speed-select"
                value={p.speed}
                onChange={(e) => void p.setSpeed(Number(e.target.value) as (typeof SPEED_OPTIONS)[number])}
              >
                {SPEED_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
          </div>

          <BookTimeline
            chapters={p.chapters}
            currentMs={p.currentMs}
            activeChapter={p.activeChapter}
            disabled={!p.loaded}
            onSeek={(ms) => void p.seekBook(ms)}
          />
        </div>
      </div>

      <div className="player-footer">
        <button
          type="button"
          className={`btn btn-ghost ${chaptersOpen ? "active" : ""}`}
          disabled={!p.chapters.length}
          onClick={() => setChaptersOpen((v) => !v)}
        >
          ☰ Chapters
        </button>
        <button type="button" className="btn btn-ghost" disabled={!p.selected} onClick={() => void p.openAudiobook()}>
          ↗ Open externally
        </button>
      </div>
    </div>
  );
}
