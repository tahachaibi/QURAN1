/**
 * The one place a recitation session lives (spec §2).
 *
 * Mounted ABOVE the router in app/_layout.tsx. Screens subscribe; unmounting a
 * surah screen cannot stop a session, and moving to another surah is just the
 * cursor changing value. There is no navigation, no remount and no
 * "handoff/adopt" mechanism anywhere in this file, because there is nothing to
 * hand off — the microphone and the cursor never belonged to a screen.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import {
  ayahStartWord,
  globalAyahOf,
  pageOf,
  pageWordRange,
  surahOf,
  surahWordRange,
  TOTAL_WORDS,
  words,
} from '../data/quran';
import { collectEvidence } from '../engine/evidence';
import { applyEvidence, dueQueue, summarize, type HifzDeck } from '../engine/hifz';
import type { MistakeRecord } from '../engine/confusion';
import { vocabulary } from '../engine/searchIndex';
import {
  elapsedOf,
  initialSession,
  sessionReducer,
  type SessionConfig,
  type SessionEvent,
  type SessionState,
} from '../engine/session';
import type { Mistake } from '../engine/mistakes';
import { useRecitationRecognizer, type RecognizerHandle } from '../recognition/useRecitationRecognizer';
import { useTheme } from '../theme/ThemeProvider';
import {
  addDismissed,
  appendMistakeLog,
  bestPreviousFor,
  loadDismissed,
  loadHifzDeck,
  logSession,
  saveHifzDeck,
  saveProgress,
  today,
  type LoggedSession,
} from '../data/storage';
import type { ReplayFixture } from '../engine/replay';

export type ReadMode = 'follow' | 'hidden';

export interface AyahRange {
  from: number;
  to: number;
}

export interface SessionSummary {
  wordsRecited: number;
  versesCovered: number;
  accuracy: number;
  longestCleanRun: number;
  hintedWords: number[];
  mistakes: readonly Mistake[];
  durationMs: number;
  furthestWord: number;
  surah: number;
  /** null when this surah has never been recited before */
  previousFurthest: number | null;
  /** per-ayah hifz grades this session produced (0..5) */
  graded: { ayah: number; grade: number }[];
  /** how many ayahs are due for review right now, after this session */
  dueNow: number;
}

export interface RecitationContextValue {
  session: SessionState;
  recognizer: RecognizerHandle;
  /** smoothed voice level, 0..1; drives the mic pulse and the voice underline */
  level: Animated.Value;

  mode: ReadMode;
  setMode: (mode: ReadMode) => void;

  /** the page the reader is LOOKING at; the cursor is wherever the voice is */
  viewedPage: number;
  setViewedPage: (page: number) => void;
  /** true when the viewed page is not the page the voice is on (§6.4) */
  awayFromPlace: boolean;
  returnToMyPlace: () => void;

  /** hint ladder: 0 none, 1 first letter, 2 whole word (§6.2) */
  hintLevelOf: (word: number) => 0 | 1 | 2;
  requestHint: (word: number) => void;
  hintedWords: number[];

  range: AyahRange | null;
  setRange: (range: AyahRange | null) => void;

  start: (fromWord?: number) => void;
  stop: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
  resetStats: () => void;
  seekTo: (word: number) => void;
  dismissMistake: (word: number) => void;

  elapsedMs: number;
  summary: SessionSummary | null;
  dismissSummary: () => void;
  logSummaryToTracker: () => Promise<void>;

  /**
   * Milliseconds between the last two partials the recognizer emitted.
   *
   * The engine costs about a millisecond per partial, so this number IS the
   * responsiveness of following — it is how often Android is willing to tell us
   * what it heard, and nothing in this app can make it smaller. Measured so the
   * question "why does it feel slow" has an answer instead of a theory. Only
   * updated while the debug overlay is on; it must not cost a render otherwise.
   */
  partialGapMs: number;

  /** why the session paused, for the one-tap resume affordance (§4) */
  interruption: string | null;
  clearInterruption: () => void;
  silenceTimedOut: boolean;

