/**
 * The bundled inverted index (spec §3.3) and candidate generation for
 * continuous global localization (spec §5.5).
 *
 * Postings live on disk as comma-joined base36 deltas in one string per word,
 * so JSON.parse is nearly free and only the handful of words actually queried
 * get decoded. Decoded lists are cached for the life of the process.
 *
 * Cost of one query: decode 2-4 short posting lists (cached after first use),
 * then a few hundred integer set lookups. Microseconds — which is why this can
 * run on EVERY partial result rather than being a special "search mode".
 */
import rawIndex from '../assets/quran-search.json';

const RAW = rawIndex as unknown as { stopwords: string[]; index: Record<string, string> };

/** The ~40 most frequent words, dropped from the index: useless as anchors. */
export const STOPWORDS: ReadonlySet<string> = new Set(RAW.stopwords);

const decoded = new Map<string, Int32Array>();
const decodedSets = new Map<string, Set<number>>();

/** Sorted global word positions of `word`, or null if not indexed. */
export function postingsFor(word: string): Int32Array | null {
  const cached = decoded.get(word);
  if (cached !== undefined) return cached;
  const raw = RAW.index[word];
  if (raw === undefined) return null;
  const parts = raw.split(',');
  const out = new Int32Array(parts.length);
  let prev = 0;
  for (let i = 0; i < parts.length; i++) {
    prev += parseInt(parts[i], 36);
    out[i] = prev;
  }
  decoded.set(word, out);
  return out;
}

function postingSet(word: string): Set<number> | null {
  const cached = decodedSets.get(word);
  if (cached !== undefined) return cached;
  const list = postingsFor(word);
  if (list === null) return null;
  const set = new Set<number>(list);
  decodedSets.set(word, set);
  return set;
}

/** Number of times `word` occurs in the Quran; 0 for stopwords and unknowns. */
export const frequencyOf = (word: string): number => postingsFor(word)?.length ?? 0;

/** Is this word usable as a search anchor at all? */
export const isIndexed = (word: string): boolean => RAW.index[word] !== undefined;

/** Every normalized word form that occurs in the Quran, including stopwords. */
let vocabCache: Set<string> | null = null;
export function vocabulary(): ReadonlySet<string> {
  if (vocabCache === null) {
    vocabCache = new Set(Object.keys(RAW.index));
    for (const w of RAW.stopwords) vocabCache.add(w);
  }
  return vocabCache;
}

export interface Candidate {
  /** global word index where this heard sequence is proposed to start */
  start: number;
  /** how many of the selected anchor words landed at their expected offset */
  votes: number;
  /** how many anchor words were used to vote */
  anchors: number;
}

export interface CandidateQuery {
  /** normalized heard words, basmala already stripped */
  heard: readonly string[];
  /** slack, in words, allowed between anchor offsets (ASR drops/inserts) */
  slack?: number;
  /** how many anchor words to use */
  maxAnchors?: number;
  /** how many candidates to return */
  limit?: number;
}

const DEFAULT_SLACK = 2;
const DEFAULT_MAX_ANCHORS = 4;
const DEFAULT_LIMIT = 8;
/** Never seed from a word this common — the candidate list would be huge. */
const MAX_SEED_POSTINGS = 900;

/**
 * Propose global start positions for a heard sequence.
 *
 * Seeds from the rarest indexed heard word (so the candidate list is short),
 * then votes with the next-rarest ones. Returns candidates sorted by votes
 * descending. `votes === anchors` means every anchor word lined up.
 */
export function candidateStarts(query: CandidateQuery): Candidate[] {
  const heard = query.heard;
  const slack = query.slack ?? DEFAULT_SLACK;
  const maxAnchors = query.maxAnchors ?? DEFAULT_MAX_ANCHORS;
  const limit = query.limit ?? DEFAULT_LIMIT;

  const indexable: { offset: number; word: string; freq: number }[] = [];
  for (let i = 0; i < heard.length; i++) {
    const w = heard[i];
    const freq = frequencyOf(w);
    if (freq > 0) indexable.push({ offset: i, word: w, freq });
  }
  if (indexable.length === 0) return [];

  indexable.sort((a, b) => a.freq - b.freq);
  const anchors = indexable.slice(0, maxAnchors);
  const seed = anchors[0];
  if (seed.freq > MAX_SEED_POSTINGS) return [];

  const seedPostings = postingsFor(seed.word);
  if (seedPostings === null) return [];

  const voterSets: { offset: number; set: Set<number> }[] = [];
  for (const a of anchors) {
    if (a.offset === seed.offset) continue;
    const set = postingSet(a.word);
    if (set !== null) voterSets.push({ offset: a.offset, set });
  }

  const out: Candidate[] = [];
  for (let k = 0; k < seedPostings.length; k++) {
    const start = seedPostings[k] - seed.offset;
    if (start < 0) continue;
    let votes = 1;
    for (const v of voterSets) {
      const want = start + v.offset;
      let hit = false;
      for (let d = -slack; d <= slack && !hit; d++) hit = v.set.has(want + d);
      if (hit) votes++;
    }
    out.push({ start, votes, anchors: 1 + voterSets.length });
  }

  out.sort((a, b) => b.votes - a.votes || a.start - b.start);
  return out.slice(0, Math.max(limit, out.filter((c) => c.votes === c.anchors).length));
}

/**
 * How many places in the Quran the given heard sequence could start, counting
 * only positions where every anchor word lines up. Used for the uniqueness
 * rule of §5.5 ("a 3-word phrase may only anchor a jump if it is unique").
 */
export function fullVoteCount(query: CandidateQuery): number {
  const c = candidateStarts({ ...query, limit: Number.MAX_SAFE_INTEGER });
  return c.filter((x) => x.votes === x.anchors && x.anchors >= 2).length;
}
