/**
 * Mistake policy (spec §5.6).
 *
 * False mistakes were the second-biggest complaint about the previous build, so
 * a word is flagged only when EVERY gate below is satisfied. Each gate exists
 * because a recognizer really does the thing it guards against.
 */
import { compareWords } from './distance';

export interface PendingSkip {
  /** index into the global word array */
  word: number;
  /** how many of the 5 alternatives agreed the word was skipped */
  votes: number;
  /** how many alternatives were considered */
  ofAlternatives: number;
  /** cursor when the skip was observed, for the "moved 3 words past" gate */
  observedAtCursor: number;
  /** best guess at what the reciter said instead, for the review sheet */
  heardInstead: string;
}

export interface Mistake {
  /** index into the global word array — the stable identity of this mistake */
  word: number;
  /** what the recognizer heard in its place, '' when it heard nothing */
  heardInstead: string;
  /** when it was confirmed, ms epoch, for stable ordering */
  at: number;
}

/** Gate 2: the skip must survive in at least this many of the 5 alternatives. */
export const MIN_ALTERNATIVE_VOTES = 2;
/**
 * Gate 3: the reciter must have moved at least this many words past it.
 *
 * Counted in words actually recited AFTER the skip, which is `cursor - word - 1`
 * — a skipped word at index w with the cursor at w+3 means two words followed
 * it, not three. Acceptance test 8 requires the flag to appear only once the
 * reciter is clear of the word, so the comparison below is strict.
 */
export const MIN_WORDS_PAST = 3;

export interface PromotionContext {
  /** current furthest progress */
  cursor: number;
  /** every normalized word heard this session (gate 5, the grace pass) */
  sessionHeard: readonly string[];
  /** the expected word text, for the grace pass */
  wordText: (index: number) => string;
  /** words that have been matched at some point this session (gate 4) */
  matched: ReadonlySet<number>;
  /** words the user permanently dismissed with "I said it right" (§5.6) */
  dismissed: ReadonlySet<number>;
  now: number;
}

/**
 * Gate 5, the grace pass: recognizers emit words LATE. If the expected word
 * appears anywhere in the session transcript, the reciter almost certainly said
 * it and the recognizer delivered it out of order — that is not a mistake.
 */
export function appearsInTranscript(
  wordText: string,
  sessionHeard: readonly string[],
): boolean {
  for (const heard of sessionHeard) {
    if (compareWords(heard, wordText).ok) return true;
  }
  return false;
}

export interface PromotionResult {
  /** skips still waiting for a gate */
  pending: PendingSkip[];
  /** newly confirmed mistakes, in ascending word order */
  promoted: Mistake[];
  /** pending entries dropped because a gate permanently ruled them out */
  discarded: number[];
}

/**
 * Walk the pending list and decide. Pure; the caller supplies `now`.
 */
export function promotePending(
  pending: readonly PendingSkip[],
  ctx: PromotionContext,
): PromotionResult {
  const stillPending: PendingSkip[] = [];
  const promoted: Mistake[] = [];
  const discarded: number[] = [];

  for (const p of pending) {
    // Gate 4a: the user settled this one forever.
    if (ctx.dismissed.has(p.word)) {
      discarded.push(p.word);
      continue;
    }
    // Gate 4b: it was matched after all — replay, or a late alternative landed.
    if (ctx.matched.has(p.word)) {
      discarded.push(p.word);
      continue;
    }
    // Gate 2: alternative agreement.
    if (p.votes < MIN_ALTERNATIVE_VOTES) {
      discarded.push(p.word);
      continue;
    }
    // Gate 3: has the reciter actually moved past it yet?
    if (ctx.cursor - p.word - 1 < MIN_WORDS_PAST) {
      stillPending.push(p);
      continue;
    }
    // Gate 5: the grace pass.
    if (appearsInTranscript(ctx.wordText(p.word), ctx.sessionHeard)) {
      discarded.push(p.word);
      continue;
    }
    promoted.push({ word: p.word, heardInstead: p.heardInstead, at: ctx.now });
  }

  promoted.sort((a, b) => a.word - b.word);
  return { pending: stillPending, promoted, discarded };
}

/**
 * Automatic retraction (spec §5.6): a later heard word matching a flagged word
 * removes the flag. Returns the SAME array reference when nothing changed, so
 * memoized mistake rows do not re-render.
 */
export function retractMatched(
  mistakes: readonly Mistake[],
  matchedNow: readonly number[],
): readonly Mistake[] {
  if (mistakes.length === 0 || matchedNow.length === 0) return mistakes;
  const hit = new Set(matchedNow);
  let changed = false;
  const out: Mistake[] = [];
  for (const m of mistakes) {
    if (hit.has(m.word)) {
      changed = true;
      continue;
    }
    out.push(m);
  }
  return changed ? out : mistakes;
}

/** Insert new mistakes, keeping ascending word order and stable identity. */
export function mergeMistakes(
  existing: readonly Mistake[],
  incoming: readonly Mistake[],
): readonly Mistake[] {
  if (incoming.length === 0) return existing;
  const known = new Set(existing.map((m) => m.word));
  const fresh = incoming.filter((m) => !known.has(m.word));
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh].sort((a, b) => a.word - b.word);
}
