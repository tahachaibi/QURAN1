/**
 * Sequence alignment of heard words against expected words (spec §5.3–§5.4).
 *
 * We never transcribe-then-compare. We know the text, so we ALIGN: for each
 * heard word, ask "is it one of the next few expected words?". Verifying that
 * is far easier than open transcription, which is what makes a mediocre
 * recognizer good enough.
 *
 * `align()` is a PURE function. It is re-run from the same `startCursor` every
 * time a partial result grows, so it must be idempotent: same input, same
 * output, no accumulated state (spec §5.4).
 */
import { compareWords } from './distance';

export interface AlignOptions {
  /** the global word array (spec §2) */
  words: readonly string[];
  /** cursor at the start of this utterance; the result never goes below it */
  startCursor: number;
  /** normalized heard words for the transcript so far */
  heard: readonly string[];
  /** 3 when locked on, 8 when not (fresh session or just after a jump) */
  lookAhead: number;
  /** how far back to hunt for a breath-restart re-anchor; ~24 words */
  backtrack?: number;
  /** exclusive upper bound on expected indices (ayah-range practice, EOF) */
  limit?: number;
  /** inclusive lower bound on expected indices */
  floor?: number;
}

export interface AlignMatch {
  /** index into the global word array */
  word: number;
  /** index into `heard` */
  heard: number;
  /** weighted edit distance of the pair (0 = identical) */
  distance: number;
  /** 0 (perfect) .. 1 (at threshold) */
  ratio: number;
}

export interface AlignResult {
  /** furthest progress; never below `startCursor` */
  cursor: number;
  /** where the voice is right now; MAY be below `startCursor` */
  livePos: number;
  /** expected index the winning walk started from */
  anchor: number;
  matches: AlignMatch[];
  /** expected indices stepped over between two matches */
  skipped: number[];
  /** indices into `heard` that matched nothing */
  unmatchedHeard: number[];
  /** number of matched words */
  progress: number;
  /** alignment quality, roughly -1..1; comparable across anchors */
  score: number;
  /** true when no heard word matched anything */
  empty: boolean;
}

/** Weight given to a match at look-ahead distance d, to prefer nearer words. */
const DISTANCE_PENALTY = 0.02;
/** How much an exact match contributes vs. one sitting right on the threshold. */
const RATIO_WEIGHT = 0.6;
/** Cost, in score terms, of stepping over an expected word. */
const SKIP_PENALTY = 0.35;
/** A heard word must be at least this long to anchor a backwards re-anchor. */
const MIN_ANCHOR_LEN = 3;
/**
 * Going backwards must be justified by MORE of the transcript fitting, not by
 * one word fitting better. Without this, a single repeated word (الرحيم occurs
 * at 1:1 and 1:3) drags livePos back five words for no reason.
 */
const MIN_BACKWARD_MATCHES = 2;
export const DEFAULT_BACKTRACK = 24;

interface Walk {
  matches: AlignMatch[];
  skipped: number[];
  unmatchedHeard: number[];
  end: number;
  score: number;
}

function walk(
  words: readonly string[],
  heard: readonly string[],
  anchor: number,
  lookAhead: number,
  limit: number,
): Walk {
  const matches: AlignMatch[] = [];
  const skipped: number[] = [];
  const unmatchedHeard: number[] = [];
  let pos = anchor;
  let quality = 0;

  for (let h = 0; h < heard.length; h++) {
    const token = heard[h];
    let bestPos = -1;
    let bestCost = Infinity;
    let bestDistance = 0;
    let bestRatio = 0;
    for (let d = 0; d <= lookAhead; d++) {
      const p = pos + d;
      if (p >= limit) break;
      const cmp = compareWords(token, words[p]);
      if (!cmp.ok) continue;
      const cost = cmp.ratio + d * DISTANCE_PENALTY;
      if (cost < bestCost) {
        bestCost = cost;
        bestPos = p;
        bestDistance = cmp.distance;
        bestRatio = cmp.ratio;
      }
    }
    if (bestPos < 0) {
      unmatchedHeard.push(h);
      continue;
    }
    for (let p = pos; p < bestPos; p++) skipped.push(p);
    matches.push({ word: bestPos, heard: h, distance: bestDistance, ratio: bestRatio });
    quality += 1 - RATIO_WEIGHT * bestRatio;
    pos = bestPos + 1;
  }

  const denom = Math.max(1, heard.length);
  const score = (quality - SKIP_PENALTY * skipped.length) / denom;
  return { matches, skipped, unmatchedHeard, end: pos, score };
}

