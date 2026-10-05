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
  MIN_WORDS_PAST,
  isHifzSlip,
  type Mistake,
  type PendingSkip,
} from './mistakes';
import { compareWords, weightedDistance } from './distance';
import { leadingIstiadhaLength, normalizeHeardSpans, trailingClosingLength } from './normalize';

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
  /**
   * `lockedOn` as it was when the current utterance began. Every partial of an
   * utterance re-aligns all of it, so the look-ahead it uses must not change
   * half-way through (see AlignOptions.lockAfter).
   */
  utteranceLockedOn: boolean;
  /**
   * True from start, seek or jump until the first final that matched anything.
   * Words between the starting cursor and the reciter's first word were never
   * skipped: the reciter simply began further on, which is the natural thing to
   * do when the saved place is the last word of an ayah.
   */
  utteranceFresh: boolean;
  /**
   * The unmatched words that ENDED the last final, after its last match, and the
   * word the cursor was waiting on. A wrong ayah ending said before a pause
   * (للمؤمنين for للمتقين) is only found to be a skip in the NEXT utterance,
   * which no longer contains it; this is where "you said" finds it.
   */
  lastTail: { from: number; tokens: readonly string[]; spelled: readonly string[] } | null;
  /** normalized words of the current utterance so far */
  utteranceHeard: readonly string[];
  /** every normalized word heard this session (the grace pass corpus) */
  sessionHeard: readonly string[];
  /**
   * The same words as the recognizer SPELLED them, for the transcript on
   * screen. sessionHeard is folded for matching (على -> علي, الصلاة -> الصلاه,
   * إسرائيل -> اسراييل) and reads as misspelt Arabic.
   */
  sessionHeardRaw: readonly string[];
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
  /** the last result's words as the recognizer spelled them, for display */
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
  /** take back a dismissal; `mistake` is put back on the list when given */
  | { type: 'undismiss'; word: number; mistake?: Mistake }
  /** forget every dismissal, from Settings */
  | { type: 'clearDismissed' }
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
    utteranceLockedOn: false,
    utteranceFresh: true,
    lastTail: null,
    utteranceHeard: [],
    sessionHeard: [],
    sessionHeardRaw: [],
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
  /** normalized tokens: what is matched, explained and logged */
  heard: string[];
  /** raw[i] is how the recognizer spelled heard[i]: what is shown */
  raw: string[];
  result: AlignResult;
}

/** Align every alternative and rank them. Lower-ranked ASR alternatives are
 *  frequently the correct one for Quranic Arabic (spec §4), so all are used. */
