/**
 * Your personal recitation confusion profile.
 *
 * Aggregates real mistakes into letter-level and structural patterns, so the app
 * can say something more useful than "you got 12 words wrong": it can say which
 * sounds you actually keep slipping on, and how much of it is likely the
 * recognizer rather than you.
 *
 * Honesty constraints baked in:
 *
 *  - A mistake only contributes a SUBSTITUTION pattern when what was heard is a
 *    near neighbour of what was expected. `heardInstead` is a heuristic (the
 *    nearest unmatched token), so attributing letter-level blame to an unrelated
 *    word would invent findings. Everything else is recorded as an omission.
 *  - Patterns inside a phonetic equivalence class are flagged as LIKELY
 *    RECOGNIZER error, not reciter error, because those are exactly the pairs
 *    Android's Arabic model confuses. Telling someone they mispronounce ص when
 *    the recognizer simply cannot hear the difference would be a lie.
 */
import { PHONETIC_CLASSES, weightedDistance } from './distance';

/** Same-class pairs are the recognizer's known weakness, not necessarily yours. */
const CLASS_OF = (() => {
  const m = new Map<string, number[]>();
  PHONETIC_CLASSES.forEach((cls, i) => {
    for (const ch of cls) {
      const list = m.get(ch);
      if (list === undefined) m.set(ch, [i]);
      else list.push(i);
    }
  });
  return m;
})();

const sharesClass = (a: string, b: string): boolean => {
  const ca = CLASS_OF.get(a);
  const cb = CLASS_OF.get(b);
  if (ca === undefined || cb === undefined) return false;
  return ca.some((i) => cb.includes(i));
};

const LONG_VOWELS = 'اوي';

export type PatternKind =
  /** one letter heard as another */
  | 'substitution'
  /** a long vowel (madd) dropped or added */
  | 'madd'
  /** the word was not heard at all */
  | 'omission'
  /** heard something, but too far from the expected word to attribute */
  | 'unrelated';

export interface ConfusionEvent {
  kind: PatternKind;
  /** expected letter, for substitution/madd */
  expected: string;
  /** heard letter, for substitution */
  heard: string;
  /** true when the pair sits inside a phonetic class the recognizer confuses */
  likelyRecognizer: boolean;
  /** global word index this came from */
  word: number;
}

export interface MistakeRecord {
  word: number;
  /** normalized expected word */
  expected: string;
  /** normalized heard word, '' when nothing was heard */
  heardInstead: string;
}

/**
 * How close `heard` must be to `expected` before letter-level blame is fair.
 * Beyond this the recognizer heard something else entirely and the alignment,
 * not the pronunciation, is what went wrong.
 */
const ATTRIBUTION_LIMIT = 0.5;

/** Extract the letter-level story of one mistake. */
export function analyseMistake(record: MistakeRecord): ConfusionEvent[] {
  const { expected, heardInstead: heard, word } = record;
  if (expected.length === 0) return [];
  if (heard.length === 0) {
    return [{ kind: 'omission', expected, heard: '', likelyRecognizer: false, word }];
  }

  const maxLen = Math.max(expected.length, heard.length);
  if (weightedDistance(expected, heard) / maxLen > ATTRIBUTION_LIMIT) {
    return [{ kind: 'unrelated', expected, heard, likelyRecognizer: false, word }];
  }

  // Walk the optimal alignment of the two spellings and name each difference.
  const ops = traceback(expected, heard);
  const out: ConfusionEvent[] = [];
  for (const op of ops) {
    if (op.kind === 'match') continue;
    if (op.kind === 'gap') {
      const ch = op.expected || op.heard;
      if (LONG_VOWELS.includes(ch)) {
        out.push({ kind: 'madd', expected: ch, heard: '', likelyRecognizer: true, word });
      } else {
        out.push({ kind: 'omission', expected: ch, heard: '', likelyRecognizer: false, word });
      }
      continue;
    }
    out.push({
      kind: 'substitution',
      expected: op.expected,
      heard: op.heard,
      likelyRecognizer: sharesClass(op.expected, op.heard),
      word,
    });
  }
  return out;
}

