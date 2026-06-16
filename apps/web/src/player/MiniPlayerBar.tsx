import { chapterLabelFor, formatTime } from "./timeUtils";
import { usePlayer } from "./PlayerContext";
import SeekBar from "./SeekBar";
import TransportControls from "./TransportControls";

interface Props {
  onOpenPlayer: () => void;
}

export default function MiniPlayerBar({ onOpenPlayer }: Props) {
  const p = usePlayer();
  const audiobookName = p.subtitle || p.selected?.label || "Audiobook";
  const partLabel = chapterLabelFor(p.chapters, p.activeChapter);
  const chapterName = p.chapterTitle;

  if (!p.loaded) return null;

  if (p.miniCollapsed) {
    return (
      <div className="mini-player mini-player-collapsed" onClick={() => p.setMiniCollapsed(false)}>
        <span className="mini-player-peek">
          {audiobookName}
          {partLabel ? ` · ${partLabel}` : ""}
          {chapterName ? ` — ${chapterName}` : ""}
        </span>
        <button type="button" className="mini-player-expand" aria-label="Expand mini player">
          ▴
        </button>
      </div>
    );
  }

  return (
    <div className="mini-player">
      <button type="button" className="mini-player-info" onClick={onOpenPlayer}>
        {p.coverUrl ? (
          <img src={p.coverUrl} alt="" className="mini-player-cover" />
        ) : (
          <div className="mini-player-cover placeholder">🎧</div>
        )}
        <div className="mini-player-text">
          <strong>{audiobookName}</strong>
          {partLabel && <span className="mini-player-part">{partLabel}</span>}
          {chapterName && <span className="mini-player-chapter-title">{chapterName}</span>}
        </div>
      </button>

      <div className="mini-player-center">
        <div className="mini-player-seek">
          <span className="mini-player-time">{formatTime(p.chapterMs)}</span>
          <SeekBar
            value={p.chapterMs}
            max={p.chapterDurationMs || 1}
            disabled={!p.loaded}
            onChange={(ms) => void p.seekChapter(p.activeChapter, ms)}
          />
          <span className="mini-player-time">{formatTime(p.chapterDurationMs)}</span>
        </div>
        <TransportControls
          size="mini"
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

      <div className="mini-player-right">
        <div className="mini-player-volume-wrap">
          <span className="mini-player-volume-icon" aria-hidden="true">
            🔈
          </span>
          <SeekBar
            className="volume-bar volume-bar-mini"
            value={Math.round(p.volume * 100)}
            max={100}
            disabled={!p.loaded}
            onChange={(v) => p.setVolume(v)}
          />
        </div>
        <button type="button" className="btn btn-ghost mini-player-collapse" onClick={() => p.setMiniCollapsed(true)} aria-label="Collapse">
          ▾
        </button>
      </div>
    </div>
  );
}
