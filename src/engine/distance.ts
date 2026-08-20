/**
 * Phonetic-weighted edit distance (spec §5.2).
 *
 * Plain Levenshtein produced a stream of false "mistakes" because Android's
 * Arabic recognizer systematically confuses phonetically adjacent letters and
 * gets madd (long-vowel) length wrong. Substitutions inside an equivalence
 * class cost 0.5; inserting or deleting a long vowel costs 0.25.
 */

/** Phonetic equivalence classes. Classes may overlap (ز is in two). */
export const PHONETIC_CLASSES: readonly string[] = [
  'سصث',
  'تط',
  'دضذظز',
  'هحخ',
  'كق',
  'عءا',
  'جزژ',
  'بف',
  'نم',
  'وؤ',
  'يئى',
  'لر',
];

const CLASS_BITS: Map<string, number> = (() => {
  const m = new Map<string, number>();
  PHONETIC_CLASSES.forEach((cls, i) => {
    for (const ch of cls) m.set(ch, (m.get(ch) ?? 0) | (1 << i));
  });
  return m;
})();

/** Long vowels: their presence is nearly free, madd length is what ASR fumbles. */
const LONG_VOWELS = 'اوي';

export const SUB_SAME_CLASS = 0.5;
export const SUB_DIFFERENT = 1;
export const GAP_LONG_VOWEL = 0.25;
export const GAP_DEFAULT = 1;

function subCost(a: string, b: string): number {
  if (a === b) return 0;
  const ba = CLASS_BITS.get(a);
  const bb = CLASS_BITS.get(b);
  if (ba !== undefined && bb !== undefined && (ba & bb) !== 0) return SUB_SAME_CLASS;
  return SUB_DIFFERENT;
}

function gapCost(ch: string): number {
  return LONG_VOWELS.includes(ch) ? GAP_LONG_VOWEL : GAP_DEFAULT;
}

/**
 * Weighted Levenshtein. O(|a| * |b|) with a rolling row; words are short so
 * this is a few hundred float ops even in the worst case.
 */
export function weightedDistance(a: string, b: string): number {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (n === 0) return sumGaps(b);
  if (m === 0) return sumGaps(a);

  let prev = new Float64Array(m + 1);
  let cur = new Float64Array(m + 1);
  prev[0] = 0;
  for (let j = 1; j <= m; j++) prev[j] = prev[j - 1] + gapCost(b[j - 1]);

  for (let i = 1; i <= n; i++) {
    cur[0] = prev[0] + gapCost(a[i - 1]);
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      const bj = b[j - 1];
      const sub = prev[j - 1] + subCost(ai, bj);
      const del = prev[j] + gapCost(ai);
      const ins = cur[j - 1] + gapCost(bj);
      cur[j] = sub < del ? (sub < ins ? sub : ins) : del < ins ? del : ins;
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[m];
}

function sumGaps(s: string): number {
  let t = 0;
  for (const ch of s) t += gapCost(ch);
  return t;
}

/**
 * Acceptance threshold for a pair of normalized words (spec §5.2).
 * Quranic Arabic is full of near-minimal pairs, so these stay tight.
 */
export function matchThreshold(a: string, b: string): number {
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  if (minLen <= 2) return 0; // من، في، ما must match exactly
  if (maxLen <= 6) return 1.0;
  if (maxLen <= 9) return 2.0;
  return 0.28 * maxLen;
}

export interface WordMatch {
  /** true when the pair is close enough to count as the same word */
  ok: boolean;
  /** weighted edit distance */
  distance: number;
  /** threshold that was applied */
  threshold: number;
  /** 0 (perfect) .. 1 (at threshold); >1 means rejected */
  ratio: number;
}

export function compareWords(heard: string, expected: string): WordMatch {
  const threshold = matchThreshold(heard, expected);
  if (heard === expected) return { ok: true, distance: 0, threshold, ratio: 0 };
  if (threshold === 0) return { ok: false, distance: weightedDistance(heard, expected), threshold, ratio: Infinity };
  const distance = weightedDistance(heard, expected);
  return { ok: distance <= threshold, distance, threshold, ratio: distance / threshold };
}

/** Convenience predicate used all over the aligner. */
export function wordsMatch(heard: string, expected: string): boolean {
  return compareWords(heard, expected).ok;
}
