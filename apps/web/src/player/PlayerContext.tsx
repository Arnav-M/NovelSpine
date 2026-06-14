import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getChapters,
  getLibrary,
  getResume,
  saveResume,
  type Chapter,
  type LibraryItem,
  type Prefs,
} from "../api/client";
import { pickFolder } from "../bridge/tauri";
import type { LogEntry } from "../components/ActivityLog";
import {
  clampVolumePercent,
  nearestSpeed,
  resolveMediaUrl,
  resolveSpeedMediaUrl,
  SPEED_OPTIONS,
} from "../lib/files";
import {
  bookPositionMs,
  isMergedAudiobook,
  seekBookMs,
  totalBookDurationMs,
} from "./timeUtils";

export interface PlayerContextValue {
  loaded: boolean;
  selected: LibraryItem | null;
  chapters: Chapter[];
  items: LibraryItem[];
  libraryRoot: string;
  libraryDraft: string;
  setLibraryDraft: (v: string) => void;
  coverUrl: string | null;
  coverMap: Record<string, string | null>;
  playing: boolean;
  currentMs: number;
  chapterMs: number;
  chapterDurationMs: number;
  totalDurationMs: number;
  speed: (typeof SPEED_OPTIONS)[number];
  volume: number;
  activeChapter: number;
  speedStatus: string | null;
  miniCollapsed: boolean;
  setMiniCollapsed: (v: boolean) => void;
  refreshLibrary: () => Promise<void>;
  applyLibraryPath: () => Promise<void>;
  chooseLibrary: () => Promise<void>;
  loadItem: (item: LibraryItem) => Promise<void>;
  loadFromPath: (audioPath: string) => Promise<void>;
  selectByPath: (audioPath: string) => void;
  togglePlay: () => Promise<void>;
  seekChapter: (index: number, offsetMs?: number) => Promise<void>;
  seekBook: (bookMs: number) => Promise<void>;
  skipSeconds: (delta: number) => void;
  setSpeed: (v: (typeof SPEED_OPTIONS)[number]) => Promise<void>;
  setVolume: (pct: number) => void;
  openAudiobook: () => Promise<void>;
  chapterTitle: string;
  subtitle: string;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}

interface ProviderProps {
  libraryDir: string;
  lastAudiobook: string;
  markdownPath: string;
  prefs: Prefs;
  onPrefsChange: (patch: Prefs) => Promise<void>;
  onLog: (text: string, tone?: LogEntry["tone"]) => void;
  children: ReactNode;
}

