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
import { Animated, AppState, Linking, type AppStateStatus } from 'react-native';
import { Audio } from 'expo-av';
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
import {
  applyEvidence,
  applySelfReport,
  ayahsInWordRange,
  dueQueue,
  type HifzDeck,
  type SelfReportKind,
} from '../engine/hifz';
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
  clearDismissed,
  removeDismissed,
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

/** What the OS currently says about the microphone. */
export type MicPermission = 'unknown' | 'granted' | 'denied' | 'blocked';

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
  /**
   * True when this session already reached the tracker on its own.
   *
   * A session that was backgrounded part-way through is flushed and logged
   * without waiting for the summary card, so the card has to be able to say so
   * rather than offer to do it again.
   */
  autoLogged: boolean;
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
  /** undo "I said it right" for one mistake */
  undismissMistake: (mistake: Mistake) => void;
  /** forget every word marked "I said it right" */
  clearDismissedWords: () => void;

  summary: SessionSummary | null;
  dismissSummary: () => void;
  logSummaryToTracker: () => Promise<void>;


  /** why the session paused, for the one-tap resume affordance (§4) */
  interruption: string | null;
  clearInterruption: () => void;
  silenceTimedOut: boolean;

  /** a capture of this session's recognizer events, exportable as a fixture (§9) */
  captureFixture: () => ReplayFixture;

  /** start a practice run over a word range, from its first word */
  practiseRange: (from: number, to: number) => void;

  /**
   * The non-voice way into the revision deck.
   *
   * Commits the ayahs substantially inside `[fromWord, toWord]` (inclusive) as a
   * self-report and returns how many cards actually moved — zero when the same
   * ayahs were already committed inside the cooldown, which the caller should
   * report honestly rather than pretending something happened.
   *
   * This exists because the recogniser is not always available and is never
   * obligatory: no Arabic speech pack, a bus, a masjid, silent reading, or
   * simply a first session that has not happened yet. None of those should mean
   * an empty coach.
   */
  commitSelfReport: (kind: SelfReportKind, fromWord: number, toWord: number) => Promise<number>;

  /**
   * Whether this app may use the microphone, as far as it knows.
   *
   * 'blocked' is the one that matters: Android stops showing the dialog after a
   * second refusal, so asking again does nothing and only the system settings
   * screen can fix it. A UI that keeps offering "Allow" in that state is lying
   * to the user, which is why this is three values and not a boolean.
   */
  micPermission: MicPermission;
  /** Open this app's system settings page, the only route out of 'blocked'. */
  openAppSettings: () => void;

  /**
   * Register a function that stops Listen-tab playback. Called when the mic
   * starts (§4) — done explicitly rather than by relying on audio focus, which
   * governs playback and says nothing about who holds the microphone.
   */
  registerPlaybackStopper: (stop: (() => void) | null) => void;
}

const RecitationContext = createContext<RecitationContextValue | null>(null);

/**
 * Debug-only readings, in their OWN context.
 *
 * `partialGapMs` changes on every partial while the debug overlay is on. In
 * the shared context above that re-rendered every screen in the app three
 * times a second — and the overlay is exactly what somebody turns on when they
 * are trying to find out why the app feels slow, so the instrument was making
 * the thing it measured worse. Only the overlay reads this.
 */
export interface RecitationDebugValue {
  /**
   * Milliseconds between the last two partials the recognizer emitted.
   *
   * The engine costs under a millisecond per partial (measured on real device
   * sessions: 0.24-0.84 ms), so this number IS the responsiveness of following
   * — it is how often Android is willing to say what it heard, and nothing in
   * this app can make it smaller.
   */
  partialGapMs: number;
}

const RecitationDebugContext = createContext<RecitationDebugValue>({ partialGapMs: 0 });

export const useRecitationDebug = (): RecitationDebugValue => useContext(RecitationDebugContext);

/** Haptics fire per completed AYAH, never per word — per-word is maddening. */
const HAPTIC_PER_AYAH = true;

/**
 * How often a LIVE session is allowed to touch AsyncStorage.
 *
 * It used to be far more often than anyone intended. `saveProgress` ran in an
 * effect keyed on `session.cursor`, and the cursor moves once per matched word —
 * several times a second at ordinary recitation speed — and each call is a
 * read-modify-write of the whole progress map, so following a reciter meant a
 * JSON parse and a serialise per word on the storage queue. Everything a live
 * session persists now goes through one timer instead.
 *
 * Thirty seconds is chosen against what is actually lost if the process dies
 * between flushes: at most half a minute of reading position and of grading,
 * which is recoverable by looking at the page. Shorter buys nothing a reciter
 * would notice; much longer starts losing real work.
 */
