/**
 * Bundled-data invariants (spec §2, §3).
 *
 * The load-bearing one is the LAST test: display tokens must correspond 1:1 with
 * global word indices, because the renderer paints per-word state by index. When
 * the recognizer-side article-collapse was (wrongly) applied to the canonical
 * text, `ءَالِ` normalized to `ال` and swallowed the following word in 23 ayahs,
 * silently shifting every subsequent word on those pages.
 */
import {
  ayahAt,
  ayahByGlobal,
  ayahDisplayWords,
  ayahsOnPage,
  ayahStartWord,
  ayahWordRange,
  globalAyahOf,
  juzStart,
  pageOf,
  pageStartWord,
  pageWordRange,
  surahOf,
  surahs,
  surahStartWord,
  surahWordRange,
  TOTAL_AYAHS,
  TOTAL_PAGES,
  TOTAL_SURAHS,
  TOTAL_WORDS,
  wordIndexOf,
  wordInAyahOf,
  wordMeta,
  words,
} from '../src/data/quran';
import { normalizeAyah } from '../src/engine/normalize';

describe('the flat word array (§2)', () => {
  it('has the classical word count and matching offset tables', () => {
    expect(words.length).toBe(TOTAL_WORDS);
    expect(TOTAL_WORDS).toBe(77429);
    expect(ayahStartWord.length).toBe(TOTAL_AYAHS + 1);
    expect(pageStartWord.length).toBe(TOTAL_PAGES + 1);
    expect(surahStartWord.length).toBe(TOTAL_SURAHS + 1);
  });

  it('has no empty words', () => {
    expect(words.filter((w) => w.length === 0)).toEqual([]);
  });

  it('partitions the array by page with no gaps or overlaps', () => {
    let expected = 0;
    for (let page = 1; page <= TOTAL_PAGES; page++) {
      const [from, to] = pageWordRange(page);
      expect(from).toBe(expected);
      expect(to).toBeGreaterThan(from);
      expected = to;
    }
    expect(expected).toBe(TOTAL_WORDS);
  });

  it('partitions the array by surah with no gaps or overlaps', () => {
    let expected = 0;
    for (let surah = 1; surah <= TOTAL_SURAHS; surah++) {
      const [from, to] = surahWordRange(surah);
      expect(from).toBe(expected);
      expect(to).toBeGreaterThan(from);
      expected = to;
    }
    expect(expected).toBe(TOTAL_WORDS);
  });

  it('agrees with itself on every lookup direction', () => {
    for (const surah of [1, 2, 18, 36, 55, 112, 114]) {
      for (const ayah of [1, 2, surahs[surah - 1].totalVerses]) {
        const index = wordIndexOf(surah, ayah);
        expect(surahOf(index)).toBe(surah);
        expect(wordInAyahOf(index)).toBe(0);
        expect(ayahByGlobal(globalAyahOf(index)).ayah).toBe(ayah);
        expect(pageOf(index)).toBe(ayahAt(surah, ayah).page);
        const meta = wordMeta(index);
        expect(meta).toEqual({ surah, ayah, wordInAyah: 0, page: ayahAt(surah, ayah).page });
      }
    }
  });

  it('crosses every surah boundary by plain increment (§2)', () => {
    for (let surah = 1; surah < TOTAL_SURAHS; surah++) {
      const [, end] = surahWordRange(surah);
      expect(surahOf(end - 1)).toBe(surah);
      expect(surahOf(end)).toBe(surah + 1);
    }
  });
});

describe('page composition', () => {
  it('lists ayahs for every page, in order, covering the page', () => {
    for (const page of [1, 2, 3, 49, 293, 440, 604]) {
      const [from, to] = pageWordRange(page);
      const ayahs = ayahsOnPage(page);
      expect(ayahs.length).toBeGreaterThan(0);
      expect(ayahs[0].wordStart).toBeLessThanOrEqual(from);
      expect(ayahs[ayahs.length - 1].wordEnd).toBeGreaterThanOrEqual(to);
      for (let i = 1; i < ayahs.length; i++) {
        expect(ayahs[i].globalAyah).toBe(ayahs[i - 1].globalAyah + 1);
      }
    }
  });

  it('places Al-Fatiha wholly on page 1 and An-Nas wholly on page 604', () => {
    expect(ayahsOnPage(1).map((a) => `${a.surah}:${a.ayah}`)).toEqual([
      '1:1',
      '1:2',
      '1:3',
      '1:4',
      '1:5',
      '1:6',
      '1:7',
    ]);
    expect(ayahsOnPage(604).some((a) => a.surah === 114 && a.ayah === 6)).toBe(true);
  });
});

describe('display tokens correspond 1:1 with word indices (load-bearing)', () => {
  it('holds for every ayah in the Quran', () => {
    const offenders: string[] = [];
    for (let g = 0; g < TOTAL_AYAHS; g++) {
      const ayah = ayahByGlobal(g);
      const display = ayahDisplayWords(ayah);
      const expected = ayah.wordEnd - ayah.wordStart;
      if (display.length !== expected) {
        offenders.push(`${ayah.surah}:${ayah.ayah} display=${display.length} words=${expected}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('normalizes each display token back to the word at that index', () => {
    // spot-check the ayahs that broke when the canonical tokenizer fused ال
    for (const [surah, ayah] of [
      [2, 49],
      [2, 50],
      [2, 72],
      [2, 248],
      [3, 11],
      [8, 54],
      [12, 6],
      [14, 6],
      [1, 1],
      [114, 6],
    ] as [number, number][]) {
      const a = ayahAt(surah, ayah);
      const [from, to] = ayahWordRange(surah, ayah);
      const normalized = normalizeAyah(a.text);
      expect(normalized).toEqual(words.slice(from, to));
      expect(ayahDisplayWords(a)).toHaveLength(to - from);
    }
  });
});

describe('juz jump targets', () => {
  it('resolves all 30 juz starts, monotonically, to the right ayah', () => {
    let previousWord = -1;
    for (let juz = 1; juz <= 30; juz++) {
      const start = juzStart(juz);
      expect(start.word).toBeGreaterThan(previousWord);
      previousWord = start.word;
      // the ayah it names really is the first ayah of that juz
      expect(ayahAt(start.surah, start.ayah).juz).toBe(juz);
      expect(ayahAt(start.surah, start.ayah).page).toBe(start.page);
      expect(wordIndexOf(start.surah, start.ayah)).toBe(start.word);
    }
  });

  it('matches the juz boundaries every mushaf prints', () => {
    // hand-checked against a printed mushaf, not read back from the generator
    const expected: [number, number, number][] = [
      [1, 1, 1],
      [2, 2, 142],
      [3, 2, 253],
      [4, 3, 93],
      [11, 9, 93], // 9:93, not the commonly-misremembered 9:94
      [16, 18, 75],
      [22, 33, 31],
      [30, 78, 1],
    ];
    for (const [juz, surah, ayah] of expected) {
      expect({ juz, ...pick(juzStart(juz)) }).toEqual({ juz, surah, ayah });
    }
  });
});

const pick = (s: { surah: number; ayah: number }): { surah: number; ayah: number } => ({
  surah: s.surah,
  ayah: s.ayah,
});