/**
 * Candidate start positions for the walk.
 *
 * Always includes `startCursor`. Additionally, for breath-restart (spec §5.3),
 * hunts backwards up to `backtrack` words for a position where the first
 * substantial heard word (length >= 3) lands, so a reciter who pauses and
 * resumes from earlier in the verse is followed backwards. Only positions the
 * first anchor-worthy word actually matches are considered, so this stays
 * O(backtrack) comparisons rather than O(backtrack * heard * lookAhead).
 */
function candidateAnchors(opt: Required<Pick<AlignOptions, 'words' | 'startCursor' | 'heard' | 'lookAhead' | 'backtrack' | 'floor' | 'limit'>>): number[] {
  const { words, startCursor, heard, backtrack, floor, limit } = opt;
  const anchors = [startCursor];
  let j0 = -1;
  for (let j = 0; j < heard.length; j++) {
    if (heard[j].length >= MIN_ANCHOR_LEN) {
      j0 = j;
      break;
    }
  }
  if (j0 < 0 || backtrack <= 0) return anchors;
  const token = heard[j0];
  const from = Math.max(floor, startCursor - backtrack);
  for (let p = from; p < startCursor; p++) {
    if (p >= limit) break;
    if (!compareWords(token, words[p]).ok) continue;
    const anchor = Math.max(floor, p - j0);
    if (!anchors.includes(anchor)) anchors.push(anchor);
  }
  return anchors;
}

export function align(options: AlignOptions): AlignResult {
  const words = options.words;
  const heard = options.heard;
  const floor = Math.max(0, options.floor ?? 0);
  const limit = Math.min(words.length, options.limit ?? words.length);
  const startCursor = Math.min(Math.max(options.startCursor, floor), limit);
  const lookAhead = Math.max(0, options.lookAhead);
  const backtrack = options.backtrack ?? DEFAULT_BACKTRACK;

  if (heard.length === 0 || startCursor >= limit) {
    return {
      cursor: startCursor,
      livePos: startCursor,
      anchor: startCursor,
      matches: [],
      skipped: [],
      unmatchedHeard: [],
      progress: 0,
      score: 0,
      empty: true,
    };
  }

  const anchors = candidateAnchors({ words, startCursor, heard, lookAhead, backtrack, floor, limit });

  // The forward walk from startCursor is the baseline. A backwards anchor may
  // only displace it by explaining strictly more of the transcript.
  const forward = walk(words, heard, startCursor, lookAhead, limit);
  let best = forward;
  let bestAnchor = startCursor;
  for (const anchor of anchors) {
    if (anchor === startCursor) continue;
    const w = walk(words, heard, anchor, lookAhead, limit);
    const backwards = anchor < startCursor;
    if (backwards) {
      if (w.matches.length < MIN_BACKWARD_MATCHES) continue;
      if (w.matches.length <= forward.matches.length) continue;
    }
    if (
      w.matches.length > best.matches.length ||
      (w.matches.length === best.matches.length &&
        (w.score > best.score + 1e-9 ||
          (Math.abs(w.score - best.score) <= 1e-9 && anchor > bestAnchor)))
    ) {
      best = w;
      bestAnchor = anchor;
    }
  }
  const w = best;

  const empty = w.matches.length === 0;
  return {
    cursor: Math.max(startCursor, empty ? startCursor : w.end),
    livePos: empty ? startCursor : w.end,
    anchor: bestAnchor,
    matches: w.matches,
    skipped: w.skipped,
    unmatchedHeard: w.unmatchedHeard,
    progress: w.matches.length,
    score: w.score,
    empty,
  };
}

/** Look-ahead policy (spec §5.4). */
export const LOOK_AHEAD_LOCKED = 3;
export const LOOK_AHEAD_SEEKING = 8;
/** Forward matches required before the session counts as locked on. */
export const LOCK_ON_PROGRESS = 3;

export const lookAheadFor = (lockedOn: boolean): number =>
  lockedOn ? LOOK_AHEAD_LOCKED : LOOK_AHEAD_SEEKING;
