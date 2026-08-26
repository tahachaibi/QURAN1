/**
 * The recitation session: one pure reducer over recognizer events.
 *
 * Everything stateful about following a reciter lives here, deliberately free
 * of React and of the clock — every event carries its own `now`, so the replay
 * harness (§9) can drive a whole recorded session deterministically.
 *
 * The state this reducer owns is the state §2 says must NOT belong to a screen:
 * one global cursor into the whole Quran. `RecitationProvider` mounts it above
 * the router so unmounting a surah screen cannot stop a session.
 */
import { align, LOCK_ON_PROGRESS, lookAheadFor, type AlignResult } from './align';
import { localize, type LocalizeResult } from './localize';
import {
  mergeMistakes,
  promotePending,
  retractMatched,
  MIN_ALTERNATIVE_VOTES,
  type Mistake,
  type PendingSkip,
} from './mistakes';
import { normalizeHeard } from './normalize';

export type SessionStatus = 'idle' | 'listening' | 'paused' | 'stopped';

export interface SessionConfig {
  /** the global word array (spec §2) */
  words: readonly string[];
  /** word index -> surah, for localization tie-breaks */
  surahOf: (index: number) => number;
  /** every word form in the Quran, to disambiguate detached-article fusing */
  vocabulary: ReadonlySet<string>;
  /** inclusive lower bound (ayah-range practice) */
  floor: number;
  /** exclusive upper bound */
  limit: number;
  /** surah currently on screen, for localization tie-breaks */
  viewSurah?: number;
}

export interface DebugInfo {
  alternatives: readonly string[];
  lookAhead: number;
  localScore: number;
  globalScore: number;
  jumpReason: string;
  anchor: number;
  progress: number;
  /** ms between the recognizer emitting and this reducer applying it */
  latencyMs: number;
}

export interface SessionState {
  status: SessionStatus;
  /** furthest progress; never decreases while listening */
  cursor: number;
  /** where the voice is right now; may move backwards */
  livePos: number;
  /** true once >= 3 words of forward progress have been seen */
  lockedOn: boolean;
  /** cursor the current utterance aligns from; align() is re-run from here */
  utteranceStart: number;
  /** normalized words of the current utterance so far */
  utteranceHeard: readonly string[];
  /** every normalized word heard this session (the grace pass corpus) */
  sessionHeard: readonly string[];
  matched: ReadonlySet<number>;
  hinted: ReadonlySet<number>;
  /** words the user permanently dismissed with "I said it right" */
  dismissed: ReadonlySet<number>;
  pending: readonly PendingSkip[];
  mistakes: readonly Mistake[];
  jumpCandidate: { target: number; credited: number; count: number } | null;
  lastJumpAt: number;
  lastResultAt: number;
  /**
   * Signature of the last partial actually processed (§5.7).
   *
   * Android re-emits its whole transcript on every partial, and on a real device
   * 57% of them are byte-identical to the one before — measured on the captured
   * Al-Fatiha session. Each repeat used to re-align five growing alternatives and
   * rebuild the page for a result that could not differ. Remembering the last one
   * turns over half the work of following a reciter into a string comparison.
   */
  lastPartialSig: string;
  lastHeard: string;
  startedAt: number;
  /** accumulated listening time, ms, excluding pauses */
  elapsedMs: number;
  currentCleanRun: number;
  longestCleanRun: number;
  debug: DebugInfo;
}

export type SessionEvent =
  | { type: 'start'; at: number; cursor?: number }
  | { type: 'partial'; alternatives: readonly string[]; at: number; emittedAt?: number }
  | { type: 'final'; alternatives: readonly string[]; at: number; emittedAt?: number }
  | { type: 'endOfSegment'; at: number }
  | { type: 'seek'; to: number; at: number }
  | { type: 'hint'; word: number }
  | { type: 'dismiss'; word: number }
  | { type: 'restoreDismissed'; words: readonly number[] }
  | { type: 'pause'; at: number }
  | { type: 'resume'; at: number }
  | { type: 'stop'; at: number }
  | { type: 'resetStats'; at: number }
  | { type: 'tick'; at: number };

/** Two consecutive partials must agree before the cursor jumps (spec §5.5). */
export const JUMP_CONFIRMATIONS = 2;
/** Proposals within this many words count as the same jump target. */
export const JUMP_TARGET_TOLERANCE = 3;
/** After a jump, ignore localization for this long (spec §5.5). */
export const JUMP_COOLDOWN_MS = 1000;
/** How many words of session transcript to keep for the grace pass. */
const SESSION_HEARD_CAP = 600;

const EMPTY_SET: ReadonlySet<number> = new Set<number>();