  /** a capture of this session's recognizer events, exportable as a fixture (§9) */
  captureFixture: () => ReplayFixture;

  /** start a practice run over a word range, from its first word */
  practiseRange: (from: number, to: number) => void;

  /**
   * Register a function that stops Listen-tab playback. Called when the mic
   * starts (§4) — done explicitly rather than by relying on audio focus, which
   * governs playback and says nothing about who holds the microphone.
   */
  registerPlaybackStopper: (stop: (() => void) | null) => void;
}

const RecitationContext = createContext<RecitationContextValue | null>(null);

/** Haptics fire per completed AYAH, never per word — per-word is maddening. */
const HAPTIC_PER_AYAH = true;

export function RecitationProvider({ children }: { children: ReactNode }) {
  const { prefs } = useTheme();
  const [mode, setMode] = useState<ReadMode>(prefs.hiddenMode ? 'hidden' : 'follow');
  const [viewedPage, setViewedPage] = useState(1);
  const [range, setRange] = useState<AyahRange | null>(null);
  const [hints, setHints] = useState<Map<number, 1 | 2>>(() => new Map());
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [interruption, setInterruption] = useState<string | null>(null);
  const [silenceTimedOut, setSilenceTimedOut] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const hifzDeck = useRef<HifzDeck>({});
  /**
   * The deck loads asynchronously. Grading against an empty deck because the
   * load had not landed yet would overwrite real review history with a fresh
   * card, so the summary path awaits the load instead of assuming it.
   */
  const hifzLoaded = useRef<Promise<void> | null>(null);
  /**
   * Guards against double-grading. Applying one session's evidence twice would
   * push every ayah in it a step further up the interval ladder on the strength
   * of a single recitation.
   */
  const gradedSessionAt = useRef(0);
  const playbackStopper = useRef<(() => void) | null>(null);

  const config = useMemo<SessionConfig>(
    () => ({
      words,
      surahOf,
      vocabulary: vocabulary(),
      floor: range?.from ?? 0,
      limit: range === null ? TOTAL_WORDS : range.to + 1,
      viewSurah: undefined,
    }),
    [range],
  );

  // The config the reducer sees must include the surah currently in view, but
  // rebuilding it on every page swipe would churn; keep it in a ref instead.
  const configRef = useRef(config);
  configRef.current = { ...config, viewSurah: surahOf(pageWordRange(viewedPage)[0]) };

  const [session, rawDispatch] = useReducer(
    (state: SessionState, event: SessionEvent) => sessionReducer(state, event, configRef.current),
    initialSession(0),
  );

  const dispatch = useCallback((event: SessionEvent) => rawDispatch(event), []);

  // --- recognizer event capture, for the replay harness (§9) ---
  const capture = useRef<ReplayFixture>({ name: 'captured', startCursor: 0, events: [] });
  const lastEventAt = useRef(0);
  const recordEvent = useCallback(
    (kind: 'partial' | 'final' | 'segment', alternatives?: string[]) => {
      const now = Date.now();
      const dt = lastEventAt.current === 0 ? 0 : now - lastEventAt.current;
      lastEventAt.current = now;
      const events = capture.current.events;
      // bound the capture so a five-minute session cannot grow without limit
      if (events.length < 4000) events.push({ kind, alternatives, dt });
    },
    [],
  );

  /**
   * Recognizer cadence, tracked in a ref so measuring it is free, and copied into
   * state only when someone is looking at the overlay.
   */
  const lastPartialAt = useRef(0);
  const [partialGapMs, setPartialGapMs] = useState(0);
  const watchingDebug = useRef(prefs.showDebugOverlay);
  watchingDebug.current = prefs.showDebugOverlay;

  const recognizer = useRecitationRecognizer({
    locale: prefs.locale,
    preferOnDevice: prefs.preferOnDevice,
    allowSegmented: prefs.allowSegmented,
    onPartial: useCallback(
      (event) => {
        const at = Date.now();
        const previous = lastPartialAt.current;
        lastPartialAt.current = at;
        if (watchingDebug.current && previous !== 0) setPartialGapMs(at - previous);
        recordEvent('partial', event.alternatives);
        dispatch({ type: 'partial', alternatives: event.alternatives, at, emittedAt: event.emittedAt });
      },
      [dispatch, recordEvent],
    ),
    onFinal: useCallback(
      (event) => {
        recordEvent('final', event.alternatives);
        dispatch({ type: 'final', alternatives: event.alternatives, at: Date.now(), emittedAt: event.emittedAt });
      },
      [dispatch, recordEvent],
    ),
    onEndOfSegment: useCallback(() => {
      recordEvent('segment');
      dispatch({ type: 'endOfSegment', at: Date.now() });
    }, [dispatch, recordEvent]),
    onSilenceTimeout: useCallback(() => {
      setSilenceTimedOut(true);
      dispatch({ type: 'pause', at: Date.now() });
    }, [dispatch]),
    onInterrupted: useCallback(
      (reason: string) => {
        setInterruption(reason);
        dispatch({ type: 'pause', at: Date.now() });
      },
      [dispatch],
    ),
  });

  /**
   * Interruption and silence notices clear themselves. Left up permanently they
   * sat over the page and over the Listen controls; the mic button is always
   * there to resume, so the chip does not need to be.
   */
  useEffect(() => {
    if (interruption === null) return undefined;
    const id = setTimeout(() => setInterruption(null), 5000);
    return () => clearTimeout(id);
  }, [interruption]);

  useEffect(() => {
    if (!silenceTimedOut) return undefined;
    const id = setTimeout(() => setSilenceTimedOut(false), 6000);
    return () => clearTimeout(id);
  }, [silenceTimedOut]);

  // --- restore permanently dismissed false positives (§5.6) ---
  useEffect(() => {
    void loadDismissed().then((list) => {
      if (list.length > 0) dispatch({ type: 'restoreDismissed', words: list });
    });
    hifzLoaded.current = loadHifzDeck().then((deck) => {
      hifzDeck.current = deck;
    });
  }, [dispatch]);

  // --- keep the screen awake for the whole session (§6.7) ---
  useEffect(() => {
    if (session.status === 'listening') {
      void activateKeepAwakeAsync('recitation');
      return () => {
        void deactivateKeepAwake('recitation');
      };
    }
    return undefined;
  }, [session.status]);

  // --- follow the cursor with the page view, and tick the timer ---
  const cursorPage = pageOf(session.livePos);
  const lastAyahRef = useRef(globalAyahOf(session.cursor));

  useEffect(() => {
    if (session.status !== 'listening') return;
    setViewedPage(cursorPage);
  }, [cursorPage, session.status]);

  // --- haptics per completed ayah (§6.7) ---
  useEffect(() => {
    const ayah = globalAyahOf(session.cursor);
    if (ayah === lastAyahRef.current) return;
    const advanced = ayah > lastAyahRef.current;
    lastAyahRef.current = ayah;
    if (advanced && HAPTIC_PER_AYAH && prefs.haptics && session.status === 'listening') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [session.cursor, session.status, prefs.haptics]);

  // --- light tick on a confirmed mistake (§6.7) ---
  const mistakeCount = session.mistakes.length;
  const lastMistakeCount = useRef(mistakeCount);
  useEffect(() => {
    if (mistakeCount > lastMistakeCount.current && prefs.haptics) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    lastMistakeCount.current = mistakeCount;
  }, [mistakeCount, prefs.haptics]);

  // --- live timer ---
  useEffect(() => {
    if (session.status !== 'listening') {
      setElapsedMs(elapsedOf(session, Date.now()));
      return undefined;
    }
    const id = setInterval(() => setElapsedMs(elapsedOf(session, Date.now())), 500);
    return () => clearInterval(id);
  }, [session]);

  // --- persist resume position per surah (§6.7) ---
  const persistSurah = surahOf(session.cursor);
  useEffect(() => {
    if (session.status === 'idle') return;
    void saveProgress(persistSurah, session.cursor);
  }, [persistSurah, session.cursor, session.status]);

  const registerPlaybackStopper = useCallback((stop: (() => void) | null) => {
    playbackStopper.current = stop;
  }, []);

  const start = useCallback(
    (fromWord?: number) => {
      // Reciting and listening at once would feed the reciter's own audio back
      // into the recognizer (§4).
      playbackStopper.current?.();
      const cursor = fromWord ?? session.cursor;
      capture.current = { name: `session-${new Date().toISOString()}`, startCursor: cursor, events: [] };
      lastEventAt.current = 0;
      setSummary(null);
      setInterruption(null);
      setSilenceTimedOut(false);
      setHints(new Map());
      dispatch({ type: 'start', at: Date.now(), cursor });
      recognizer.start();
    },
    [dispatch, recognizer, session.cursor],
  );

  const buildSummary = useCallback(
    async (state: SessionState): Promise<SessionSummary> => {
      // never grade the same session twice
      const alreadyGraded = gradedSessionAt.current === state.startedAt && state.startedAt !== 0;
      if (hifzLoaded.current !== null) await hifzLoaded.current;
      const surah = surahOf(state.cursor);
      const [surahStart] = surahWordRange(surah);
      const previous = await bestPreviousFor(surah);
      const versesCovered = new Set<number>();
      for (const w of state.matched) versesCovered.add(globalAyahOf(w));
      const attempted = state.matched.size + state.mistakes.length;

      // Fold the session into the hifz deck. This is the part that makes the
      // app remember which ayahs YOU are weak on rather than which ayahs exist.
      const now = Date.now();
      const revealed = new Set<number>();
      for (const [word, level] of hints) if (level === 2) revealed.add(word);
      const evidence = collectEvidence({
        matched: state.matched,
        missed: state.mistakes.map((m) => m.word),
        hinted: state.hinted,
        revealed,
        globalAyahOf,
        ayahWordCount: (globalAyah) => ayahStartWord[globalAyah + 1] - ayahStartWord[globalAyah],
      });
      const folded = alreadyGraded
        ? { deck: hifzDeck.current, graded: [] as { ayah: number; grade: number }[] }
        : applyEvidence(hifzDeck.current, evidence, now);
      if (!alreadyGraded) {
        gradedSessionAt.current = state.startedAt;
        hifzDeck.current = folded.deck;
        void saveHifzDeck(folded.deck);
      }

      // Record the mistakes for the confusion profile. Expected text comes from
      // the word array, so the profile is built on the same normalization the
      // matcher used.
      if (!alreadyGraded) {
        const records: MistakeRecord[] = state.mistakes.map((m) => ({
          word: m.word,
          expected: words[m.word] ?? '',
          heardInstead: m.heardInstead,
        }));
        void appendMistakeLog(records);
      }

      return {
        wordsRecited: state.matched.size,
        versesCovered: versesCovered.size,
        accuracy: attempted === 0 ? 0 : state.matched.size / attempted,
        longestCleanRun: state.longestCleanRun,
        hintedWords: [...state.hinted].sort((a, b) => a - b),
        mistakes: state.mistakes,
        durationMs: elapsedOf(state, now),
        furthestWord: state.cursor,
        surah,
        previousFurthest: previous === null ? null : previous.furthestWord,
        graded: folded.graded,
        dueNow: dueQueue(folded.deck, now, 500).length,
      };
    },
    [hints],
  );

  const stop = useCallback(() => {
    recognizer.stop();
    const stopped = sessionReducer(session, { type: 'stop', at: Date.now() }, configRef.current);
    dispatch({ type: 'stop', at: Date.now() });
    void buildSummary(stopped).then(setSummary);
  }, [buildSummary, dispatch, recognizer, session]);

  const pauseSession = useCallback(() => {
    recognizer.pause();
    dispatch({ type: 'pause', at: Date.now() });
  }, [dispatch, recognizer]);

  const resumeSession = useCallback(() => {
    setInterruption(null);
    setSilenceTimedOut(false);
    recognizer.resume();
    dispatch({ type: 'resume', at: Date.now() });
  }, [dispatch, recognizer]);

  const seekTo = useCallback(
    (word: number) => {
      dispatch({ type: 'seek', to: word, at: Date.now() });
      setViewedPage(pageOf(word));
    },
    [dispatch],
  );

  const dismissMistake = useCallback(
    (word: number) => {
      dispatch({ type: 'dismiss', word });
      void addDismissed(word);
    },
    [dispatch],
  );

  const requestHint = useCallback(
    (word: number) => {
      setHints((current) => {
        const level = current.get(word) ?? 0;
        if (level >= 2) return current;
        const next = new Map(current);
        next.set(word, level === 0 ? 1 : 2);
        return next;
      });
      dispatch({ type: 'hint', word });
    },
    [dispatch],
  );

  const hintLevelOf = useCallback((word: number): 0 | 1 | 2 => hints.get(word) ?? 0, [hints]);

  const practiseRange = useCallback(
    (from: number, to: number) => {
      setRange({ from, to });
      dispatch({ type: 'seek', to: from, at: Date.now() });
      setViewedPage(pageOf(from));
    },
    [dispatch],
  );

  const logSummaryToTracker = useCallback(async () => {
    if (summary === null) return;
    const entry: LoggedSession = {
      id: `${Date.now()}`,
      day: today(),
      at: Date.now(),
      surah: summary.surah,
      wordsRecited: summary.wordsRecited,
      versesCovered: summary.versesCovered,
      accuracy: summary.accuracy,
      longestCleanRun: summary.longestCleanRun,
      hintsUsed: summary.hintedWords.length,
      mistakes: summary.mistakes.length,
      durationMs: summary.durationMs,
      furthestWord: summary.furthestWord,
    };
    await logSession(entry);
  }, [summary]);

  const awayFromPlace = session.status !== 'idle' && viewedPage !== pageOf(session.livePos);

  const value = useMemo<RecitationContextValue>(
    () => ({
      session,
      recognizer,
      level: recognizer.level,
      mode,
      setMode,
      viewedPage,
      setViewedPage,
      awayFromPlace,
      returnToMyPlace: () => setViewedPage(pageOf(session.livePos)),
      hintLevelOf,
      requestHint,
      hintedWords: [...session.hinted].sort((a, b) => a - b),
      range,
      setRange,
      start,
      stop,
      pauseSession,
      resumeSession,
      resetStats: () => dispatch({ type: 'resetStats', at: Date.now() }),
      seekTo,
      dismissMistake,
      elapsedMs,
      summary,
      dismissSummary: () => setSummary(null),
      logSummaryToTracker,
      partialGapMs,
      interruption,
      clearInterruption: () => setInterruption(null),
      silenceTimedOut,
      captureFixture: () => capture.current,
      practiseRange,
      registerPlaybackStopper,
    }),
    [
      session,
      recognizer,
      mode,
      viewedPage,
      awayFromPlace,
      hintLevelOf,
      requestHint,
      range,
      start,
      stop,
      pauseSession,
      resumeSession,
      dispatch,
      seekTo,
      dismissMistake,
      elapsedMs,
      summary,
      logSummaryToTracker,
      partialGapMs,
      interruption,
      silenceTimedOut,
      practiseRange,
      registerPlaybackStopper,
    ],
  );

  return <RecitationContext.Provider value={value}>{children}</RecitationContext.Provider>;
}

export function useRecitation(): RecitationContextValue {
  const value = useContext(RecitationContext);
  if (value === null) {
    throw new Error(
      'useRecitation was called outside RecitationProvider. The provider must stay mounted ABOVE the router ' +
        'in app/_layout.tsx — moving it into a screen is what made the old build drop the microphone on navigation.',
    );
  }
  return value;
}
