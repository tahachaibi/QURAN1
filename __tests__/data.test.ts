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
  hizbOf,
  hizbStart,
  juzStart,
  pageOf,
  pageStartWord,
  pageWordRange,
  surahOf,
  surahs,
  surahStartWord,
  surahWordRange,
  TOTAL_AYAHS,
  TOTAL_HIZB,
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
    expect(TOTAL_WORDS).toBe(77432);
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

describe('source words split across a space are fused back together', () => {
  it('treats 2:72 فَٱدَّٰرَٰٔتُمۡ as one word, as every printed mushaf does', () => {
    // quran-json writes it as `فَٱدَّـٰرَ` + `ٰٔتُمۡ`, and the second piece
    // normalizes to an ordinary-looking `تم`, so without the fusion rule the
    // matcher expects two spoken words where there is one — and the word array
    // disagrees with the mushaf by a token, which is how a layout import ends up
    // one word out of step for everything that follows.
    const a = ayahAt(2, 72);
    const [from, to] = ayahWordRange(2, 72);
    expect(to - from).toBe(10);
    expect(ayahDisplayWords(a)).toHaveLength(10);
    expect(words.slice(from, to)).not.toContain('تم');
    expect(words.slice(from, to)).toContain('فادرتم');
  });

  it('never fuses a token that legitimately begins a word', () => {
    // the rule must only fire on tokens starting with a COMBINING mark
    expect(ayahDisplayWords(ayahAt(1, 1))).toHaveLength(4);
    expect(ayahDisplayWords(ayahAt(2, 255))).toHaveLength(50);
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

/**
 * The sixty hizb.
 *
 * The references were supplied by hand and could not be derived from anything the
 * app had, so the tests are the reason to believe them. The strongest one is not
 * a spot check: every odd hizb must land exactly on a juz start, and juz starts
 * come from the juz number stored on every ayah — a completely separate path
 * through the data. Thirty agreements is not something a mistyped list produces.
 */
describe('hizb', () => {
  it('has all sixty, strictly increasing from the first word of the Quran', () => {
    expect(TOTAL_HIZB).toBe(60);
    expect(hizbStart(1).word).toBe(0);
    for (let h = 2; h <= TOTAL_HIZB; h++) {
      expect(hizbStart(h).word).toBeGreaterThan(hizbStart(h - 1).word);
    }
  });

  it('starts every odd hizb exactly where the corresponding juz starts', () => {
    for (let juz = 1; juz <= 30; juz++) {
      const hizb = hizbStart(juz * 2 - 1);
      const start = juzStart(juz);
      expect({ surah: hizb.surah, ayah: hizb.ayah, word: hizb.word }).toEqual({
        surah: start.surah,
        ayah: start.ayah,
        word: start.word,
      });
    }
  });

  it('puts every even hizb strictly inside its juz', () => {
    for (let juz = 1; juz <= 30; juz++) {
      const half = hizbStart(juz * 2);
      expect(half.word).toBeGreaterThan(juzStart(juz).word);
      if (juz < 30) expect(half.word).toBeLessThan(juzStart(juz + 1).word);
    }
  });

  it('points at an ayah that exists, on the page that ayah is on', () => {
    for (let h = 1; h <= TOTAL_HIZB; h++) {
      const start = hizbStart(h);
      const ayah = ayahAt(start.surah, start.ayah);
      expect(ayah.text.length).toBeGreaterThan(0);
      expect(start.page).toBe(ayah.page);
      expect(wordIndexOf(start.surah, start.ayah)).toBe(start.word);
    }
  });

  it('spreads about ten mushaf pages to a hizb, as the print does', () => {
    // Not a boundary check — a shape check. Sixty hizb over 604 pages is ten
    // each, and a list with a transposed reference would not keep that shape.
    for (let h = 1; h <= TOTAL_HIZB; h++) {
      const expected = 1 + (h - 1) * 10;
      expect(Math.abs(hizbStart(h).page - expected)).toBeLessThanOrEqual(12);
    }
  });

  it('answers which hizb a word is in', () => {
    expect(hizbOf(0)).toBe(1);
    for (let h = 1; h <= TOTAL_HIZB; h++) {
      expect(hizbOf(hizbStart(h).word)).toBe(h);
      expect(hizbOf(hizbStart(h).word + 1)).toBe(h);
      if (h > 1) expect(hizbOf(hizbStart(h).word - 1)).toBe(h - 1);
    }
  });
});
