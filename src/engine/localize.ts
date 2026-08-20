/**
 * Confidence-scored continuous localization (spec §5.5).
 *
 * This replaces the old "no match for a while -> enter search mode" design.
 * On EVERY partial we compute two numbers: how well the freshest heard words
 * align where we think we are, and the best they align anywhere in the Quran.
 * If the global candidate clearly wins on two consecutive partials, the cursor
 * moves there. Because the inverted index makes the global question cost
 * microseconds, the jump is instant instead of waiting for enough "unmatched
 * surplus" to pile up.
 */
import { align, DEFAULT_BACKTRACK, LOOK_AHEAD_SEEKING } from './align';
import { stripLeadingBasmala } from './normalize';
import { candidateStarts, fullVoteCount } from './searchIndex';

export interface LocalizeInput {
  words: readonly string[];
  /** furthest progress */
  cursor: number;
  /** where the voice is right now */
  livePos: number;
  /** normalized heard words for the current transcript */
  heard: readonly string[];
  /** score of the local alignment at livePos, for comparison */
  localScore: number;
  /** surah currently on screen; breaks ties in its favour */
  viewSurah?: number;
  /** how many of the freshest heard words to localize with (4..8) */
  tailSize?: number;
  /** map from word index to surah, for the view tie-break */
  surahOf?: (index: number) => number;
}

export interface LocalizeResult {
  /** proposed landing position, or null when nothing beats staying put */
  target: number | null;
  /** cursor after crediting the triggering transcript from the landing point */
  creditedCursor: number;
  globalScore: number;
  localScore: number;
  margin: number;
  /** how many heard words the decision used */
  usedWords: number;
  /** was the anchoring phrase unique in the Quran */
  unique: boolean;
  /** human-readable, for the dev debug overlay (spec §9) */
  reason: string;
}

/** Jumps of this size or smaller are just normal progress (spec §5.5). */
export const MIN_JUMP_DISTANCE = 6;
/** How much better the global candidate must be before it can win. */
export const JUMP_MARGIN = 0.25;
/** Absolute floor on the global score; stops junk transcripts from jumping. */
export const JUMP_MIN_SCORE = 0.45;
/** Fewer heard words than this can never anchor a jump. */
export const MIN_JUMP_WORDS = 3;
/** With fewer than this many words, the phrase must be unique in the Quran. */
export const UNIQUE_REQUIRED_BELOW = 4;
export const DEFAULT_TAIL = 8;

const NO_RESULT = (localScore: number, reason: string): LocalizeResult => ({
  target: null,
  creditedCursor: -1,
  globalScore: 0,
  localScore,
  margin: 0,
  usedWords: 0,
  unique: false,
  reason,
});

export function localize(input: LocalizeInput): LocalizeResult {
  const { words, cursor, livePos, localScore } = input;
  const tailSize = input.tailSize ?? DEFAULT_TAIL;

  // Nearly every surah opens with the basmala, so it identifies nothing and
  // must never anchor a jump — nor may the current surah's own basmala
  // suppress one.
  const stripped = stripLeadingBasmala(input.heard);
  const tail = stripped.slice(Math.max(0, stripped.length - tailSize));

  if (tail.length < MIN_JUMP_WORDS) return NO_RESULT(localScore, 'too few words to localize');

  const candidates = candidateStarts({ heard: tail });
  if (candidates.length === 0) return NO_RESULT(localScore, 'no indexed anchor words');

  const unique = tail.length >= UNIQUE_REQUIRED_BELOW ? true : fullVoteCount({ heard: tail }) === 1;
  if (!unique) return NO_RESULT(localScore, `${tail.length}-word phrase is not unique`);

  /**
   * The caller passes the local score from the session's own alignment, which
   * uses the narrow locked-on look-ahead. Before considering a jump we also ask
   * the generous question: could ANYTHING near the current position explain this
   * audio, with the wide look-ahead and the breath-restart window? Taking the
   * better of the two as the bar is what stops normal forward progress — or a
   * resumed breath — from being mistaken for a jump.
   */
  const generous = align({
    words,
    startCursor: livePos,
    heard: tail,
    lookAhead: LOOK_AHEAD_SEEKING,
    backtrack: DEFAULT_BACKTRACK,
  });
  const localBar = Math.max(localScore, generous.score);

  const surahOf = input.surahOf;
  const viewSurah = input.viewSurah;

  let bestScore = -Infinity;
  let bestTarget: number | null = null;
  let bestCredited = -1;
  let bestRank = -Infinity;

  for (const c of candidates) {
    if (c.start < 0 || c.start >= words.length) continue;
    // ignore candidate jumps of <= 6 words: that is just normal progress
    if (Math.abs(c.start - livePos) <= MIN_JUMP_DISTANCE) continue;

    // Arriving mid-verse must CREDIT what was already recited: align the
    // triggering transcript from the landing point and advance past it,
    // rather than dumping the reciter at the verse's first word.
    const a = align({
      words,
      startCursor: c.start,
      heard: tail,
      lookAhead: LOOK_AHEAD_SEEKING,
      backtrack: 0,
    });
    if (a.empty) continue;

    // Tie-break: prefer the surah in view, then the position nearest the cursor.
    const inView = viewSurah !== undefined && surahOf !== undefined && surahOf(c.start) === viewSurah;
    const rank = (inView ? 1_000_000 : 0) - Math.abs(c.start - cursor) / 1000;

    if (a.score > bestScore + 1e-9 || (Math.abs(a.score - bestScore) <= 1e-9 && rank > bestRank)) {
      bestScore = a.score;
      bestTarget = c.start;
      bestCredited = a.cursor;
      bestRank = rank;
    }
  }

  if (bestTarget === null) return NO_RESULT(localScore, 'no candidate outside the local window');

  const margin = bestScore - localBar;
  if (bestScore < JUMP_MIN_SCORE) {
    return {
      target: null,
      creditedCursor: -1,
      globalScore: bestScore,
      localScore: localBar,
      margin,
      usedWords: tail.length,
      unique,
      reason: `global score ${bestScore.toFixed(2)} below floor ${JUMP_MIN_SCORE}`,
    };
  }
  if (margin < JUMP_MARGIN) {
    return {
      target: null,
      creditedCursor: -1,
      globalScore: bestScore,
      localScore: localBar,
      margin,
      usedWords: tail.length,
      unique,
      reason: `margin ${margin.toFixed(2)} below ${JUMP_MARGIN}`,
    };
  }

  return {
    target: bestTarget,
    creditedCursor: bestCredited,
    globalScore: bestScore,
    localScore: localBar,
    margin,
    usedWords: tail.length,
    unique,
    reason: `candidate at ${bestTarget} beats local by ${margin.toFixed(2)}`,
  };
}
