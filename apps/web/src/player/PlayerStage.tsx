import { SPEED_OPTIONS } from "../lib/files";
import { usePlayerPlayback } from "./PlayerContext";
import BookTimeline from "./BookTimeline";
import SeekBar from "./SeekBar";
import TransportControls from "./TransportControls";
import { chapterLabelFor, formatTime } from "./timeUtils";

export default function PlayerStage() {
  const p = usePlayerPlayback();

  return (
    <div className="player-stage">
      <div className="player-stage-main">
        <div className="player-hero">
          {p.coverUrl ? (
            <img src={p.coverUrl} alt="" className="player-cover-large" aria-hidden="true" />
          ) : (
            <div className="player-cover-large placeholder" aria-hidden="true">
              🎧
            </div>
          )}

          <div className="player-hero-meta">
            <h3 className="player-chapter-title">
              {p.chapters.length
                ? chapterLabelFor(p.chapters, p.activeChapter)
                : "No chapter"}
            </h3>
            {p.chapterTitle && p.chapters.length > 0 && (
              <p className="player-chapter-name">{p.chapterTitle}</p>
            )}
            {p.speedStatus && <p className="player-speed-status">{p.speedStatus}</p>}
          </div>
        </div>

        <div className="player-transport">
          <div className="player-chapter-seek">
            <span className="time-label">{formatTime(p.chapterMs)}</span>
            <SeekBar
              value={p.chapterMs}
              max={p.chapterDurationMs || 1}
              disabled={!p.loaded}
              ariaLabel="Seek within chapter"
              valueText={`${formatTime(p.chapterMs)} of ${formatTime(p.chapterDurationMs)}`}
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
                ariaLabel="Volume"
                valueText={`${Math.round(p.volume * 100)} percent`}
                onChange={(v) => p.setVolume(v)}
              />
            </div>
            <label className="player-speed-label">
              Speed
              <select
                className="player-speed-select"
                value={p.speed}
                aria-label="Playback speed"
                onChange={(e) =>
                  void p.setSpeed(Number(e.target.value) as (typeof SPEED_OPTIONS)[number])
                }
              >
                {SPEED_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="player-book-progress">
        <BookTimeline
          chapters={p.chapters}
          currentMs={p.currentMs}
          disabled={!p.loaded}
          onSeek={(ms) => void p.seekBook(ms)}
        />
      </div>
    </div>
  );
}