const EMPTY_DEBUG: DebugInfo = {
  alternatives: [],
  lookAhead: 0,
  localScore: 0,
  globalScore: 0,
  jumpReason: '',
  anchor: 0,
  progress: 0,
  latencyMs: 0,
};

export function initialSession(cursor: number): SessionState {
  return {
    status: 'idle',
    cursor,
    livePos: cursor,
    lockedOn: false,
    utteranceStart: cursor,
    utteranceHeard: [],
    sessionHeard: [],
    matched: EMPTY_SET,
    hinted: EMPTY_SET,
    dismissed: EMPTY_SET,
    pending: [],
    mistakes: [],
    jumpCandidate: null,
    lastJumpAt: 0,
    lastResultAt: 0,
    lastPartialSig: '',
    lastHeard: '',
    startedAt: 0,
    elapsedMs: 0,
    currentCleanRun: 0,
    longestCleanRun: 0,
    debug: EMPTY_DEBUG,
  };
}

/**
 * Add indices to a set WITHOUT allocating when nothing changes (spec §5.7).
 * Returning the previous object lets memoized page components skip rendering.
 */
function withAdded(set: ReadonlySet<number>, items: readonly number[]): ReadonlySet<number> {
  if (items.length === 0) return set;
  let needed = false;
  for (const i of items) {
    if (!set.has(i)) {
      needed = true;
      break;
    }
  }
  if (!needed) return set;
  const next = new Set(set);
  for (const i of items) next.add(i);
  return next;
}

function withAddedOne(set: ReadonlySet<number>, item: number): ReadonlySet<number> {
  if (set.has(item)) return set;
  const next = new Set(set);
  next.add(item);
  return next;
}

interface Scored {
  heard: string[];
  result: AlignResult;
}

/** Align every alternative and rank them. Lower-ranked ASR alternatives are
 *  frequently the correct one for Quranic Arabic (spec §4), so all are used. */
function scoreAlternatives(
  state: SessionState,
  config: SessionConfig,
  alternatives: readonly string[],
  lookAhead: number,
): Scored[] {
  const out: Scored[] = [];
  for (const alt of alternatives.slice(0, 5)) {
    const heard = normalizeHeard(alt, config.vocabulary);
    if (heard.length === 0) continue;
    out.push({
      heard,
      result: align({
        words: config.words,
        startCursor: state.utteranceStart,
        heard,
        lookAhead,
        floor: config.floor,
        limit: config.limit,
      }),
    });
  }
  out.sort((a, b) => b.result.score - a.result.score || b.result.progress - a.result.progress);
  return out;
}

/**
 * Gate 2 of §5.6: count how many alternatives agree a word was skipped, and
 * make sure no alternative matched it.
 */
function skipVotes(scored: readonly Scored[], candidates: readonly number[]): Map<number, number> {
  const votes = new Map<number, number>();
  const matchedByAny = new Set<number>();
  for (const s of scored) for (const m of s.result.matches) matchedByAny.add(m.word);
  for (const w of candidates) {
    if (matchedByAny.has(w)) continue;
    let n = 0;
    for (const s of scored) if (s.result.skipped.includes(w)) n++;
    votes.set(w, n);
  }
  return votes;
}

