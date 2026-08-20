/**
 * The imported Madani line layout.
 *
 * The load-bearing property is that decoding reconstructs EXACTLY the tokens the
 * printed page carries: every word of the Quran once, on one line, plus one
 * end-marker per ayah. A decoder that quietly drops or duplicates a token gives
 * pages that look right and are not, which is the whole failure mode this import
 * was built to avoid.
 */
import {
  LAYOUT_NAME,
  LINES_PER_PAGE,
  linesOfPage,
  tokenCountOfPage,
} from '../src/data/lines';
import {
  ayahAt,
  pageWordRange,
  TOTAL_AYAHS,
  TOTAL_PAGES,
  TOTAL_WORDS,
  words,
} from '../src/data/quran';

describe('the imported layout', () => {
  it('is the QCF V2 1421H print, 15 lines to a page', () => {
    expect(LAYOUT_NAME).toContain('V2');
    expect(LINES_PER_PAGE).toBe(15);
  });

  it('never exceeds 15 lines on any page', () => {
    for (let p = 1; p <= TOTAL_PAGES; p++) {
      expect(linesOfPage(p).length).toBeLessThanOrEqual(LINES_PER_PAGE);
      expect(linesOfPage(p).length).toBeGreaterThan(0);
    }
  });

  it('places every word of the Quran exactly once, on exactly one line', () => {
    const seen = new Uint8Array(TOTAL_WORDS);
    let markers = 0;
    for (let p = 1; p <= TOTAL_PAGES; p++) {
      for (const line of linesOfPage(p)) {
        for (const token of line.tokens) {
          if (token.kind === 'word') seen[token.index]++;
          else markers++;
        }
      }
    }
    const missing: number[] = [];
    const duplicated: number[] = [];
    for (let i = 0; i < TOTAL_WORDS; i++) {
      if (seen[i] === 0) missing.push(i);
      if (seen[i] > 1) duplicated.push(i);
    }
    expect({ missing: missing.slice(0, 5), duplicated: duplicated.slice(0, 5) }).toEqual({
      missing: [],
      duplicated: [],
    });
    // one end marker per ayah, no more and no fewer
    expect(markers).toBe(TOTAL_AYAHS);
  });

  it('reconstructs the whole QUL id space', () => {
    let total = 0;
    for (let p = 1; p <= TOTAL_PAGES; p++) total += tokenCountOfPage(p);
    expect(total).toBe(TOTAL_WORDS + TOTAL_AYAHS);
  });

  it('keeps each page’s words inside that page’s word range', () => {
    for (let p = 1; p <= TOTAL_PAGES; p++) {
      const [from, to] = pageWordRange(p);
      for (const line of linesOfPage(p)) {
        for (const token of line.tokens) {
          if (token.kind !== 'word') continue;
          expect(token.index).toBeGreaterThanOrEqual(from);
          expect(token.index).toBeLessThan(to);
        }
      }
    }
  });

  it('keeps words in reading order within and across lines', () => {
    for (let p = 1; p <= TOTAL_PAGES; p++) {
      let previous = -1;
      for (const line of linesOfPage(p)) {
        for (const token of line.tokens) {
          if (token.kind !== 'word') continue;
          expect(token.index).toBeGreaterThan(previous);
          previous = token.index;
        }
      }
    }
  });

  it('renders Al-Fatiha as the printed page does: a band then seven lines', () => {
    const page = linesOfPage(1);
    expect(page[0].kind).toBe('surah');
    expect(page[0].surah).toBe(1);
    const ayahLines = page.filter((l) => l.kind === 'ayah');
    expect(ayahLines).toHaveLength(7);
    // the first line is 1:1 complete, with its end marker
    const first = ayahLines[0].tokens;
    expect(first.filter((t) => t.kind === 'word')).toHaveLength(4);
    expect(first[first.length - 1]).toEqual({ kind: 'marker', ayah: 1 });
  });

  it('gives a new surah a band, and a basmala everywhere except surah 9', () => {
    const page2 = linesOfPage(2);
    expect(page2.some((l) => l.kind === 'surah' && l.surah === 2)).toBe(true);
    expect(page2.some((l) => l.kind === 'basmala')).toBe(true);

    const page = ayahAt(9, 1).page;
    const surah9 = linesOfPage(page);
    const bandIndex = surah9.findIndex((l) => l.kind === 'surah' && l.surah === 9);
    expect(bandIndex).toBeGreaterThanOrEqual(0);
    // At-Tawbah has no basmala: the line after its band is text
    expect(surah9[bandIndex + 1].kind).toBe('ayah');
  });

  it('gives every surah exactly one band', () => {
    const bandPage = new Map<number, number>();
    for (let p = 1; p <= TOTAL_PAGES; p++) {
      for (const line of linesOfPage(p)) {
        if (line.kind !== 'surah') continue;
        expect(bandPage.has(line.surah)).toBe(false);
        bandPage.set(line.surah, p);
      }
    }
    expect(bandPage.size).toBe(114);
  });

  it('allows a band to sit as the last line of the previous page', () => {
    // A real feature of the Madani print: for 18 surahs the band closes one page
    // and the text begins overleaf. A computed layout can never produce this,
    // which is most of the reason for importing the real one.
    const bandPage = new Map<number, number>();
    for (let p = 1; p <= TOTAL_PAGES; p++) {
      for (const line of linesOfPage(p)) if (line.kind === 'surah') bandPage.set(line.surah, p);
    }
    const overleaf: number[] = [];
    for (let s = 1; s <= 114; s++) {
      const band = bandPage.get(s) as number;
      const firstAyah = ayahAt(s, 1).page;
      expect(band === firstAyah || band === firstAyah - 1).toBe(true);
      if (band !== firstAyah) overleaf.push(s);
    }
    expect(overleaf).toEqual([4, 10, 22, 23, 24, 26, 27, 32, 33, 37, 38, 45, 47, 53, 60, 64, 65, 80]);
  });

  it('marks every word token with a real word', () => {
    const sample = [1, 2, 3, 49, 262, 293, 440, 482, 604];
    for (const p of sample) {
      for (const line of linesOfPage(p)) {
        for (const token of line.tokens) {
          if (token.kind !== 'word') continue;
          expect(typeof words[token.index]).toBe('string');
          expect(words[token.index].length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('caches: the same page returns the same array', () => {
    expect(linesOfPage(42)).toBe(linesOfPage(42));
  });
});