function scoreAlternatives(
  state: SessionState,
  config: SessionConfig,
  alternatives: readonly string[],
  isFinal: boolean,
): Scored[] {
  const out: Scored[] = [];
  for (const alt of alternatives.slice(0, 5)) {
    const spans = normalizeHeardSpans(alt, config.vocabulary);
    // The isti'adha and the closing صدق الله العظيم are said around the
    // recitation, not in it (see normalize.ts). Only an utterance's own first
    // and last words can be them, and every partial is the whole utterance.
    const from = leadingIstiadhaLength(spans.tokens);
    const to = spans.tokens.length - trailingClosingLength(spans.tokens, !isFinal);
    if (to <= from) continue;
    const heard = spans.tokens.slice(from, to);
    out.push({
      heard,
      raw: spans.raw.slice(from, to),
      result: align({
        words: config.words,
        startCursor: state.utteranceStart,
        heard,
        lookAhead: lookAheadFor(state.utteranceLockedOn),
        lockAfter: state.utteranceLockedOn ? Infinity : LOCK_ON_PROGRESS,
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
    /**
     * align() counts the words between the starting cursor and the first match
     * as skipped. Right after start, seek or a jump that is wrong: the saved
     * place is often the last word of an ayah the recognizer cut short, and a
     * reciter who begins at the next ayah — the natural thing to do — was shown
     * a red "Skipped" for a word they never meant to say. So the first final
     * that matches anything only counts skips after its first match.
     */
    const candidates =
      state.utteranceFresh && r.matches.length > 0
        ? r.skipped.filter((w) => w > r.matches[0].word)
        : r.skipped;
    const votes = skipVotes(scored, candidates);
    const additions: PendingSkip[] = [];
    const known = new Set(pending.map((p) => p.word));
    for (const [word, n] of votes) {
      if (n < MIN_ALTERNATIVE_VOTES) continue;
      if (known.has(word)) continue;
      if (state.dismissed.has(word)) continue;
      if (matched.has(word)) continue;
      const said = saidInPlaceOf(best.heard, best.raw, r, word, (i) => config.words[i] ?? '', state.lastTail);
      additions.push({
        word,
        votes: n,
        ofAlternatives: scored.length,
        observedAtCursor: cursor,
        // normalized: explainMistake, the letter hints and the confusion log
        // compare it with the normalized expected word
        heardInstead: said.heard,
        // as spelled: what the review sheet shows under "You said"
        heardRaw: said.spelled,
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
    // At the end of a practice range there is no further word to move on to,
    // so "three words past" can never happen; the range being finished is the
    // reciter being clear of every word in it.
    minWordsPast: cursor >= config.limit ? 0 : MIN_WORDS_PAST,
  });
  pending = promotion.pending.length === pending.length && promotion.promoted.length === 0 && promotion.discarded.length === 0
    ? pending
    : promotion.pending;
  mistakes = mergeMistakes(mistakes, promotion.promoted);

  // --- hifz slips the matcher accepted (see isHifzSlip) ---
  const slips = isFinal ? hifzSlips(state, config, scored) : [];
  mistakes = mergeMistakes(mistakes, slips.map((s) => ({ ...s, at })));

  // --- clean-run bookkeeping for the session summary (§6.6) ---
  let currentCleanRun = state.currentCleanRun;
  let longestCleanRun = state.longestCleanRun;
  if (promotion.promoted.length > 0 || slips.length > 0) {
    currentCleanRun = 0;
  } else {
    currentCleanRun += matched.size - state.matched.size;
    if (currentCleanRun > longestCleanRun) longestCleanRun = currentCleanRun;
  }

  const sessionHeard = isFinal
    ? capTail([...state.sessionHeard, ...best.heard], SESSION_HEARD_CAP)
    : state.sessionHeard;
  const sessionHeardRaw = isFinal
    ? capTail([...state.sessionHeardRaw, ...best.raw], SESSION_HEARD_CAP)
    : state.sessionHeardRaw;

  // What ended this final after its last match, kept for the next one (see
  // SessionState.lastTail). Built AFTER this final's own skips used the old one.
  let lastTail = state.lastTail;
  if (isFinal) {
    const lastMatched = r.matches.length > 0 ? r.matches[r.matches.length - 1].heard : -1;
    const tail = r.unmatchedHeard.filter((h) => h > lastMatched).sort((a, b) => a - b);
    lastTail =
      tail.length === 0
        ? null
        : { from: cursor, tokens: tail.map((h) => best.heard[h]), spelled: tail.map((h) => best.raw[h]) };
  }

  const debug: DebugInfo = {
    alternatives: scored.map((s) => s.heard.join(' ')),
    lookAhead: lookAheadFor(state.utteranceLockedOn),
    localScore: r.score,
    globalScore: state.debug.globalScore,
    // Only the event that jumps says JUMPED. Carrying the label over let it sit
    // on every frame of the cooldown that followed, where a backward move that
    // was NOT a jump would have passed for one.
    jumpReason: '',
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
    sessionHeardRaw,
    lastTail,
    utteranceHeard: best.heard,
    utteranceStart: isFinal ? cursor : state.utteranceStart,
    utteranceLockedOn: isFinal ? lockedOn : state.utteranceLockedOn,
    utteranceFresh: state.utteranceFresh && !(isFinal && r.matches.length > 0),
    lastResultAt: at,
    lastHeard: best.raw.join(' '),
    debug,
  };
}

/**
 * Words the best alternative MATCHED with a hifz slip (isHifzSlip): يعملون for
 * تعملون. The match stands, because the reciter is plainly at that word and
 * the cursor must follow them; the word is flagged as said wrong as well.
 *
 * Only when no alternative heard the word as written: lower-ranked
 * alternatives are often the right one (spec §4), and one that says تعملون is
 * the phone's own doubt about the prefix.
 */
function hifzSlips(
  state: SessionState,
  config: SessionConfig,
  scored: readonly Scored[],
): { word: number; heardInstead: string; heardRaw: string }[] {
  const best = scored[0];
  const out: { word: number; heardInstead: string; heardRaw: string }[] = [];
  for (const m of best.result.matches) {
    if (m.distance === 0 || state.dismissed.has(m.word)) continue;
    const expected = config.words[m.word] ?? '';
    const heard = best.heard[m.heard];
    if (!isHifzSlip(expected, heard, config.vocabulary)) continue;
    const exactly = scored.some((s) => s.result.matches.some((x) => x.word === m.word && x.distance === 0));
    if (exactly) continue;
    out.push({ word: m.word, heardInstead: heard, heardRaw: best.raw[m.heard] || heard });
  }
  return out;
}

/** What was said in a word's place: normalized for comparing, spelled for showing. */
interface Said {
  heard: string;
  spelled: string;
}

const NOTHING_SAID: Said = { heard: '', spelled: '' };

/**
 * What the reciter said where `word` should have been, or '' if they said
 * nothing there. The review sheet reads it as "you said X": '' means the word
 * was skipped, anything else was said in its place.
 *
 * Only the heard tokens BETWEEN the matches either side of the word count. The
 * old version returned the first unmatched token anywhere in the utterance,
 * which is how a skipped اهبطوا came to be shown as "heard: يا". The يا was from
 * "يا آدم", two ayahs earlier. A reciter shown a word they never said in that
 * place cannot tell what they did wrong.
 *
 * A reciter who stumbles usually goes back a word and tries again ("قالوا وانوا
 * من قالوا هلؤمن"). So if the word before the gap is said again inside it, only
 * what follows the LAST repeat counts: that is the attempt they settled on.
 *
 * When nothing in this utterance comes before the word, the gap opens in the
 * PREVIOUS one: a wrong ayah ending (غفور رحيم for سميع عليم) is said, then the
 * reciter pauses, and the skip is only seen when the next utterance goes on
 * without it. Those trailing words (`tail`) lead the gap, or the sheet would say
 * "This word was not heard" about a word the reciter replaced.
 *
 * If the gap holds exactly one token per missing word, they pair up in order.
 * Otherwise the token closest to the expected word is taken, because the one
 * that sounds like it is the likeliest attempt at it.
 */
function saidInPlaceOf(
  heard: readonly string[],
  spelled: readonly string[],
  result: AlignResult,
  word: number,
  wordText: (index: number) => string,
  tail: SessionState['lastTail'],
): Said {
  const expected = wordText(word);
  let prevWord = -1;
  let prevHeard = -1;
  let nextWord = Number.MAX_SAFE_INTEGER;
  let nextHeard = heard.length;
  for (const m of result.matches) {
    if (m.word < word && m.word > prevWord) {
      prevWord = m.word;
      prevHeard = m.heard;
    }
    if (m.word > word && m.word < nextWord) {
      nextWord = m.word;
      nextHeard = m.heard;
    }
  }
  let tokens: Said[] = result.unmatchedHeard
    .filter((h) => h > prevHeard && h < nextHeard && (heard[h] ?? '') !== '')
    .sort((a, b) => a - b)
    .map((h) => ({ heard: heard[h], spelled: spelled[h] || heard[h] }));
  if (prevWord < 0 && tail !== null && word >= tail.from) {
    tokens = [...tail.tokens.map((t, i) => ({ heard: t, spelled: tail.spelled[i] || t })), ...tokens];
  }
  if (prevWord >= 0) {
    const before = wordText(prevWord);
    let lastRepeat = -1;
    tokens.forEach((t, i) => {
      if (compareWords(t.heard, before).ok) lastRepeat = i;
    });
    if (lastRepeat >= 0) tokens = tokens.slice(lastRepeat + 1);
  }
  if (tokens.length === 0) return NOTHING_SAID;

  const missing = result.skipped.filter((w) => w > prevWord && w < nextWord).sort((a, b) => a - b);
  const at = missing.indexOf(word);
  if (tokens.length === missing.length && at >= 0) return tokens[at];

  let best = NOTHING_SAID;
  let bestScore = Infinity;
  for (const t of tokens) {
    const score = weightedDistance(t.heard, expected) / Math.max(t.heard.length, expected.length, 1);
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** saidInPlaceOf(), normalized form only. */
export function heardInPlaceOf(
  heard: readonly string[],
  result: AlignResult,
  word: number,
  wordText: (index: number) => string,
  tail: SessionState['lastTail'] = null,
): string {
  return saidInPlaceOf(heard, heard, result, word, wordText, tail).heard;
}

/**
 * What a partial's result depends on besides its text: where the utterance
 * aligns from, and the look-ahead it aligns with.
 */
function partialSig(state: SessionState, alternatives: readonly string[]): string {
  return `${state.utteranceStart}\u0000${state.utteranceLockedOn ? 1 : 0}\u0000${alternatives.join('\u0001')}`;
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
    floor: config.floor,
    limit: config.limit,
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
    utteranceLockedOn: false,
    utteranceFresh: true,
    lastTail: null,
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
      /**
       * A finished practice range leaves the cursor AT its limit, where nothing
       * can be matched. Starting again there made "practise this ayah" work
       * exactly once: the second pass was not followed at all. Starting a range
       * that is over means going round it again, so the cursor wraps to its
       * first word.
       */
      const requested = event.cursor ?? state.cursor;
      const ranged = config.floor > 0 || config.limit < config.words.length;
      const cursor = ranged && requested >= config.limit ? config.floor : requested;
      // Hints are NOT carried over: they are this session's, like its mistakes.
      // Kept, they were counted again in every later summary ("Needed a hint: 3"
      // with none used) and graded down ayahs recited perfectly. Dismissals are
      // the user's permanent choice, so those stay.
      return {
        ...initialSession(cursor),
        dismissed: state.dismissed,
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
      const sig = partialSig(state, event.alternatives);
      if (event.type === 'partial' && sig === state.lastPartialSig) {
        return state.lastResultAt === event.at ? state : { ...state, lastResultAt: event.at };
      }

      const isFinal = event.type === 'final';
      const scored = scoreAlternatives(state, config, event.alternatives, isFinal);
      if (scored.length === 0) return state;
      const applied = applyResult(state, config, scored, event.at, event.emittedAt, isFinal);
      const jumped = maybeJump(applied, config, event.at);
      /**
       * The stored signature describes the computation that would happen NOW, so
       * it is built from the RESULTING utteranceStart — a jump can move it, and
       * the same transcript aligned from a different cursor is a different
       * question. Skipping on a stale signature would be the one way this
       * optimisation could change an answer.
       */
      const nextSig = partialSig(jumped, event.alternatives);
      return jumped.lastPartialSig === nextSig ? jumped : { ...jumped, lastPartialSig: nextSig };
    }

    case 'endOfSegment': {
      if (state.status !== 'listening') return state;
      if (
        state.utteranceHeard.length === 0 &&
        state.utteranceStart === state.cursor &&
        state.utteranceLockedOn === state.lockedOn
      ) {
        return state;
      }
      return { ...state, utteranceStart: state.cursor, utteranceLockedOn: state.lockedOn, utteranceHeard: [] };
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
        utteranceLockedOn: false,
        utteranceFresh: true,
        lastTail: null,
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

    /**
     * "I said it right" is permanent, and it sits one button away from "Show on
     * page". Without a way back, one mis-tap stopped the app checking that word
     * in every future session — on every phone the backup reached.
     */
    case 'undismiss': {
      if (!state.dismissed.has(event.word)) return state;
      const dismissed = new Set(state.dismissed);
      dismissed.delete(event.word);
      const mistakes =
        event.mistake === undefined ? state.mistakes : mergeMistakes(state.mistakes, [event.mistake]);
      return { ...state, dismissed, mistakes };
    }

    case 'clearDismissed':
      return state.dismissed.size === 0 ? state : { ...state, dismissed: EMPTY_SET };

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
        utteranceLockedOn: state.lockedOn,
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
      /**
       * The last words of a session can only be confirmed by words that come
       * after them, and at stop none will. Left pending they were dropped
       * silently, so a skip in the last three words of "practise this ayah" was
       * never reported. Stopping IS moving past them: every pending skip was
       * seen with a later word matched, so the "words past" gate is waived and
       * every other gate still applies.
       */
      const promotion = promotePending(state.pending, {
        cursor: state.cursor,
        sessionHeard: state.sessionHeard,
        wordText: (i) => config.words[i],
        matched: state.matched,
        dismissed: state.dismissed,
        now: event.at,
        minWordsPast: 0,
      });
      return {
        ...state,
        status: 'stopped',
        elapsedMs,
        utteranceHeard: [],
        pending: state.pending.length === 0 ? state.pending : [],
        mistakes: mergeMistakes(state.mistakes, promotion.promoted),
      };
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
