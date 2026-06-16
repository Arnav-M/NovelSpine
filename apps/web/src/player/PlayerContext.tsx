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
  getCover,
  getLibrary,
  getResume,
  saveResume,
  type Chapter,
  type LibraryItem,
  type Prefs,
} from "../api/client";
import type { LogEntry } from "../components/ActivityLog";
import {
  baseName,
  libraryLabelForPath,
  clampVolumePercent,
  nearestSpeed,
  pathsEqual,
  pickLibraryItemForMarkdown,
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
import { usePlayerSidebarState } from "./usePlayerSidebarState";

export interface AudiobookSwitchPrompt {
  path: string;
  label: string;
  currentLabel: string;
  extraReady?: number;
}

export type LoadAudiobookMode = "auto" | "user";

export interface PlayerContextValue {
  loaded: boolean;
  selected: LibraryItem | null;
  chapters: Chapter[];
  items: LibraryItem[];
  projectFolder: string;
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
  refreshLibrary: () => Promise<LibraryItem[]>;
  loadItem: (item: LibraryItem) => Promise<void>;
  loadFromPath: (audioPath: string, libraryItems?: LibraryItem[], mode?: LoadAudiobookMode) => Promise<void>;
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
  readerMarkdownPath: string | null;
  audiobookSwitchPrompt: AudiobookSwitchPrompt | null;
  continueCurrentAudiobook: () => void;
  switchToPendingAudiobook: () => Promise<void>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export interface PlayerLibraryContextValue {
  items: LibraryItem[];
  selected: LibraryItem | null;
  projectFolder: string;
  readerMarkdownPath: string | null;
  chapterCount: number;
  chaptersSidebarOpen: boolean;
  readerSidebarOpen: boolean;
  chaptersOpenMobile: boolean;
  setChaptersSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setReaderSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setChaptersOpenMobile: (open: boolean | ((prev: boolean) => boolean)) => void;
  toggleChaptersSidebar: () => void;
  toggleReaderSidebar: () => void;
  toggleChaptersMobile: () => void;
  refreshLibrary: () => Promise<LibraryItem[]>;
  loadItem: (item: LibraryItem) => Promise<void>;
}

export interface PlayerPlaybackContextValue {
  loaded: boolean;
  chapters: Chapter[];
  activeChapter: number;
  chapterTitle: string;
  chapterMs: number;
  chapterDurationMs: number;
  currentMs: number;
  totalDurationMs: number;
  playing: boolean;
  speed: (typeof SPEED_OPTIONS)[number];
  volume: number;
  coverUrl: string | null;
  speedStatus: string | null;
  togglePlay: () => Promise<void>;
  seekChapter: (index: number, offsetMs?: number) => Promise<void>;
  seekBook: (bookMs: number) => Promise<void>;
  skipSeconds: (delta: number) => void;
  setSpeed: (v: (typeof SPEED_OPTIONS)[number]) => Promise<void>;
  setVolume: (pct: number) => void;
}

const PlayerLibraryContext = createContext<PlayerLibraryContextValue | null>(null);
const PlayerPlaybackContext = createContext<PlayerPlaybackContextValue | null>(null);

export function usePlayerLibrary(): PlayerLibraryContextValue {
  const ctx = useContext(PlayerLibraryContext);
  if (!ctx) throw new Error("usePlayerLibrary must be used within PlayerProvider");
  return ctx;
}

export function usePlayerPlayback(): PlayerPlaybackContextValue {
  const ctx = useContext(PlayerPlaybackContext);
  if (!ctx) throw new Error("usePlayerPlayback must be used within PlayerProvider");
  return ctx;
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}

interface ProviderProps {
  projectFolder: string;
  lastAudiobook: string;
  markdownPath: string;
  prefs: Prefs;
  onPrefsChange: (patch: Prefs) => Promise<void>;
  onLog: (text: string, tone?: LogEntry["tone"]) => void;
  children: ReactNode;
}

export function PlayerProvider({
  projectFolder,
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
  const chaptersRef = useRef<Chapter[]>([]);
  const activeChapterRef = useRef(0);
  const currentMsRef = useRef(0);
  const chapterMsRef = useRef(0);
  const playingRef = useRef(false);
  const selectedRef = useRef<LibraryItem | null>(null);
  const speedRef = useRef(nearestSpeed(prefs.speed));
  const advancingRef = useRef(false);
  const timeRafRef = useRef<number | null>(null);
  const pendingTimeRef = useRef<{
    merged: boolean;
    absoluteMs?: number;
    index?: number;
    offsetMs?: number;
    idx?: number;
    clamped?: number;
  } | null>(null);
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
  const [audiobookSwitchPrompt, setAudiobookSwitchPrompt] =
    useState<AudiobookSwitchPrompt | null>(null);
  const sidebar = usePlayerSidebarState();
  const pendingLibraryRef = useRef<LibraryItem[] | null>(null);
  const playableUrlRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const projectFolderRef = useRef(projectFolder);
  const lastLoadedRef = useRef("");
  const adoptHandledRef = useRef("");
  const refreshKeyRef = useRef("");
  const refreshPromiseRef = useRef<Promise<LibraryItem[]> | null>(null);
  const loadItemInFlightRef = useRef<Promise<void> | null>(null);
  const resumeSaveSuspendedRef = useRef(false);
  const lastAudiobookRef = useRef(lastAudiobook);
  const markdownPathRef = useRef(markdownPath);
  const prevProjectFolderRef = useRef(projectFolder);

  projectFolderRef.current = projectFolder;
  lastAudiobookRef.current = lastAudiobook;
  markdownPathRef.current = markdownPath;

  useEffect(() => {
    chaptersRef.current = chapters;
  }, [chapters]);

  useEffect(() => {
    activeChapterRef.current = activeChapter;
  }, [activeChapter]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    playableUrlRef.current = playableUrl;
  }, [playableUrl]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const pausePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
    }
    setPlaying(false);
  }, []);

  const findResumeEntry = useCallback(
    (resume: Record<string, unknown>, audioPath: string): { ms?: number; chapter?: number } | undefined => {
      const direct = resume[audioPath];
      if (direct && typeof direct === "object") {
        return direct as { ms?: number; chapter?: number };
      }
      const aliasKey = Object.keys(resume).find((key) => pathsEqual(key, audioPath));
      if (!aliasKey) return undefined;
      const entry = resume[aliasKey];
      return entry && typeof entry === "object"
        ? (entry as { ms?: number; chapter?: number })
        : undefined;
    },
    [],
  );

  const persistResumeForPath = useCallback(
    async (audioPath: string, ms: number, chapter: number, force = false) => {
      if (!audioPath || (resumeSaveSuspendedRef.current && !force)) return;
      try {
        const resume = await getResume();
        resume[audioPath] = {
          ms: Math.max(0, Math.floor(ms)),
          chapter,
        };
        await saveResume(resume);
      } catch {
        /* non-fatal */
      }
    },
    [],
  );

  const shouldOfferSwitch = useCallback((newPath: string) => {
    const current = selectedRef.current;
    if (!current) return false;
    return !pathsEqual(current.audio_path, newPath);
  }, []);

  const offerAudiobookSwitch = useCallback((path: string, list: LibraryItem[]) => {
    pendingLibraryRef.current = list;
    const current = selectedRef.current;
    if (!current) return;

    setAudiobookSwitchPrompt((prev) => {
      if (prev && pathsEqual(prev.path, path)) return prev;
      const label = libraryLabelForPath(list, path);
      if (prev) {
        return {
          path,
          label,
          currentLabel: prev.currentLabel,
          extraReady: (prev.extraReady ?? 0) + 1,
        };
      }
      return {
        path,
        label,
        currentLabel: current.label || libraryLabelForPath(list, current.audio_path),
        extraReady: 0,
      };
    });
  }, []);

  const resolveItemCover = useCallback(
    async (item: LibraryItem): Promise<string | null> => {
      const cached = coverMap[item.audio_path];
      if (cached) return cached;
      if (item.cover_path) {
        const url = await resolveMediaUrl(item.cover_path);
        if (url) return url;
      }
      try {
        const hint = item.markdown_path ?? markdownPath ?? null;
        const { cover_path } = await getCover(item.audio_path, hint);
        if (cover_path) return await resolveMediaUrl(cover_path);
      } catch {
        /* cover optional */
      }
      return null;
    },
    [coverMap, markdownPath],
  );

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

  const resolveChapterMediaPath = useCallback((chapterList: Chapter[], index: number): string => {
    const ch = chapterList[index];
    if (ch?.file) return ch.file;
    return baseMediaPathRef.current;
  }, []);

  const loadChapterMedia = useCallback(
    async (
      index: number,
      offsetMs: number,
      spd: number,
      autoplay: boolean,
      chapterList: Chapter[] = chaptersRef.current,
      ownerAudioPath?: string,
    ) => {
      if (!chapterList.length || index < 0 || index >= chapterList.length) return;
      const stillOwner = () =>
        !ownerAudioPath || pathsEqual(selectedRef.current?.audio_path ?? "", ownerAudioPath);
      if (!stillOwner()) return;

      const path = resolveChapterMediaPath(chapterList, index);
      if (!path) return;
      const ch = chapterList[index];
      const merged = isMergedAudiobook(chapterList);
      const audioSeekMs = merged ? (ch?.start_ms ?? 0) + offsetMs : offsetMs;
      setSpeedStatus(Math.abs(spd - 1) >= 0.01 ? `Preparing ${spd}× playback…` : null);
      try {
        const url = await resolveSpeedMediaUrl(path, spd);
        if (!mountedRef.current || !stillOwner() || !url) return;
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
        if (!stillOwner()) return;
        audio.currentTime = audioSeekMs / 1000;
        const bookMs = merged ? audioSeekMs : bookPositionMs(chapterList, index, offsetMs);
        chapterMsRef.current = offsetMs;
        currentMsRef.current = bookMs;
        setChapterMs(offsetMs);
        setActiveChapter(index);
        setCurrentMs(bookMs);
        if (autoplay || wasPlaying) {
          await audio.play();
          setPlaying(true);
        }
      } catch (err) {
        if (stillOwner()) {
          onLog(err instanceof Error ? err.message : String(err), "danger");
        }
      } finally {
        if (mountedRef.current) setSpeedStatus(null);
      }
    },
    [onLog, resolveChapterMediaPath],
  );

  const refreshLibrary = useCallback(async (): Promise<LibraryItem[]> => {
    const root = projectFolderRef.current.trim();
    if (!root) {
      setItems([]);
      return [];
    }

    const key = root.replace(/\\/g, "/").toLowerCase();
    if (refreshPromiseRef.current && refreshKeyRef.current === key) {
      return refreshPromiseRef.current;
    }
    refreshKeyRef.current = key;

    const run = async (): Promise<LibraryItem[]> => {
      const stillCurrent = () =>
        projectFolderRef.current.trim().replace(/\\/g, "/").toLowerCase() === key;

      try {
        const list = await getLibrary(root);
        if (!mountedRef.current || !stillCurrent()) return list;
        setItems(list);
        const covers: Record<string, string | null> = {};
        for (const item of list) {
          if (!stillCurrent()) return list;
          covers[item.audio_path] = item.cover_path ? await resolveMediaUrl(item.cover_path) : null;
        }
        if (!mountedRef.current || !stillCurrent()) return list;
        setCoverMap(covers);
        return list;
      } catch (err) {
        onLog(err instanceof Error ? err.message : String(err), "danger");
        return [];
      } finally {
        if (refreshKeyRef.current === key) {
          refreshPromiseRef.current = null;
        }
      }
    };

    const promise = run();
    refreshPromiseRef.current = promise;
    return promise;
  }, [onLog]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadItem = useCallback(
    async (item: LibraryItem) => {
      const run = async () => {
        const generation = ++loadGenerationRef.current;
        const isAlive = () => generation === loadGenerationRef.current && mountedRef.current;

        const previous = selectedRef.current;
        if (previous && !pathsEqual(previous.audio_path, item.audio_path)) {
          pausePlayback();
          await persistResumeForPath(
            previous.audio_path,
            currentMsRef.current,
            activeChapterRef.current,
            true,
          );
        }

        resumeSaveSuspendedRef.current = true;
        try {
          setSelected(item);
          setCoverUrl(null);
          loadedMediaPathRef.current = "";
          const data = await getChapters(item.audio_path);
          if (!isAlive()) return;
          const nextChapters = Array.isArray(data.chapters) ? data.chapters : [];
          chaptersRef.current = nextChapters;
          setChapters(nextChapters);
          baseMediaPathRef.current = data.playable_path ?? item.audio_path;
          const cover = await resolveItemCover(item);
          if (!isAlive()) return;
          setCoverUrl(cover);
          if (cover) {
            setCoverMap((prev) => ({ ...prev, [item.audio_path]: cover }));
          }

          const resume = await getResume();
          if (!isAlive()) return;
          const saved = findResumeEntry(resume, item.audio_path);
          let startIndex = 0;
          let offsetMs = 0;
          if (saved?.ms != null && Number.isFinite(saved.ms) && nextChapters.length) {
            const seek = seekBookMs(nextChapters, saved.ms);
            startIndex = seek.index;
            offsetMs = seek.offsetMs;
          }
          if (!isAlive()) return;
          await loadChapterMedia(startIndex, offsetMs, speed, false, nextChapters, item.audio_path);
        } catch (err) {
          if (!isAlive()) return;
          const message = err instanceof Error ? err.message : String(err);
          if (/not found|404/i.test(message)) {
            onLog(`Audiobook file missing: ${baseName(item.audio_path)}`, "muted");
            if (pathsEqual(selectedRef.current?.audio_path ?? "", item.audio_path)) {
              setSelected(null);
              setChapters([]);
              chaptersRef.current = [];
              setPlayableUrl(null);
            }
            return;
          }
          onLog(message, "danger");
        } finally {
          if (generation === loadGenerationRef.current) {
            resumeSaveSuspendedRef.current = false;
          }
        }
      };

      const inFlight = loadItemInFlightRef.current;
      if (inFlight) {
        try {
          await inFlight;
        } catch {
          /* prior load failed */
        }
      }
      const promise = run();
      loadItemInFlightRef.current = promise;
      try {
        await promise;
      } finally {
        if (loadItemInFlightRef.current === promise) {
          loadItemInFlightRef.current = null;
        }
      }
    },
    [findResumeEntry, loadChapterMedia, onLog, pausePlayback, persistResumeForPath, resolveItemCover, speed],
  );

  const loadFromPath = useCallback(
    async (audioPath: string, libraryItems?: LibraryItem[], mode: LoadAudiobookMode = "auto") => {
      if (mode === "auto" && shouldOfferSwitch(audioPath)) {
        offerAudiobookSwitch(audioPath, libraryItems ?? items);
        return;
      }
      pausePlayback();
      const pool = libraryItems ?? items;
      const match = pool.find((i) => pathsEqual(i.audio_path, audioPath));
      if (match) {
        await loadItem(match);
        return;
      }
      const stub: LibraryItem = {
        label: libraryLabelForPath(pool, audioPath),
        audio_path: audioPath,
        markdown_path: markdownPath || null,
        cover_path: null,
      };
      await loadItem(stub);
    },
    [items, loadItem, markdownPath, offerAudiobookSwitch, pausePlayback, shouldOfferSwitch],
  );

  const selectByPath = useCallback(
    (audioPath: string) => {
      const match = items.find((i) => pathsEqual(i.audio_path, audioPath));
      if (match) void loadItem(match);
    },
    [items, loadItem],
  );

  const refreshLibraryRef = useRef(refreshLibrary);
  const loadFromPathRef = useRef(loadFromPath);
  const offerAudiobookSwitchRef = useRef(offerAudiobookSwitch);
  const shouldOfferSwitchRef = useRef(shouldOfferSwitch);
  refreshLibraryRef.current = refreshLibrary;
  loadFromPathRef.current = loadFromPath;
  offerAudiobookSwitchRef.current = offerAudiobookSwitch;
  shouldOfferSwitchRef.current = shouldOfferSwitch;

  const clearLoadedAudiobook = useCallback(() => {
    pausePlayback();
    setSelected(null);
    setChapters([]);
    setPlayableUrl(null);
    setCoverUrl(null);
    setCurrentMs(0);
    setChapterMs(0);
    setActiveChapter(0);
    currentMsRef.current = 0;
    chapterMsRef.current = 0;
    activeChapterRef.current = 0;
    chaptersRef.current = [];
    loadedMediaPathRef.current = "";
    lastLoadedRef.current = "";
  }, [pausePlayback]);

  useEffect(() => {
    let cancelled = false;
    const folderChanged = !pathsEqual(prevProjectFolderRef.current, projectFolder);
    prevProjectFolderRef.current = projectFolder;

    if (folderChanged) {
      refreshKeyRef.current = "";
      refreshPromiseRef.current = null;
      setItems([]);
      setCoverMap({});
      if (selectedRef.current) {
        clearLoadedAudiobook();
      }
    }

    async function syncLibraryForFolder() {
      const list = await refreshLibraryRef.current();
      if (cancelled || !mountedRef.current) return;

      const md = markdownPathRef.current;
      if (!md || !list.length) return;

      const match = pickLibraryItemForMarkdown(list, md, lastAudiobookRef.current);
      if (!match) return;
      if (pathsEqual(selectedRef.current?.audio_path ?? "", match.audio_path)) return;
      if (pathsEqual(lastLoadedRef.current, match.audio_path)) return;

      await loadFromPathRef.current(match.audio_path, list, "auto");
    }

    void syncLibraryForFolder();
    return () => {
      cancelled = true;
    };
  }, [projectFolder, clearLoadedAudiobook]);

  useEffect(() => {
    if (!lastAudiobook) return;
    if (pathsEqual(lastAudiobook, adoptHandledRef.current)) return;

    let cancelled = false;

    async function adoptNewAudiobook() {
      const path = lastAudiobookRef.current;
      if (!path) return;

      const list = await refreshLibraryRef.current();
      if (cancelled || !mountedRef.current) return;

      adoptHandledRef.current = path;

      if (pathsEqual(path, lastLoadedRef.current)) return;

      if (shouldOfferSwitchRef.current(path)) {
        pendingLibraryRef.current = list;
        offerAudiobookSwitchRef.current(path, list);
        return;
      }

      if (selectedRef.current && pathsEqual(selectedRef.current.audio_path, path)) {
        lastLoadedRef.current = path;
        return;
      }

      lastLoadedRef.current = path;
      await loadFromPathRef.current(path, list, "user");
    }

    void adoptNewAudiobook();
    return () => {
      cancelled = true;
    };
  }, [lastAudiobook]);

  useEffect(() => {
    if (!markdownPath || !items.length) return;
    const match = pickLibraryItemForMarkdown(items, markdownPath, lastAudiobook);
    if (!match || pathsEqual(selected?.audio_path ?? "", match.audio_path)) return;
    if (pathsEqual(lastLoadedRef.current, match.audio_path)) return;
    if (audiobookSwitchPrompt && pathsEqual(audiobookSwitchPrompt.path, match.audio_path)) return;
    void loadFromPath(match.audio_path, items, "auto");
  }, [
    audiobookSwitchPrompt,
    lastAudiobook,
    markdownPath,
    items,
    loadFromPath,
    selected,
    selected?.audio_path,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume, playableUrl]);

  const persistResume = useCallback(async () => {
    const item = selectedRef.current;
    if (!item?.audio_path || !audioRef.current) return;
    await persistResumeForPath(item.audio_path, currentMsRef.current, activeChapterRef.current);
  }, [persistResumeForPath]);

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
      const merged = isMergedAudiobook(chapters);
      const ch = chapters[index];
      const optimisticMs = merged
        ? (ch?.start_ms ?? 0) + offsetMs
        : bookPositionMs(chapters, index, offsetMs);
      setActiveChapter(index);
      setChapterMs(offsetMs);
      setCurrentMs(optimisticMs);
      chapterMsRef.current = offsetMs;
      currentMsRef.current = optimisticMs;
      await loadChapterMedia(index, offsetMs, speed, playing);
    },
    [chapters, loadChapterMedia, playing, speed],
  );

  const skipSeconds = useCallback(
    (delta: number) => {
      if (!chapters.length) return;
      const idx = activeChapterRef.current;
      const chDur = chapters[idx]?.duration_ms ?? 0;
      const targetMs = chapterMs + delta * 1000;
      if (chDur > 0 && targetMs > chDur && idx + 1 < chapters.length) {
        void seekChapter(idx + 1, Math.max(0, targetMs - chDur));
        return;
      }
      if (targetMs < 0 && idx > 0) {
        const prevDur = chapters[idx - 1]?.duration_ms ?? 0;
        void seekChapter(idx - 1, Math.max(0, prevDur + targetMs));
        return;
      }
      const nextChapterMs = Math.max(0, chDur > 0 ? Math.min(chDur, targetMs) : targetMs);
      void loadChapterMedia(idx, nextChapterMs, speed, playing);
    },
    [chapterMs, chapters, loadChapterMedia, playing, seekChapter, speed],
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

  const openAudiobook = useCallback(async () => {
    if (!selected) return;
    try {
      const data = await getChapters(selected.audio_path, false);
      const candidate = data.playable_path ?? selected.audio_path;
      const { openPathWithApp } = await import("../bridge/tauri");
      await openPathWithApp(candidate);
    } catch (err) {
      onLog(err instanceof Error ? err.message : String(err), "danger");
    }
  }, [onLog, selected]);

  const continueCurrentAudiobook = useCallback(() => {
    setAudiobookSwitchPrompt((prompt) => {
      if (prompt) {
        lastLoadedRef.current = prompt.path;
        adoptHandledRef.current = prompt.path;
        pendingLibraryRef.current = null;
        const extra = prompt.extraReady ?? 0;
        onLog(
          extra > 0
            ? `Continuing ${prompt.currentLabel}. ${extra + 1} new audiobooks are in your library.`
            : `Continuing ${prompt.currentLabel}. New audiobook saved as ${prompt.label}.`,
          "muted",
        );
      }
      return null;
    });
  }, [onLog]);

  const switchToPendingAudiobook = useCallback(async () => {
    const prompt = audiobookSwitchPrompt;
    if (!prompt) return;
    const list = pendingLibraryRef.current;
    const extra = prompt.extraReady ?? 0;
    setAudiobookSwitchPrompt(null);
    pendingLibraryRef.current = null;
    lastLoadedRef.current = prompt.path;
    pausePlayback();
    await loadFromPath(prompt.path, list ?? undefined, "user");
    if (extra > 0) {
      onLog(`${extra} other new audiobook(s) are available in the library.`, "muted");
    }
  }, [audiobookSwitchPrompt, loadFromPath, onLog, pausePlayback]);

  const totalDurationMs = useMemo(() => totalBookDurationMs(chapters), [chapters]);
  const chapterDurationMs = chapters[activeChapter]?.duration_ms ?? 0;
  const chapterTitle = chapters[activeChapter]?.title ?? selected?.label ?? "";
  const subtitle = selected?.label ?? "";
  const readerMarkdownPath = selected?.markdown_path ?? (markdownPath || null);

  const libraryValue = useMemo<PlayerLibraryContextValue>(
    () => ({
      items,
      selected,
      projectFolder,
      readerMarkdownPath,
      chapterCount: chapters.length,
      chaptersSidebarOpen: sidebar.chaptersSidebarOpen,
      readerSidebarOpen: sidebar.readerSidebarOpen,
      chaptersOpenMobile: sidebar.chaptersOpenMobile,
      setChaptersSidebarOpen: sidebar.setChaptersSidebarOpen,
      setReaderSidebarOpen: sidebar.setReaderSidebarOpen,
      setChaptersOpenMobile: sidebar.setChaptersOpenMobile,
      toggleChaptersSidebar: sidebar.toggleChaptersSidebar,
      toggleReaderSidebar: sidebar.toggleReaderSidebar,
      toggleChaptersMobile: sidebar.toggleChaptersMobile,
      refreshLibrary,
      loadItem,
    }),
    [
      items,
      selected,
      projectFolder,
      readerMarkdownPath,
      chapters.length,
      sidebar,
      refreshLibrary,
      loadItem,
    ],
  );

  const playbackValue = useMemo<PlayerPlaybackContextValue>(
    () => ({
      loaded: Boolean(selected && playableUrl),
      chapters,
      activeChapter,
      chapterTitle,
      chapterMs,
      chapterDurationMs,
      currentMs,
      totalDurationMs,
      playing,
      speed,
      volume,
      coverUrl,
      speedStatus,
      togglePlay,
      seekChapter,
      seekBook,
      skipSeconds,
      setSpeed,
      setVolume,
    }),
    [
      selected,
      playableUrl,
      chapters,
      activeChapter,
      chapterTitle,
      chapterMs,
      chapterDurationMs,
      currentMs,
      totalDurationMs,
      playing,
      speed,
      volume,
      coverUrl,
      speedStatus,
      togglePlay,
      seekChapter,
      seekBook,
      skipSeconds,
      setSpeed,
      setVolume,
    ],
  );

  const value: PlayerContextValue = {
    loaded: Boolean(selected && playableUrl),
    selected,
    chapters,
    items,
    projectFolder,
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
    readerMarkdownPath,
    audiobookSwitchPrompt,
    continueCurrentAudiobook,
    switchToPendingAudiobook,
  };

  return (
    <PlayerLibraryContext.Provider value={libraryValue}>
      <PlayerPlaybackContext.Provider value={playbackValue}>
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
          const list = chaptersRef.current;
          if (!audio || !list.length) return;
          if (isMergedAudiobook(list)) {
            const absoluteMs = audio.currentTime * 1000;
            const { index, offsetMs } = seekBookMs(list, absoluteMs);
            pendingTimeRef.current = {
              merged: true,
              absoluteMs,
              index,
              offsetMs,
            };
          } else {
            const idx = activeChapterRef.current;
            const ch = list[idx];
            const chDur = ch?.duration_ms ?? 0;
            const tMs = audio.currentTime * 1000;
            if (
              chDur > 0 &&
              tMs >= chDur - 250 &&
              idx + 1 < list.length &&
              !advancingRef.current
            ) {
              advancingRef.current = true;
              void loadChapterMedia(idx + 1, 0, speedRef.current, playingRef.current).finally(
                () => {
                  advancingRef.current = false;
                },
              );
              return;
            }
            const clamped = chDur > 0 ? Math.min(tMs, chDur) : tMs;
            pendingTimeRef.current = {
              merged: false,
              idx,
              clamped,
            };
          }
          if (timeRafRef.current != null) return;
          timeRafRef.current = requestAnimationFrame(() => {
            timeRafRef.current = null;
            const pending = pendingTimeRef.current;
            if (!pending) return;
            pendingTimeRef.current = null;
            if (pending.merged) {
              setActiveChapter(pending.index!);
              setChapterMs(pending.offsetMs!);
              setCurrentMs(pending.absoluteMs!);
              chapterMsRef.current = pending.offsetMs!;
              currentMsRef.current = pending.absoluteMs!;
              return;
            }
            const chaptersList = chaptersRef.current;
            const nextChapterMs = pending.clamped!;
            const nextBookMs = bookPositionMs(chaptersList, pending.idx!, nextChapterMs);
            setChapterMs(nextChapterMs);
            setCurrentMs(nextBookMs);
            chapterMsRef.current = nextChapterMs;
            currentMsRef.current = nextBookMs;
          });
        }}
        onEnded={() => {
          const idx = activeChapterRef.current;
          const list = chaptersRef.current;
          if (idx + 1 < list.length) {
            void loadChapterMedia(idx + 1, 0, speedRef.current, true);
          } else {
            setPlaying(false);
          }
        }}
      />
      {children}
        </PlayerContext.Provider>
      </PlayerPlaybackContext.Provider>
    </PlayerLibraryContext.Provider>
  );
}