const FLUSH_INTERVAL_MS = 30_000;

/**
 * Below this, an abandoned session is not worth a row in the tracker.
 *
 * Opening the microphone and putting the phone down is not a recitation, and a
 * streak that can be extended by doing that is not worth having. The explicit
 * "Log to streak" button has no such floor — that is a person deliberately
 * saying it counted.
 */
const AUTO_LOG_MIN_WORDS = 5;

/** Word range of one global ayah, [from, to) — the shape `ayahsInWordRange` wants. */
const ayahWordRangeOf = (globalAyah: number): readonly [number, number] => [
  ayahStartWord[globalAyah],
  ayahStartWord[globalAyah + 1],
];

/**
 * A finished (or abandoned) session as a tracker row.
 *
 * The id is the session's start time rather than the time of writing, so the
 * same session written twice — once when it was backgrounded, once when it was
 * finally stopped — produces two rows the tracker can recognise as one. Nothing
 * in storage can update a row in place, so superseding it is the only way the
 * tail of a resumed session ever reaches the streak.
 *
 * `startedAt` is passed in rather than read off the state, because
 * `state.startedAt` moves on every 'resume' and a row whose id moves with it
 * supersedes nothing. See the `sessionStartedAt` ref.
 */
function trackerEntry(state: SessionState, startedAt: number, now: number): LoggedSession {
  const verses = new Set<number>();
  for (const w of state.matched) verses.add(globalAyahOf(w));
  const attempted = state.matched.size + state.mistakes.length;
  return {
    id: `${startedAt}`,
    day: today(new Date(startedAt)),
    at: startedAt,
    surah: surahOf(state.cursor),
    wordsRecited: state.matched.size,
    versesCovered: verses.size,
    accuracy: attempted === 0 ? 0 : state.matched.size / attempted,
    longestCleanRun: state.longestCleanRun,
    hintsUsed: state.hinted.size,
    mistakes: state.mistakes.length,
    durationMs: elapsedOf(state, now),
    furthestWord: state.cursor,
  };
}

