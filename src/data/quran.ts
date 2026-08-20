/**
 * The bundled Quran, and the coordinate system the whole app is built on.
 *
 * Spec §2: the reciter's position is ONE integer index into a flat array of
 * every word in the Quran. Everything else — which surah, which ayah, which
 * mushaf page — is derived from that integer. No screen owns a position.
 */
import { tokenizeAyah } from '../engine/normalize';
import rawData from '../assets/quran-data.json';
import rawWords from '../assets/quran-words.json';

export type SurahType = 'meccan' | 'medinan';

/** Compact ayah row as stored on disk: [ayahNo, globalAyahNo, page, juz, text] */
type AyahRow = [number, number, number, number, string];
/** Compact surah row: [surah, name, translit, translation, type, ayahs] */
type SurahRow = [number, string, string, string, string, AyahRow[]];

const DATA = rawData as unknown as SurahRow[];
const WORDS_RAW = rawWords as unknown as {
  count: number;
  words: string;
  ayahStartWord: number[];
  pageStartWord: number[];
  surahStartWord: number[];
};

export const TOTAL_WORDS = WORDS_RAW.count;
export const TOTAL_AYAHS = 6236;
export const TOTAL_SURAHS = 114;
export const TOTAL_PAGES = 604;
export const TOTAL_JUZ = 30;

/** Every normalized word in the Quran, in order. The cursor indexes this. */
export const words: string[] = WORDS_RAW.words.split(' ');

/** First word index of ayah n (0-based global ayah); has a trailing sentinel. */
export const ayahStartWord: readonly number[] = WORDS_RAW.ayahStartWord;
/** First word index of Madani page p (0-based); has a trailing sentinel. */
export const pageStartWord: readonly number[] = WORDS_RAW.pageStartWord;
/** First word index of surah s (0-based); has a trailing sentinel. */
export const surahStartWord: readonly number[] = WORDS_RAW.surahStartWord;

if (words.length !== TOTAL_WORDS) {
  throw new Error(
    `quran-words.json is corrupt: split gave ${words.length} words, header says ${TOTAL_WORDS}. ` +
      `Re-run "npm run gen" to regenerate src/assets/.`,
  );
}

// ---------------------------------------------------------------------------
// Per-word lookup tables (the wordMeta of §2), materialised once as typed
// arrays. O(1) access, ~380 KB total, no 77k-object allocation.
// ---------------------------------------------------------------------------

const wordSurah = new Uint8Array(TOTAL_WORDS);
const wordAyah = new Uint16Array(TOTAL_WORDS);
const wordInAyah = new Uint16Array(TOTAL_WORDS);
const wordPage = new Uint16Array(TOTAL_WORDS);
/** 0-based global ayah index for each word */
const wordGlobalAyah = new Uint16Array(TOTAL_WORDS);

(function buildWordMeta() {
  // walk ayahs in order; each ayah knows its surah/ayah/page from DATA
  let g = 0;
  for (const [surah, , , , , ayahs] of DATA) {
    for (const [ayahNo, , page] of ayahs) {
      const from = ayahStartWord[g];
      const to = ayahStartWord[g + 1];
      for (let i = from; i < to; i++) {
        wordSurah[i] = surah;
        wordAyah[i] = ayahNo;
        wordInAyah[i] = i - from;
        wordPage[i] = page;
        wordGlobalAyah[i] = g;
      }
      g++;
    }
  }
  if (g !== TOTAL_AYAHS) throw new Error(`built ${g} ayahs, expected ${TOTAL_AYAHS}`);
})();

export interface WordMeta {
  surah: number;
  ayah: number;
  wordInAyah: number;
  page: number;
}

/** The §2 wordMeta lookup. Allocates one small object; do not call per-frame. */
export function wordMeta(index: number): WordMeta {
  const i = clampWord(index);
  return { surah: wordSurah[i], ayah: wordAyah[i], wordInAyah: wordInAyah[i], page: wordPage[i] };
}

export const clampWord = (i: number): number =>
  i < 0 ? 0 : i >= TOTAL_WORDS ? TOTAL_WORDS - 1 : i | 0;

export const surahOf = (i: number): number => wordSurah[clampWord(i)];
export const ayahOf = (i: number): number => wordAyah[clampWord(i)];
export const wordInAyahOf = (i: number): number => wordInAyah[clampWord(i)];
export const pageOf = (i: number): number => wordPage[clampWord(i)];
export const globalAyahOf = (i: number): number => wordGlobalAyah[clampWord(i)];

/** Word range [from, to) of a Madani page (1-based page number). */
export function pageWordRange(page: number): [number, number] {
  const p = page < 1 ? 1 : page > TOTAL_PAGES ? TOTAL_PAGES : page | 0;
  return [pageStartWord[p - 1], pageStartWord[p]];
}

/** Word range [from, to) of a surah (1-based). */
export function surahWordRange(surah: number): [number, number] {
  const s = surah < 1 ? 1 : surah > TOTAL_SURAHS ? TOTAL_SURAHS : surah | 0;
  return [surahStartWord[s - 1], surahStartWord[s]];
}

/** Word range [from, to) of an ayah, addressed by surah:ayah. */
export function ayahWordRange(surah: number, ayah: number): [number, number] {
  const g = globalAyahIndex(surah, ayah);
  return [ayahStartWord[g], ayahStartWord[g + 1]];
}