export function PlayerProvider({
  libraryDir,
  lastAudiobook,
  markdownPath,
  prefs,
  onPrefsChange,
  onLog,
  children,
}: ProviderProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const mountedRef = useRef(true);
  const baseMediaPathRef = useRef<string>("");
  const loadedMediaPathRef = useRef<string>("");
  const [libraryRoot, setLibraryRoot] = useState(libraryDir);
  const [libraryDraft, setLibraryDraft] = useState(libraryDir);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [playableUrl, setPlayableUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverMap, setCoverMap] = useState<Record<string, string | null>>({});
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [chapterMs, setChapterMs] = useState(0);
  const [activeChapter, setActiveChapter] = useState(0);
  const [speed, setSpeedState] = useState(() => nearestSpeed(prefs.speed));
  const [volume, setVolumeState] = useState(() => clampVolumePercent(prefs.volume) / 100);
  const [speedStatus, setSpeedStatus] = useState<string | null>(null);
  const [miniCollapsed, setMiniCollapsedState] = useState(
    () => prefs.mini_player_collapsed === true,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setLibraryRoot(libraryDir);
    setLibraryDraft(libraryDir);
  }, [libraryDir]);

  useEffect(() => {
    setSpeedState(nearestSpeed(prefs.speed));
    setVolumeState(clampVolumePercent(prefs.volume) / 100);
  }, [prefs.speed, prefs.volume]);

  useEffect(() => {
    if (prefs.mini_player_collapsed === true) setMiniCollapsedState(true);
    else if (prefs.mini_player_collapsed === false) setMiniCollapsedState(false);
  }, [prefs.mini_player_collapsed]);

  const setMiniCollapsed = useCallback(
    (v: boolean) => {
      setMiniCollapsedState(v);
      void onPrefsChange({ mini_player_collapsed: v });
    },
    [onPrefsChange],
  );

  const chapterMediaPath = useCallback(
    (index: number): string => {
      const ch = chapters[index];
      if (ch?.file) return ch.file;
      return baseMediaPathRef.current;
    },
    [chapters],
  );

  const loadChapterMedia = useCallback(
    async (index: number, offsetMs: number, spd: number, autoplay: boolean) => {
      const path = chapterMediaPath(index);
      if (!path) return;
      const ch = chapters[index];
      const merged = isMergedAudiobook(chapters);
      const audioSeekMs = merged ? (ch?.start_ms ?? 0) + offsetMs : offsetMs;
      setSpeedStatus(Math.abs(spd - 1) >= 0.01 ? `Preparing ${spd}× playback…` : null);
      try {
        const url = await resolveSpeedMediaUrl(path, spd);
        if (!mountedRef.current || !url) return;
        const audio = audioRef.current;
        if (!audio) return;
        const wasPlaying = !audio.paused;
        const sameMedia = loadedMediaPathRef.current === path;
        setPlayableUrl(url);
        if (!sameMedia) {
          loadedMediaPathRef.current = path;
          audio.src = url;
          await new Promise<void>((resolve) => {
            const onMeta = () => {
              audio.removeEventListener("loadedmetadata", onMeta);
              resolve();
            };
            audio.addEventListener("loadedmetadata", onMeta);
            audio.load();
          });
        }
        audio.currentTime = audioSeekMs / 1000;
        setChapterMs(offsetMs);
        setActiveChapter(index);
        setCurrentMs(merged ? audioSeekMs : bookPositionMs(chapters, index, offsetMs));
        if (autoplay || wasPlaying) {
          await audio.play();
          setPlaying(true);
        }
      } catch (err) {
        onLog(err instanceof Error ? err.message : String(err), "danger");
      } finally {
        if (mountedRef.current) setSpeedStatus(null);
      }
    },
    [chapterMediaPath, chapters, onLog],
  );

  const refreshLibrary = useCallback(async () => {
    if (!libraryRoot.trim()) {
      setItems([]);
      return;
    }
    try {
      const list = await getLibrary(libraryRoot);
      if (!mountedRef.current) return;
      setItems(list);
      const covers: Record<string, string | null> = {};
      for (const item of list) {
        covers[item.audio_path] = item.cover_path ? await resolveMediaUrl(item.cover_path) : null;
      }
      if (!mountedRef.current) return;
      setCoverMap(covers);
    } catch (err) {
      onLog(err instanceof Error ? err.message : String(err), "danger");
    }
  }, [libraryRoot, onLog]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const loadItem = useCallback(
    async (item: LibraryItem) => {
      try {
        setSelected(item);
        loadedMediaPathRef.current = "";
        const data = await getChapters(item.audio_path);
        if (!mountedRef.current) return;
        const nextChapters = Array.isArray(data.chapters) ? data.chapters : [];
        setChapters(nextChapters);
        baseMediaPathRef.current = data.playable_path ?? item.audio_path;
        const cover =
          coverMap[item.audio_path] ?? (await resolveMediaUrl(item.cover_path));
        if (!mountedRef.current) return;
        setCoverUrl(cover);

        const resume = await getResume();
        if (!mountedRef.current) return;
        const saved = resume[item.audio_path] as { ms?: number; chapter?: number } | undefined;
        let startIndex = 0;
        let offsetMs = 0;
        if (saved?.ms != null && Number.isFinite(saved.ms) && nextChapters.length) {
          const seek = seekBookMs(nextChapters, saved.ms);
          startIndex = typeof saved.chapter === "number" ? saved.chapter : seek.index;
          offsetMs = seek.offsetMs;
        }
        await loadChapterMedia(startIndex, offsetMs, speed, false);
      } catch (err) {
        onLog(err instanceof Error ? err.message : String(err), "danger");
      }
    },
    [coverMap, loadChapterMedia, onLog, speed],
  );

  const loadFromPath = useCallback(
    async (audioPath: string) => {
      const match = items.find((i) => i.audio_path === audioPath);
      if (match) {
        await loadItem(match);
        return;
      }
      const stub: LibraryItem = {
        label: audioPath.split(/[/\\]/).pop() ?? audioPath,
        audio_path: audioPath,
        markdown_path: null,
        cover_path: null,
      };
      await loadItem(stub);
    },
    [items, loadItem],
  );

  const selectByPath = useCallback(
    (audioPath: string) => {
      const match = items.find((i) => i.audio_path === audioPath);
      if (match) void loadItem(match);
    },
    [items, loadItem],
  );

  const lastLoadedRef = useRef("");

  useEffect(() => {
    if (!lastAudiobook || lastAudiobook === lastLoadedRef.current) return;
    lastLoadedRef.current = lastAudiobook;
    void loadFromPath(lastAudiobook);
  }, [lastAudiobook, loadFromPath]);

  useEffect(() => {
    if (!markdownPath || !items.length) return;
    const match = items.find((i) => i.markdown_path === markdownPath);
    if (match && selected?.audio_path !== match.audio_path) {
      void loadItem(match);
    }
  }, [markdownPath, items, loadItem, selected?.audio_path]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume, playableUrl]);

  const persistResume = useCallback(async () => {
    if (!selected || !audioRef.current) return;
    try {
      const resume = await getResume();
      resume[selected.audio_path] = {
        ms: Math.floor(currentMs),
        chapter: activeChapter,
      };
      await saveResume(resume);
    } catch {
      /* non-fatal */
    }
  }, [activeChapter, currentMs, selected]);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !playableUrl) return;
    try {
      if (audio.paused) {
        await audio.play();
        setPlaying(true);
      } else {
        audio.pause();
        setPlaying(false);
        void persistResume();
      }
    } catch (err) {
      onLog(err instanceof Error ? err.message : String(err), "danger");
    }
  }, [onLog, persistResume, playableUrl]);

  const seekChapter = useCallback(
    async (index: number, offsetMs = 0) => {
      if (index < 0 || index >= chapters.length) return;
      await loadChapterMedia(index, offsetMs, speed, playing);
    },
    [chapters.length, loadChapterMedia, playing, speed],
  );

  const seekBook = useCallback(
    async (bookMs: number) => {
      if (!chapters.length) {
        const audio = audioRef.current;
        if (audio) audio.currentTime = bookMs / 1000;
        setCurrentMs(bookMs);
        return;
      }
      const { index, offsetMs } = seekBookMs(chapters, bookMs);
      await loadChapterMedia(index, offsetMs, speed, playing);
    },
    [chapters, loadChapterMedia, playing, speed],
  );

  const skipSeconds = useCallback(
    (delta: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const chDur = chapters[activeChapter]?.duration_ms ?? audio.duration * 1000;
      const nextChapterMs = Math.max(0, Math.min(chDur, chapterMs + delta * 1000));
      void loadChapterMedia(activeChapter, nextChapterMs, speed, playing);
    },
    [activeChapter, chapterMs, chapters, loadChapterMedia, playing, speed],
  );

  const setSpeed = useCallback(
    async (v: (typeof SPEED_OPTIONS)[number]) => {
      setSpeedState(v);
      if (prefs.remember_speed !== false) {
        void onPrefsChange({ speed: v, remember_speed: true });
      }
      const offset = chapterMs;
      await loadChapterMedia(activeChapter, offset, v, playing);
    },
    [activeChapter, chapterMs, loadChapterMedia, onPrefsChange, playing, prefs.remember_speed],
  );

  const setVolume = useCallback(
    (pct: number) => {
      const clamped = clampVolumePercent(pct);
      setVolumeState(clamped / 100);
      void onPrefsChange({ volume: clamped });
    },
    [onPrefsChange],
  );

  const applyLibraryPath = useCallback(async () => {
    const trimmed = libraryDraft.trim();
    setLibraryRoot(trimmed);
    if (trimmed !== libraryDir) {
      await onPrefsChange({ audiobook_library_dir: trimmed });
    }
  }, [libraryDir, libraryDraft, onPrefsChange]);

  const chooseLibrary = useCallback(async () => {
    const folder = await pickFolder();
    if (!folder) return;
    setLibraryDraft(folder);
    setLibraryRoot(folder);
    await onPrefsChange({ audiobook_library_dir: folder });
  }, [onPrefsChange]);

  const openAudiobook = useCallback(async () => {
    if (!selected) return;
    const { openPath } = await import("../bridge/tauri");
    await openPath(selected.audio_path);
  }, [selected]);

  const totalDurationMs = useMemo(() => totalBookDurationMs(chapters), [chapters]);
  const chapterDurationMs = chapters[activeChapter]?.duration_ms ?? 0;
  const chapterTitle = chapters[activeChapter]?.title ?? selected?.label ?? "";
  const subtitle = selected?.label ?? "";

  const value: PlayerContextValue = {
    loaded: Boolean(selected && playableUrl),
    selected,
    chapters,
    items,
    libraryRoot,
    libraryDraft,
    setLibraryDraft,
    coverUrl,
    coverMap,
    playing,
    currentMs,
    chapterMs,
    chapterDurationMs,
    totalDurationMs,
    speed,
    volume,
    activeChapter,
    speedStatus,
    miniCollapsed,
    setMiniCollapsed,
    refreshLibrary,
    applyLibraryPath,
    chooseLibrary,
    loadItem,
    loadFromPath,
    selectByPath,
    togglePlay,
    seekChapter,
    seekBook,
    skipSeconds,
    setSpeed,
    setVolume,
    openAudiobook,
    chapterTitle,
    subtitle,
  };

  return (
    <PlayerContext.Provider value={value}>
      <audio
        ref={audioRef}
        preload="metadata"
        hidden
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (!audio || chapters.length) return;
          const metaMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
          if (metaMs > 0) setChapterMs(Math.min(chapterMs, metaMs));
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          void persistResume();
        }}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio || !chapters.length) return;
          if (isMergedAudiobook(chapters)) {
            const absoluteMs = audio.currentTime * 1000;
            const { index, offsetMs } = seekBookMs(chapters, absoluteMs);
            setActiveChapter(index);
            setChapterMs(offsetMs);
            setCurrentMs(absoluteMs);
            return;
          }
          const tMs = audio.currentTime * 1000;
          setChapterMs(tMs);
          setCurrentMs(bookPositionMs(chapters, activeChapter, tMs));
        }}
        onEnded={() => {
          if (activeChapter + 1 < chapters.length) {
            void seekChapter(activeChapter + 1, 0).then(() => void audioRef.current?.play());
          } else {
            setPlaying(false);
          }
        }}
      />
      {children}
    </PlayerContext.Provider>
  );
}