export function RecitationProvider({ children }: { children: ReactNode }) {
  const { prefs, setPrefs } = useTheme();
  const [mode, setModeState] = useState<ReadMode>(prefs.hiddenMode ? 'hidden' : 'follow');
  /**
   * The mode is remembered across launches. It was read from prefs.hiddenMode
   * here and never written back, so somebody who always tests from memory
   * opened the app every morning to the whole page in plain view — which
   * spoils the test before they remember to switch. ThemeProvider renders
   * nothing until prefs have loaded, so the initial read above sees the saved value.
   *
   * setPrefs is reached through a ref because its identity changes with every
   * prefs change, and a setter that changed with it would re-render every
   * consumer of this context whenever any setting moved.
   */
  const setPrefsRef = useRef(setPrefs);
  setPrefsRef.current = setPrefs;
  const setMode = useCallback((next: ReadMode) => {
    setModeState(next);
    setPrefsRef.current({ hiddenMode: next === 'hidden' });
  }, []);
  const [viewedPage, setViewedPage] = useState(1);
  const [range, setRange] = useState<AyahRange | null>(null);
  const [hints, setHints] = useState<Map<number, 1 | 2>>(() => new Map());
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [interruption, setInterruption] = useState<string | null>(null);
  const [silenceTimedOut, setSilenceTimedOut] = useState(false);
  const hifzDeck = useRef<HifzDeck>({});
  /**
   * The deck loads asynchronously. Grading against an empty deck because the
   * load had not landed yet would overwrite real review history with a fresh
   * card, so the summary path awaits the load instead of assuming it.
   */
  const hifzLoaded = useRef<Promise<void> | null>(null);
  /**
   * When THIS session began, and therefore which session the bookkeeping below
   * belongs to. Set in `dispatch`, because 'start' and 'resetStats' are the
   * only two events that begin a fresh set of session statistics.
   *
   * Deliberately NOT `session.startedAt`. That field is the start of the
   * current LISTENING stretch — the reducer resets it on every 'resume',
   * because it is what `elapsedMs` accumulates against. Keying this
   * bookkeeping on it meant a paused-and-resumed session looked like a brand
   * new one, which is not an exotic case: backgrounding pauses the recognizer,
   * which calls `onInterrupted`, which dispatches 'pause'. So the ordinary
   * background-then-come-back-and-finish path re-graded every ayah the session
   * had already been graded for (verified: reviews 1 -> 2, interval 1 -> 3 day
   * on a single recitation of Al-Fatiha) and wrote a second tracker row under a
   * different id, which is precisely the double-count the id scheme exists to
   * prevent.
   */
  const sessionStartedAt = useRef(0);
  /**
   * Which session's evidence has already been folded, and what it has already
   * done for it. Reset lazily, the first time a new session is folded, so no
   * start path can forget to clear it.
   *
   * This replaces a single "already graded this session" boolean. The boolean
   * was correct while grading only ever happened once, at stop(); now that a
   * session is folded repeatedly it has to remember WHICH ayahs it graded, or
   * the first flush would swallow the rest of the session.
   */
  const foldedSessionAt = useRef(0);
  /**
   * Ayah -> grade, for every ayah this session has already folded into the deck.
   *
   * Doubles as the summary's `graded` list, because after several partial folds
   * the last fold's return value is no longer the whole session.
   */
  const gradedAyahs = useRef<Map<number, number>>(new Map());
  /**
   * Words whose mistake has already been written to the confusion log this
   * session. Keyed by word rather than counted, because a mistake can be
   * retracted (`dismiss`, or a later match) and a count would then re-log the
   * entries that shuffled down into its place.
   */
  const loggedMistakes = useRef<Set<number>>(new Set());
  /**
   * The last tracker row written for a session, so a flush cannot double-count.
   * Keyed by `sessionStartedAt`, not by `session.startedAt` — see that ref.
   */
  const loggedRow = useRef<{ session: number; words: number }>({ session: 0, words: 0 });
  /**
   * Reading position not yet written to storage, or null when storage is
   * current. See FLUSH_INTERVAL_MS for why this is not written immediately.
   */
  const unsavedPosition = useRef<{ surah: number; cursor: number } | null>(null);
  /**
   * Flushes are serialised. The interval tick, a background event and stop()
   * can all land within a few milliseconds of each other.
   *
   * Not for the reason it first looks like: the deck read and its write sit in
   * the same microtask, and `gradedAyahs`, `loggedMistakes` and `loggedRow` are
   * all updated synchronously BEFORE their awaits, so the common case of two
   * identical flushes is already safe without this.
   *
   * What this actually guards is the LOST UPDATE in the storage helpers.
   * `appendMistakeLog` and `logSession` (src/data/storage.ts) both load, modify
   * and save across an await. Two flushes carrying DIFFERENT new data — the
   * interval fires, more is recited, then the app is backgrounded — can
   * interleave so the second reads storage before the first has written, and
   * the first flush's mistakes vanish. Serialising is a cheaper fix than making
   * every storage helper atomic, and it is the kind of race that would show up
   * as "some of my mistakes are missing sometimes", which nobody would ever
   * report precisely enough to find.
   */
  const flushChain = useRef<Promise<void>>(Promise.resolve());
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
  // Hidden mode follows strictly: a wrong word or a skip holds the cursor on the
  // word owed until it is said (SessionConfig.strict).
  configRef.current = { ...config, viewSurah: surahOf(pageWordRange(viewedPage)[0]), strict: mode === 'hidden' };

  const [session, rawDispatch] = useReducer(
    (state: SessionState, event: SessionEvent) => sessionReducer(state, event, configRef.current),
    initialSession(0),
  );

  const dispatch = useCallback((event: SessionEvent) => {
    // The one choke point where a new session's identity can be recorded.
    // 'start' and 'resetStats' are the only events that run `initialSession`
    // and so the only two that begin a fresh set of statistics; everything
    // else, 'resume' included, continues the session already in progress. See
    // `sessionStartedAt` for what went wrong when this was read off the state.
    if (event.type === 'start' || event.type === 'resetStats') sessionStartedAt.current = event.at;
    rawDispatch(event);
  }, []);

  // The flush paths are driven by timers and by AppState, neither of which
  // re-runs when React re-renders, so they read the live state through refs
  // rather than capturing a stale copy in a closure.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const hintsRef = useRef(hints);
  hintsRef.current = hints;

  /**
   * Fold whatever this session has proved so far into the deck and the mistake
   * log, without touching the session itself.
   *
   * THE DEFECT THIS FIXES: `applyEvidence` had exactly one call site, inside
   * buildSummary, reached only from stop(). A session that was backgrounded,
   * interrupted by a call or swiped away therefore contributed nothing at all —
   * the app watched somebody recite for ten minutes and then forgot it. This is
   * called on a timer, on backgrounding and at stop, and deliberately does NOT
   * call stop(): docs/decisions.md records that backgrounding must not tear the
   * session down (the AppState pause already fires only on 'background', and
   * only because Android reports 'inactive' for permission dialogs).
   *
   * `final` is the difference between a checkpoint and the end. Mid-session,
   * only ayahs the voice has already left are graded — `collectEvidence` emits
   * an ayah at 50% coverage, so grading one still being recited would score a
   * perfect recitation as a partial one.
   *
   * `sessionId` and `revealed` are passed in rather than read off the refs,
   * because a flush can run after the next session has already begun.
   */
  const foldSession = useCallback(async (state: SessionState, final: boolean, sessionId: number, revealed: ReadonlySet<number>): Promise<void> => {
    if (sessionId === 0) return;
    if (foldedSessionAt.current !== sessionId) {
      foldedSessionAt.current = sessionId;
      gradedAyahs.current = new Map();
      loggedMistakes.current = new Set();
    }
    if (hifzLoaded.current !== null) await hifzLoaded.current;

    const evidence = collectEvidence({
      matched: state.matched,
      missed: state.mistakes.map((m) => m.word),
      hinted: state.hinted,
      revealed,
      globalAyahOf,
      ayahWordCount: (globalAyah) => ayahStartWord[globalAyah + 1] - ayahStartWord[globalAyah],
    });
    // The earliest of the two positions, because the voice may have gone back
    // to re-recite: whichever is lower is the ayah still in flight.
    const inFlight = Math.min(globalAyahOf(state.cursor), globalAyahOf(state.livePos));
    const ready = final ? evidence : evidence.filter((e) => e.ayah < inFlight);
    const fresh = ready.filter((e) => !gradedAyahs.current.has(e.ayah));
    if (fresh.length > 0) {
      const folded = applyEvidence(hifzDeck.current, fresh, Date.now());
      hifzDeck.current = folded.deck;
      for (const g of folded.graded) gradedAyahs.current.set(g.ayah, g.grade);
      await saveHifzDeck(folded.deck);
    }

    const newMistakes = state.mistakes.filter((m) => !loggedMistakes.current.has(m.word));
    if (newMistakes.length > 0) {
      for (const m of newMistakes) loggedMistakes.current.add(m.word);
      // Expected text comes from the word array, so the confusion profile is
      // built on the same normalization the matcher used.
      const records: MistakeRecord[] = newMistakes.map((m) => ({
        word: m.word,
        expected: words[m.word] ?? '',
        heardInstead: m.heardInstead,
      }));
      await appendMistakeLog(records);
    }
  }, []);

  /**
   * Write a tracker row for this session, at most once per state of it.
   *
   * `minWords` is the whole difference between the automatic path and the
   * button: an abandoned session has to clear a floor before it counts, a
   * person tapping "Log to streak" has already decided that it does.
   */
  const logSessionRow = useCallback(async (state: SessionState, minWords: number, startedAt: number): Promise<boolean> => {
    if (startedAt === 0) return false;
    if (state.matched.size < minWords) return false;
    // Re-logging is allowed only when the session has actually advanced, so a
    // resumed session's tail reaches the streak while an idle re-stop does not.
    if (loggedRow.current.session === startedAt && state.matched.size <= loggedRow.current.words) {
      return false;
    }
    loggedRow.current = { session: startedAt, words: state.matched.size };
    await logSession(trackerEntry(state, startedAt, Date.now()));
    return true;
  }, []);

  /**
   * Everything a live session owes storage, in one serialised pass.
   *
   * `autoLog` writes the tracker row once the session clears the word floor.
   * Every path that ends or parks a session sets it, the ordinary Stop
   * included: when the row was left to the summary card's button, "Not now",
   * Back or Practise lost a finished recitation from the streak for good,
   * while walking away without pressing Stop would have counted it. The button
   * remains for a session under the floor, and to update the row.
   */
  const flush = useCallback(
    (opts: { final: boolean; autoLog: boolean; state?: SessionState }): Promise<void> => {
      // Which session this flush is FOR is settled now, when it is asked for,
      // not when its turn on the chain comes. start() flushes the outgoing
      // session and then begins a new one in the same tick; read later, the
      // state, its id and its hints would all belong to the new session, and
      // the old one's last stretch would be graded under the wrong bookkeeping
      // or not at all.
      // stop() applies the reducer itself and hands the resulting state
      // straight here, because React has not committed it yet.
      const state = opts.state ?? sessionRef.current;
      const sessionId = sessionStartedAt.current;
      const revealed = new Set<number>();
      for (const [word, level] of hintsRef.current) if (level === 2) revealed.add(word);
      // the position too: by the time this runs it may be the new session's
      const position = unsavedPosition.current;
      unsavedPosition.current = null;
      const run = async (): Promise<void> => {
        if (position !== null) await saveProgress(position.surah, position.cursor);
        await foldSession(state, opts.final, sessionId, revealed);
        if (opts.autoLog) await logSessionRow(state, AUTO_LOG_MIN_WORDS, sessionId);
      };
      const next = flushChain.current.then(run, run);
      // Keep the chain alive even if one flush throws; a failed write must not
      // wedge every later one.
      flushChain.current = next.catch(() => undefined);
      return next;
    },
    [foldSession, logSessionRow],
  );

  // --- recognizer event capture, for the replay harness (§9) ---
  const capture = useRef<ReplayFixture>({ name: 'captured', startCursor: 0, events: [] });
  const lastEventAt = useRef(0);
  const recordEvent = useCallback(
    (kind: 'partial' | 'final' | 'segment' | 'state', alternatives?: string[], state?: string) => {
      const now = Date.now();
      const dt = lastEventAt.current === 0 ? 0 : now - lastEventAt.current;
      lastEventAt.current = now;
      const events = capture.current.events;
      // bound the capture so a five-minute session cannot grow without limit
      if (events.length < 4000) events.push(state === undefined ? { kind, alternatives, dt } : { kind, state, dt });
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
    onState: useCallback(
      (state: string, strategy: string) => recordEvent('state', undefined, `${state}:${strategy}`),
      [recordEvent],
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
    // A recognizer that has given up leaves a session nobody can hear. Paused,
    // it stops counting time and stops holding the screen awake; the error
    // chip says why, and the mic button starts afresh, as after a lost mic.
    onFailed: useCallback(() => {
      dispatch({ type: 'pause', at: Date.now() });
    }, [dispatch]),
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

  // The live timer used to be here. It ticked the SHARED context twice a second
  // and re-rendered every screen in the app to move one number; it now lives
  // in StatsColumn (src/components/controls.tsx), the only thing that shows it.

  // --- persist resume position per surah (§6.7) ---
  // Recorded on every cursor change, WRITTEN on the flush timer. See
  // FLUSH_INTERVAL_MS: this effect used to call saveProgress directly, which
  // was a read-modify-write of the whole progress map per recited word.
  const persistSurah = surahOf(session.cursor);
  useEffect(() => {
    if (session.status === 'idle') return;
    unsavedPosition.current = { surah: persistSurah, cursor: session.cursor };
  }, [persistSurah, session.cursor, session.status]);

  // --- checkpoint a live session, so abandoning it cannot lose everything ---
  useEffect(() => {
    if (session.status !== 'listening') return undefined;
    const id = setInterval(() => void flush({ final: false, autoLog: false }), FLUSH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [flush, session.status]);

  // Leaving 'listening' for any reason — paused by a phone call, by the
  // silence timeout, by backgrounding — is a natural moment to write. It is a
  // flush, not a stop: the session is still there to resume. A paused session
  // also gets its tracker row now: it may never be resumed, and the row is
  // updated if it is and goes further.
  useEffect(() => {
    if (session.status === 'listening' || session.status === 'idle') return;
    void flush({ final: false, autoLog: session.status === 'paused' });
  }, [flush, session.status]);

  /**
   * Backgrounding is the abandonment case, and the one that used to lose
   * everything: the recognizer pauses itself on 'background' (deliberately, and
   * only on 'background' — see docs/decisions.md), nothing else happened, and
   * if the process was then killed from recents the whole session went with it.
   *
   * This flushes and logs WITHOUT calling stop(), exactly as that decision
   * requires: no summary card is built, no recognizer teardown, the session is
   * still sitting there paused when the reciter comes back.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'background') return;
      const status = sessionRef.current.status;
      if (status === 'idle') return;
      // Only a session that is still live is being ABANDONED. Once it has been
      // stopped, buildSummary has already folded everything and the tracker row
      // is the reciter's own choice on the summary card — writing one here
      // because they switched apps would quietly make that choice for them.
      // `final: false` on purpose. The ayah the voice is in the middle of is
      // incomplete evidence, and grading it here would both score a good
      // recitation as a partial one and stop the finished version from ever
      // being graded if the reciter comes back and completes it.
      void flush({ final: false, autoLog: status === 'listening' || status === 'paused' });
    });
    return () => sub.remove();
  }, [flush]);

  const registerPlaybackStopper = useCallback((stop: (() => void) | null) => {
    playbackStopper.current = stop;
  }, []);

  /**
   * Ask for the microphone at the moment somebody reaches for it.
   *
   * It used to be asked for exactly once, on the last card of onboarding, and
   * `setOnboarded()` ran whether or not it was granted. So anybody who tapped
   * "Don't allow" — or who later revoked it, or whose permission Android
   * auto-revoked for an unused app, which it does by default — arrived at the
   * mushaf with a microphone button that opened the recogniser, failed inside
   * the Kotlin, and reported "Could not create a SpeechRecognizer". True, and
   * useless: the one thing that would fix it is a system settings screen the
   * app never offered to open.
   *
   * The granted answer is cached in a ref so the ordinary path stays
   * immediate — a permission round trip before every session would put a tick
   * between tapping the mic and the mic opening, and §5.7 is about exactly that
   * kind of tick. The cache is dropped whenever the recogniser reports a
   * permission failure, which is what makes a revocation recoverable without
   * re-asking on every start.
   */
  const micGranted = useRef(false);
  const [micPermission, setMicPermission] = useState<MicPermission>('unknown');

  const ensureMic = useCallback(async (): Promise<boolean> => {
    if (micGranted.current) return true;
    const existing = await Audio.getPermissionsAsync();
    if (existing.granted) {
      micGranted.current = true;
      setMicPermission('granted');
      return true;
    }
    // canAskAgain false means the dialog will not appear; asking anyway would
    // resolve instantly as denied and look like the button did nothing.
    if (!existing.canAskAgain) {
      setMicPermission('blocked');
      return false;
    }
    const asked = await Audio.requestPermissionsAsync();
    micGranted.current = asked.granted;
    setMicPermission(asked.granted ? 'granted' : asked.canAskAgain ? 'denied' : 'blocked');
    return asked.granted;
  }, []);

  const openAppSettings = useCallback(() => {
    void Linking.openSettings().catch(() => undefined);
  }, []);

  /**
   * Coming back from the settings page the 'blocked' chip sent them to.
   *
   * Android does not restart an app when a permission is GRANTED (only when
   * one is revoked), and nothing else re-read it, so the chip still said
   * blocked and tapping it opened settings again, in a loop, beside a session
   * listening in silence. Only 'blocked' is re-checked here: the 'denied' chip
   * asks again through start(), and doing it here too would race that path
   * into starting the recognizer twice.
   */
  const micPermissionRef = useRef(micPermission);
  micPermissionRef.current = micPermission;
  const recognizerRef = useRef(recognizer);
  recognizerRef.current = recognizer;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active' || micPermissionRef.current !== 'blocked') return;
      void Audio.getPermissionsAsync().then((p) => {
        if (!p.granted || micGranted.current) return;
        micGranted.current = true;
        setMicPermission('granted');
        // the session that started without a microphone gets one now
        if (sessionRef.current.status === 'listening') recognizerRef.current.start();
      });
    });
    return () => sub.remove();
  }, []);

  const start = useCallback(
    (fromWord?: number) => {
      // Reciting and listening at once would feed the reciter's own audio back
      // into the recognizer (§4).
      playbackStopper.current?.();
      /**
       * A session still running, or paused, is being REPLACED: long-press a
       * word mid-recitation to restart there, or tap the mic on a paused one.
       * It used to simply vanish — no tracker row, the ayahs since the last
       * checkpoint and the one in progress never graded, the mistakes since
       * then never logged — because 'start' wipes the statistics and the
       * status never leaves 'listening', so no flush is triggered. It is
       * finished here exactly as backgrounding finishes one, except that it is
       * final: this session will not be resumed. flush() captures the session,
       * its id and its hints now, before the dispatch below replaces them.
       */
      const outgoing = sessionRef.current;
      if (outgoing.status === 'listening' || outgoing.status === 'paused') {
        void flush({ final: true, autoLog: true, state: outgoing });
      }
      const cursor = fromWord ?? sessionRef.current.cursor;
      capture.current = { name: `session-${new Date().toISOString()}`, startCursor: cursor, events: [] };
      lastEventAt.current = 0;
      setSummary(null);
      setInterruption(null);
      setSilenceTimedOut(false);
      setHints(new Map());
      dispatch({ type: 'start', at: Date.now(), cursor });
      /**
       * The session starts either way, and only the microphone waits on the
       * permission. That ordering is deliberate: the cursor, the page and the
       * hint state are what the screen renders, and making them wait on an
       * async answer would make tapping the mic feel like nothing happened.
       * If permission is refused the session is simply a silent one, and the
       * chip on the mushaf explains why.
       */
      if (micGranted.current) {
        recognizer.start();
        return;
      }
      void ensureMic().then((ok) => {
        if (ok) recognizer.start();
      });
    },
    [dispatch, ensureMic, flush, recognizer],
  );

  const buildSummary = useCallback(
    async (state: SessionState): Promise<SessionSummary> => {
      // The last fold of this session: everything still ungraded, in-flight
      // ayah included, plus whatever position and mistakes are outstanding.
      // Grading itself is deduped per ayah inside foldSession, so a session
      // already checkpointed three times cannot be pushed three steps further
      // up the interval ladder by stopping it.
      await flush({ final: true, autoLog: true, state });
      const surah = surahOf(state.cursor);
      const [surahStart] = surahWordRange(surah);
      const previous = await bestPreviousFor(surah);
      const versesCovered = new Set<number>();
      for (const w of state.matched) versesCovered.add(globalAyahOf(w));
      const attempted = state.matched.size + state.mistakes.length;

      const now = Date.now();
      // The whole session's grades, not the last fold's: a long session is
      // folded several times, so the final call's return value would report
      // only the tail of it.
      const graded = [...gradedAyahs.current]
        .map(([ayah, grade]) => ({ ayah, grade }))
        .sort((a, b) => a.ayah - b.ayah);

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
        graded,
        dueNow: dueQueue(hifzDeck.current, now, 500).length,
        autoLogged: sessionStartedAt.current !== 0 && loggedRow.current.session === sessionStartedAt.current,
      };
    },
    [flush],
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
    // Same rule as start(): the reciter's own audio must not feed the recognizer.
    playbackStopper.current?.();
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

  /** Undo "I said it right": the word can be flagged again, and the mistake is back. */
  const undismissMistake = useCallback(
    (mistake: Mistake) => {
      dispatch({ type: 'undismiss', word: mistake.word, mistake });
      void removeDismissed(mistake.word);
    },
    [dispatch],
  );

  /** Settings' reset: every word marked "I said it right" can be flagged again. */
  const clearDismissedWords = useCallback(() => {
    dispatch({ type: 'clearDismissed' });
    void clearDismissed();
  }, [dispatch]);

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

  /**
   * "Log to streak" on the summary card.
   *
   * No word floor — the reciter has said this counted — but it shares the
   * one-row-per-session guard with the automatic path, so a session that was
   * already logged when it was backgrounded is superseded rather than counted
   * twice. The tracker keeps the last row for each id.
   */
  const logSummaryToTracker = useCallback(async () => {
    if (summary === null) return;
    await logSessionRow(sessionRef.current, 0, sessionStartedAt.current);
  }, [logSessionRow, summary]);

  /**
   * The second door into the revision deck: "I read this" / "I revised this".
   *
   * Everything about which ayahs a word range honestly covers, what a
   * self-report is worth and how often it may be repeated lives in
   * src/engine/hifz.ts, where it is pure and tested. This is the wiring.
   *
   * Queued on the same chain as the session flushes, because both are a
   * read-modify-write of `hifzDeck.current`: the tracker's button is reachable
   * while a session sits paused in another tab, and a flush already in flight
   * would write back the deck it read before these cards existed.
   */
  const commitSelfReport = useCallback(
    (kind: SelfReportKind, fromWord: number, toWord: number): Promise<number> => {
      const run = async (): Promise<number> => {
        if (hifzLoaded.current !== null) await hifzLoaded.current;
        const ayahs = ayahsInWordRange({
          fromWord,
          toWord,
          globalAyahOf,
          ayahWordRange: ayahWordRangeOf,
        });
        const { deck, graded } = applySelfReport(hifzDeck.current, ayahs, kind, Date.now());
        // Nothing moved means every ayah was inside its cooldown; do not write.
        // One tap is one review, and a no-op write is still a write.
        if (graded.length === 0) return 0;
        hifzDeck.current = deck;
        await saveHifzDeck(deck);
        return graded.length;
      };
      const next = flushChain.current.then(run, run);
      // Same as in `flush`: a rejection must not wedge everything behind it.
      flushChain.current = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    [],
  );

  // Only while there is a voice to return to: after a session ends, every
  // manual page swipe used to offer to "return" to a place nobody is reciting.
  const awayFromPlace =
    (session.status === 'listening' || session.status === 'paused') && viewedPage !== pageOf(session.livePos);

  /**
   * The reset icon next to the timer. The work before the tap is folded and
   * logged first, so a stray tap mid-recitation cannot erase it from the
   * streak and the revision deck.
   */
  const resetStats = useCallback(() => {
    const before = sessionRef.current;
    void flush({ final: true, autoLog: true, state: before });
    dispatch({ type: 'resetStats', at: Date.now() });
  }, [dispatch, flush]);

  /**
   * A permission failure from the recogniser drops the cached "granted".
   *
   * Android revokes the microphone while the app is still installed in two
   * ordinary ways: the user does it in settings, and the system does it by
   * itself for apps that have not been opened in a while — which is the
   * DEFAULT for anything targeting a recent API. Without this the ref would
   * read granted forever and every later tap would fail the same silent way.
   * Clearing it means the next tap asks properly instead.
   *
   * The codes are the ones the Kotlin actually emits, read from
   * RecitationRecognizer.kt rather than guessed: INSUFFICIENT_PERMISSIONS is
   * the mapped SpeechRecognizer constant, and create-failed is what it reports
   * when the recogniser cannot even be constructed, which is what a revoked
   * microphone looks like from there. Both arrive in `name`; `code` is an int.
   */
  useEffect(() => {
    // `name`, not `code`: the Kotlin puts the string in name and an int in
    // code (-1 for its own failures, the SpeechRecognizer constant otherwise).
    const name = recognizer.lastError?.name;
    if (name !== 'INSUFFICIENT_PERMISSIONS' && name !== 'create-failed') return;
    micGranted.current = false;
    void Audio.getPermissionsAsync().then((p) => {
      setMicPermission(p.granted ? 'granted' : p.canAskAgain ? 'denied' : 'blocked');
    });
  }, [recognizer.lastError]);

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
      resetStats,
      seekTo,
      dismissMistake,
      undismissMistake,
      clearDismissedWords,
      summary,
      dismissSummary: () => setSummary(null),
      logSummaryToTracker,
      interruption,
      clearInterruption: () => setInterruption(null),
      silenceTimedOut,
      captureFixture: () => capture.current,
      practiseRange,
      commitSelfReport,
      micPermission,
      openAppSettings,
      registerPlaybackStopper,
    }),
    [
      session,
      recognizer,
      mode,
      setMode,
      viewedPage,
      awayFromPlace,
      hintLevelOf,
      requestHint,
      range,
      start,
      stop,
      pauseSession,
      resumeSession,
      resetStats,
      seekTo,
      dismissMistake,
      undismissMistake,
      clearDismissedWords,
      summary,
      logSummaryToTracker,
      interruption,
      silenceTimedOut,
      practiseRange,
      commitSelfReport,
      micPermission,
      openAppSettings,
      registerPlaybackStopper,
    ],
  );

  const debug = useMemo<RecitationDebugValue>(() => ({ partialGapMs }), [partialGapMs]);

  return (
    <RecitationContext.Provider value={value}>
      <RecitationDebugContext.Provider value={debug}>{children}</RecitationDebugContext.Provider>
    </RecitationContext.Provider>
  );
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