/** First word index of surah:ayah — the canonical way to seed a cursor. */
export function wordIndexOf(surah: number, ayah: number): number {
  return ayahStartWord[globalAyahIndex(surah, ayah)];
}

// ---------------------------------------------------------------------------
// Surah / ayah metadata
// ---------------------------------------------------------------------------

export interface SurahInfo {
  number: number;
  name: string;
  transliteration: string;
  translation: string;
  type: SurahType;
  totalVerses: number;
  page: number;
  juz: number;
}

export const surahs: readonly SurahInfo[] = DATA.map((row) => ({
  number: row[0],
  name: row[1],
  transliteration: row[2],
  translation: row[3],
  type: row[4] as SurahType,
  totalVerses: row[5].length,
  page: row[5][0][2],
  juz: row[5][0][3],
}));

export function surahInfo(surah: number): SurahInfo {
  const s = surahs[surah - 1];
  if (!s) throw new Error(`surah ${surah} out of range 1..114`);
  return s;
}

export interface Ayah {
  surah: number;
  ayah: number;
  globalAyah: number;
  page: number;
  juz: number;
  text: string;
  /** first word index of this ayah in the global word array */
  wordStart: number;
  /** one past the last word index */
  wordEnd: number;
}

const globalAyahBase: number[] = (() => {
  const base: number[] = [];
  let g = 0;
  for (const row of DATA) {
    base.push(g);
    g += row[5].length;
  }
  return base;
})();

export function globalAyahIndex(surah: number, ayah: number): number {
  const s = surah < 1 ? 1 : surah > TOTAL_SURAHS ? TOTAL_SURAHS : surah | 0;
  const count = DATA[s - 1][5].length;
  const a = ayah < 1 ? 1 : ayah > count ? count : ayah | 0;
  return globalAyahBase[s - 1] + a - 1;
}

export function ayahAt(surah: number, ayah: number): Ayah {
  const g = globalAyahIndex(surah, ayah);
  return ayahByGlobal(g);
}

export function ayahByGlobal(globalIndex: number): Ayah {
  const g = globalIndex < 0 ? 0 : globalIndex >= TOTAL_AYAHS ? TOTAL_AYAHS - 1 : globalIndex | 0;
  // locate the surah by binary search over globalAyahBase
  let lo = 0;
  let hi = TOTAL_SURAHS - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (globalAyahBase[mid] <= g) lo = mid;
    else hi = mid - 1;
  }
  const row = DATA[lo];
  const [ayahNo, , page, juz, text] = row[5][g - globalAyahBase[lo]];
  return {
    surah: row[0],
    ayah: ayahNo,
    globalAyah: g,
    page,
    juz,
    text,
    wordStart: ayahStartWord[g],
    wordEnd: ayahStartWord[g + 1],
  };
}

/** Every ayah (or ayah fragment) that appears on a Madani page, in order. */
export function ayahsOnPage(page: number): Ayah[] {
  const [from, to] = pageWordRange(page);
  const out: Ayah[] = [];
  let g = globalAyahOf(from);
  while (g < TOTAL_AYAHS && ayahStartWord[g] < to) {
    out.push(ayahByGlobal(g));
    g++;
  }
  return out;
}

/** Surahs that begin on a given page — used to draw the surah header band. */
export function surahsStartingOnPage(page: number): SurahInfo[] {
  const [from, to] = pageWordRange(page);
  return surahs.filter((s) => surahStartWord[s.number - 1] >= from && surahStartWord[s.number - 1] < to);
}

/** Surah 1 and 9 are the exceptions: 1's basmala is ayah 1, 9 has none. */
export const surahHasBasmalaHeader = (surah: number): boolean => surah !== 1 && surah !== 9;

/**
 * Display tokens of one ayah, guaranteed 1:1 with the ayah's slice of the
 * global word array. The renderer paints per-word state by index, so this
 * invariant is load-bearing; `tokenizeAyah` is the same function the build-time
 * generator used, and __tests__/data.test.ts asserts the correspondence.
 */
export function ayahDisplayWords(a: Ayah): string[] {
  return tokenizeAyah(a.text).display;
}

/**
 * The first ayah of each juz, resolved once.
 *
 * Only a handful of juz begin at a surah boundary, so `surahs.find(s => s.juz
 * === n)` finds nothing for juz 2, 3, 5 ... and silently falls back to
 * Al-Fatiha. The juz jump has to be built from the ayah table.
 */
const JUZ_START: readonly { surah: number; ayah: number; page: number; word: number }[] = (() => {
  const out: { surah: number; ayah: number; page: number; word: number }[] = [];
  let g = 0;
  let seen = 0;
  for (const row of DATA) {
    for (const v of row[5]) {
      const juz = v[3];
      if (juz === seen + 1) {
        out.push({ surah: row[0], ayah: v[0], page: v[2], word: ayahStartWord[g] });
        seen = juz;
      }
      g++;
    }
  }
  if (out.length !== TOTAL_JUZ) {
    throw new Error(`built ${out.length} juz starts, expected ${TOTAL_JUZ}`);
  }
  return out;
})();

const clampJuz = (jz: number): number => (jz < 1 ? 1 : jz > TOTAL_JUZ ? TOTAL_JUZ : jz | 0);

export const juzStart = (jz: number): { surah: number; ayah: number; page: number; word: number } =>
  JUZ_START[clampJuz(jz) - 1];

export const juzStartPage = (jz: number): number => juzStart(jz).page;