function applyResult(
  state: SessionState,
  config: SessionConfig,
  scored: readonly Scored[],
  lookAhead: number,
  at: number,
  emittedAt: number | undefined,
  isFinal: boolean,
): SessionState {
  const best = scored[0];
  const r = best.result;

  const matchedWords = r.matches.map((m) => m.word);
  const matched = withAdded(state.matched, matchedWords);
  const cursor = Math.max(state.cursor, r.cursor);
  const livePos = r.empty ? state.livePos : r.livePos;
  const lockedOn = state.lockedOn || r.progress >= LOCK_ON_PROGRESS;

  // --- automatic mistake retraction (§5.6) ---
  let mistakes = retractMatched(state.mistakes, matchedWords);

  // --- pending skips are created on FINAL results only (§5.6 gate 1) ---
  let pending = state.pending;
  if (isFinal && r.skipped.length > 0) {
    const votes = skipVotes(scored, r.skipped);
    const additions: PendingSkip[] = [];
    const known = new Set(pending.map((p) => p.word));
    for (const [word, n] of votes) {
      if (n < MIN_ALTERNATIVE_VOTES) continue;
      if (known.has(word)) continue;
      if (state.dismissed.has(word)) continue;
      if (matched.has(word)) continue;
      additions.push({
        word,
        votes: n,
        ofAlternatives: scored.length,
        observedAtCursor: cursor,
        heardInstead: nearestHeard(best, word),
      });
    }
    if (additions.length > 0) pending = [...pending, ...additions];
  }

  // --- promotion gates (§5.6) ---
  const promotion = promotePending(pending, {
    cursor,
    sessionHeard: isFinal ? [...state.sessionHeard, ...best.heard] : state.sessionHeard,
    wordText: (i) => config.words[i],
    matched,
    dismissed: state.dismissed,
    now: at,
  });
  pending = promotion.pending.length === pending.length && promotion.promoted.length === 0 && promotion.discarded.length === 0
    ? pending
    : promotion.pending;
  mistakes = mergeMistakes(mistakes, promotion.promoted);

  // --- clean-run bookkeeping for the session summary (§6.6) ---
  let currentCleanRun = state.currentCleanRun;
  let longestCleanRun = state.longestCleanRun;
  if (promotion.promoted.length > 0) {
    currentCleanRun = 0;
  } else {
    currentCleanRun += matched.size - state.matched.size;
    if (currentCleanRun > longestCleanRun) longestCleanRun = currentCleanRun;
  }

  const sessionHeard = isFinal
    ? capTail([...state.sessionHeard, ...best.heard], SESSION_HEARD_CAP)
    : state.sessionHeard;

  const debug: DebugInfo = {
    alternatives: scored.map((s) => s.heard.join(' ')),
    lookAhead,
    localScore: r.score,
    globalScore: state.debug.globalScore,
    jumpReason: state.debug.jumpReason,
    anchor: r.anchor,
    progress: r.progress,
    latencyMs: emittedAt === undefined ? 0 : Math.max(0, at - emittedAt),
  };

  return {
    ...state,
    cursor,
    livePos,
    lockedOn,
    matched,
    mistakes,
    pending,
    currentCleanRun,
    longestCleanRun,
    sessionHeard,
    utteranceHeard: best.heard,
    utteranceStart: isFinal ? cursor : state.utteranceStart,
    lastResultAt: at,
    lastHeard: best.heard.join(' '),
    debug,
  };
}

/** Best guess at what was said in place of a skipped word, for the review sheet. */
function nearestHeard(best: Scored, word: number): string {
  let closest = '';
  let bestDelta = Infinity;
  for (const m of best.result.matches) {
    const delta = Math.abs(m.word - word);
    if (delta < bestDelta) {
      bestDelta = delta;
      closest = best.heard[m.heard] ?? '';
    }
  }
  for (const h of best.result.unmatchedHeard) {
    // an unmatched heard word near the skip is the likeliest substitute
    const token = best.heard[h];
    if (token) return token;
  }
  return closest;
}

function capTail<T>(arr: T[], cap: number): T[] {
  return arr.length <= cap ? arr : arr.slice(arr.length - cap);
}

function maybeJump(
  state: SessionState,
  config: SessionConfig,
  at: number,
): SessionState {
  if (state.utteranceHeard.length === 0) return state;
  if (at - state.lastJumpAt < JUMP_COOLDOWN_MS) return state;

  const result: LocalizeResult = localize({
    words: config.words,
    cursor: state.cursor,
    livePos: state.livePos,
    heard: state.utteranceHeard,
    localScore: state.debug.localScore,
    viewSurah: config.viewSurah,
    surahOf: config.surahOf,
  });

  const debug: DebugInfo = {
    ...state.debug,
    globalScore: result.globalScore,
    jumpReason: result.reason,
  };

  if (result.target === null) {
    return { ...state, debug, jumpCandidate: null };
  }

  const prev = state.jumpCandidate;
  const same = prev !== null && Math.abs(prev.target - result.target) <= JUMP_TARGET_TOLERANCE;
  const count = same ? prev.count + 1 : 1;

  if (count < JUMP_CONFIRMATIONS) {
    return {
      ...state,
      debug,
      jumpCandidate: { target: result.target, credited: result.creditedCursor, count },
    };
  }

  // Jump. The cursor lands where the transcript ALREADY got to, not at the
  // verse's first word, and the utterance is cleared so the transcript that
  // caused the jump cannot cause another (spec §5.5).
  return {
    ...state,
    cursor: result.creditedCursor,
    livePos: result.creditedCursor,
    lockedOn: false,
    utteranceStart: result.creditedCursor,
    utteranceHeard: [],
    pending: [],
    jumpCandidate: null,
    lastJumpAt: at,
    debug: { ...debug, jumpReason: `JUMPED: ${result.reason}` },
  };
}