interface Op {
  kind: 'match' | 'sub' | 'gap';
  expected: string;
  heard: string;
}

/**
 * Plain unweighted traceback. The weighted distance decides WHETHER to
 * attribute; once we have decided to, we want the simplest edit story, and a
 * weighted path would bias the narrative toward whichever edits we made cheap.
 */
function traceback(a: string, b: string): Op[] {
  const n = a.length;
  const m = b.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
      );
    }
  }
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      ops.push({
        kind: a[i - 1] === b[j - 1] ? 'match' : 'sub',
        expected: a[i - 1],
        heard: b[j - 1],
      });
      i--;
      j--;
      continue;
    }
    if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ kind: 'gap', expected: a[i - 1], heard: '' });
      i--;
      continue;
    }
    ops.push({ kind: 'gap', expected: '', heard: b[j - 1] });
    j--;
  }
  return ops.reverse();
}

export interface ConfusionPattern {
  /** stable key, e.g. "sub:ض>ظ" or "madd:ا" */
  id: string;
  kind: PatternKind;
  expected: string;
  heard: string;
  count: number;
  likelyRecognizer: boolean;
  /** the words this pattern was seen on, for "practise these" */
  words: number[];
}

export interface ConfusionProfile {
  patterns: ConfusionPattern[];
  totalEvents: number;
  /** share of events the recognizer is the likely culprit for, 0..1 */
  recognizerShare: number;
  /** how many mistakes could not be attributed at all */
  unattributed: number;
}

/** How many observations before a pattern is worth telling the user about. */
export const MIN_PATTERN_COUNT = 3;

export function buildProfile(records: readonly MistakeRecord[]): ConfusionProfile {
  const byId = new Map<string, ConfusionPattern>();
  let totalEvents = 0;
  let recognizerEvents = 0;
  let unattributed = 0;

  for (const record of records) {
    const events = analyseMistake(record);
    for (const e of events) {
      if (e.kind === 'unrelated') {
        unattributed++;
        continue;
      }
      totalEvents++;
      if (e.likelyRecognizer) recognizerEvents++;
      const id =
        e.kind === 'substitution'
          ? `sub:${e.expected}>${e.heard}`
          : e.kind === 'madd'
            ? `madd:${e.expected}`
            : `omit:${e.expected}`;
      const existing = byId.get(id);
      if (existing === undefined) {
        byId.set(id, {
          id,
          kind: e.kind,
          expected: e.expected,
          heard: e.heard,
          count: 1,
          likelyRecognizer: e.likelyRecognizer,
          words: [e.word],
        });
        continue;
      }
      existing.count++;
      if (!existing.words.includes(e.word)) existing.words.push(e.word);
    }
  }

  const patterns = [...byId.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return {
    patterns,
    totalEvents,
    recognizerShare: totalEvents === 0 ? 0 : recognizerEvents / totalEvents,
    unattributed,
  };
}

/** The patterns worth surfacing, and a plain-language line for each. */
export function actionablePatterns(profile: ConfusionProfile): { pattern: ConfusionPattern; advice: string }[] {
  return profile.patterns
    .filter((p) => p.count >= MIN_PATTERN_COUNT)
    .map((p) => ({ pattern: p, advice: describe(p) }));
}

function describe(p: ConfusionPattern): string {
  if (p.kind === 'madd') {
    return `The madd on ${p.expected} keeps getting lost. This is usually the recognizer mishearing vowel length rather than your recitation — check it against the Listen tab before drilling it.`;
  }
  if (p.kind === 'omission') {
    return `${p.expected} is being dropped. Slow down on the words below and let the letter land.`;
  }
  if (p.likelyRecognizer) {
    return `${p.expected} is coming back as ${p.heard}. These two are hard for Android's Arabic model to tell apart, so this is more likely the recognizer than you.`;
  }
  return `${p.expected} is coming back as ${p.heard}, and these are not sounds the recognizer usually confuses — worth checking your articulation on the words below.`;
}