export function sessionReducer(
  state: SessionState,
  event: SessionEvent,
  config: SessionConfig,
): SessionState {
  switch (event.type) {
    case 'start': {
      const cursor = event.cursor ?? state.cursor;
      return {
        ...initialSession(cursor),
        dismissed: state.dismissed,
        hinted: state.hinted,
        status: 'listening',
        startedAt: event.at,
        lastResultAt: event.at,
      };
    }

    case 'partial':
    case 'final': {
      if (state.status !== 'listening') return state;

      /**
       * A repeat of the partial we just processed cannot change anything: same
       * transcript, same starting cursor, same expected words. So it is dropped
       * before any work happens.
       *
       * lastResultAt still moves. It is what the liveness watchdog reads, and a
       * session that stopped updating it looks stalled and gets restarted — the
       * repeat is not new information, but it IS proof the recognizer is alive.
       *
       * A final is never skipped: it commits the utterance even when its text is
       * identical to the partial before it.
       */
      const sig = `${state.utteranceStart}\u0000${event.alternatives.join('\u0001')}`;
      if (event.type === 'partial' && sig === state.lastPartialSig) {
        return state.lastResultAt === event.at ? state : { ...state, lastResultAt: event.at };
      }

      const lookAhead = lookAheadFor(state.lockedOn);
      const scored = scoreAlternatives(state, config, event.alternatives, lookAhead);
      if (scored.length === 0) return state;
      const applied = applyResult(
        state,
        config,
        scored,
        lookAhead,
        event.at,
        event.emittedAt,
        event.type === 'final',
      );
      const jumped = maybeJump(applied, config, event.at);
      /**
       * The stored signature describes the computation that would happen NOW, so
       * it is built from the RESULTING utteranceStart — a jump can move it, and
       * the same transcript aligned from a different cursor is a different
       * question. Skipping on a stale signature would be the one way this
       * optimisation could change an answer.
       */
      const nextSig = `${jumped.utteranceStart}\u0000${event.alternatives.join('\u0001')}`;
      return jumped.lastPartialSig === nextSig ? jumped : { ...jumped, lastPartialSig: nextSig };
    }

    case 'endOfSegment': {
      if (state.status !== 'listening') return state;
      if (state.utteranceHeard.length === 0 && state.utteranceStart === state.cursor) return state;
      return { ...state, utteranceStart: state.cursor, utteranceHeard: [] };
    }

    case 'seek': {
      const to = Math.min(Math.max(event.to, config.floor), config.limit - 1);
      if (to === state.cursor && to === state.livePos) return state;
      return {
        ...state,
        cursor: to,
        livePos: to,
        lockedOn: false,
        utteranceStart: to,
        utteranceHeard: [],
        pending: [],
        jumpCandidate: null,
        lastJumpAt: event.at,
      };
    }

    case 'hint': {
      const hinted = withAddedOne(state.hinted, event.word);
      return hinted === state.hinted ? state : { ...state, hinted };
    }

    case 'dismiss': {
      const dismissed = withAddedOne(state.dismissed, event.word);
      const mistakes = state.mistakes.filter((m) => m.word !== event.word);
      const pending = state.pending.filter((p) => p.word !== event.word);
      if (
        dismissed === state.dismissed &&
        mistakes.length === state.mistakes.length &&
        pending.length === state.pending.length
      ) {
        return state;
      }
      return {
        ...state,
        dismissed,
        mistakes: mistakes.length === state.mistakes.length ? state.mistakes : mistakes,
        pending: pending.length === state.pending.length ? state.pending : pending,
      };
    }

    case 'restoreDismissed': {
      const dismissed = withAdded(state.dismissed, event.words);
      return dismissed === state.dismissed ? state : { ...state, dismissed };
    }

    case 'pause': {
      if (state.status !== 'listening') return state;
      return {
        ...state,
        status: 'paused',
        elapsedMs: state.elapsedMs + Math.max(0, event.at - state.startedAt),
        utteranceHeard: [],
        utteranceStart: state.cursor,
      };
    }

    case 'resume': {
      if (state.status !== 'paused') return state;
      return { ...state, status: 'listening', startedAt: event.at, lastResultAt: event.at };
    }

    case 'stop': {
      if (state.status === 'stopped' || state.status === 'idle') return state;
      const elapsedMs =
        state.status === 'listening'
          ? state.elapsedMs + Math.max(0, event.at - state.startedAt)
          : state.elapsedMs;
      return { ...state, status: 'stopped', elapsedMs, utteranceHeard: [] };
    }

    case 'resetStats': {
      return {
        ...initialSession(state.cursor),
        status: state.status,
        dismissed: state.dismissed,
        startedAt: event.at,
        lastResultAt: event.at,
      };
    }

    case 'tick':
      return state;

    default:
      return state;
  }
}

/** Live elapsed listening time, ms. */
export const elapsedOf = (state: SessionState, now: number): number =>
  state.status === 'listening' ? state.elapsedMs + Math.max(0, now - state.startedAt) : state.elapsedMs;
