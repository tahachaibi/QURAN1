/**
 * The adhkar, and the one property that matters more than any other: that no
 * Arabic on that screen was written by this app.
 *
 * A du'a app that paraphrases teaches a du'a nobody said. So every line is
 * asserted to be a literal slice of a hadith bundled here, or the bundled mushaf
 * text of the ayah it claims to be. If a future edit types a word by hand,
 * however carefully, these tests fail.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  adhkarCount,
  adhkarFor,
  defaultTime,
  type Dhikr,
  type HadithSource,
} from '../src/data/adhkar';
import { collectionById, hadithByNumber } from '../src/data/hadith';
import { ayahAt } from '../src/data/quran';

/** The generator strips bidi controls and collapses runs of whitespace. */
const BIDI = /[‎‏؜]/g;
const normalize = (value: string): string => value.replace(BIDI, '').replace(/\s+/g, ' ').trim();

const ALL = [...adhkarFor('morning'), ...adhkarFor('evening')];

/**
 * The hadith-sliced entries, read straight from what gen-adhkar.mjs produced.
 *
 * They are no longer what the screen shows — the supplied pages replaced them —
 * but they are still what the citations on the supplied items are matched
 * against, so their verbatim property still has to hold.
 */
const SLICED: Dhikr[] = (
  JSON.parse(readFileSync(join(__dirname, '../src/assets/adhkar.json'), 'utf8')) as {
    adhkar: {
      id: string;
      repeat: number;
      titleEn: string;
      note: string | null;
      lines: string[];
      hadith: Omit<HadithSource, 'kind'>;
    }[];
  }
).adhkar.map((entry) => ({
  id: entry.id,
  repeat: entry.repeat,
  titleAr: null,
  titleEn: entry.titleEn,
  note: entry.note,
  lines: entry.lines,
  source: { kind: 'hadith', ...entry.hadith },
}));

describe('adhkar', () => {
  it('has both a morning and an evening set', () => {
    expect(adhkarCount('morning')).toBeGreaterThanOrEqual(6);
    expect(adhkarCount('evening')).toBeGreaterThanOrEqual(6);
  });

  it('opens the morning set before noon and the evening set after', () => {
    expect(defaultTime(new Date(2026, 7, 26, 6, 0))).toBe('morning');
    expect(defaultTime(new Date(2026, 7, 26, 11, 59))).toBe('morning');
    expect(defaultTime(new Date(2026, 7, 26, 12, 0))).toBe('evening');
    expect(defaultTime(new Date(2026, 7, 26, 21, 0))).toBe('evening');
  });

  it('gives every dhikr an id, a repeat count and at least one line', () => {
    for (const dhikr of ALL) {
      expect(dhikr.id).toMatch(/^[a-z0-9-]+$/);
      expect(dhikr.repeat).toBeGreaterThan(0);
      expect(dhikr.lines.length).toBeGreaterThan(0);
      for (const line of dhikr.lines) expect(line.trim().length).toBeGreaterThan(10);
    }
  });

  it('has no duplicate ids within a set', () => {
    for (const time of ['morning', 'evening'] as const) {
      const ids = adhkarFor(time).map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  /**
   * The whole point. Every du'a line must appear, character for character, inside
   * the narration it cites.
   */
  /**
   * Scoped to the hadith-SLICED entries, which are cut out of a narration and so
   * must appear inside it character for character.
   *
   * It deliberately does not cover the supplied-page entries: those show the
   * wording as supplied and carry a hadith citation only where the generator
   * could match them with confidence, so their text is close to the narration
   * rather than a slice of it. The card shows both, and the screen says so.
   */
  it('quotes every sliced du\'a verbatim from the hadith it cites', () => {
    const duas = SLICED.filter((d) => d.source.kind === 'hadith');
    expect(duas.length).toBeGreaterThanOrEqual(6);

    for (const dhikr of duas) {
      const source = dhikr.source as Extract<typeof dhikr.source, { kind: 'hadith' }>;
      const haystack = normalize(source.arabic);
      for (const line of dhikr.lines) {
        expect(haystack).toContain(normalize(line));
      }
    }
  });

  /** ...and the narration it cites must be the one actually in the collection. */
  it('cites a hadith that exists, with the text the collection holds', () => {
    for (const dhikr of SLICED) {
      if (dhikr.source.kind !== 'hadith') continue;
      expect(collectionById(dhikr.source.collection)).toBeDefined();
      const real = hadithByNumber(dhikr.source.collection, dhikr.source.number);
      expect(real).toBeDefined();
      expect(normalize((real as { arabic: string }).arabic)).toBe(normalize(dhikr.source.arabic));
    }
  });

  it('never lets a chain of narration leak into a du\'a', () => {
    for (const dhikr of ALL) {
      for (const line of dhikr.lines) {
        expect(line).not.toMatch(/حَدَّثَنَا|أَخْبَرَنَا|حَدَّثَنِي|عَنْ أَبِي هُرَيْرَةَ/);
        expect(line).not.toContain('"');
      }
    }
  });

  /** The Qur'an passages are the bundled mushaf text, not a second copy. */
  it('takes Qur\'an passages from the bundled mushaf text', () => {
    // ALL is morning + evening, and the Qur'an passages are in both sets.
    const quran = ALL.filter((d) => d.source.kind === 'quran');
    expect(quran).toHaveLength(8);
    expect(adhkarFor('morning').filter((d) => d.source.kind === 'quran')).toHaveLength(4);

    for (const dhikr of quran) {
      const source = dhikr.source as Extract<typeof dhikr.source, { kind: 'quran' }>;
      const expected = source.toAyah - source.fromAyah + 1;
      expect(dhikr.lines).toHaveLength(expected);
      dhikr.lines.forEach((line, i) => {
        expect(line).toBe(ayahAt(source.surah, source.fromAyah + i).text);
      });
      expect(source.reference).toContain(String(source.surah));
    }
  });

  it('includes the four Qur\'an passages in both sets', () => {
    for (const time of ['morning', 'evening'] as const) {
      const ids = adhkarFor(time).map((d) => d.id);
      for (const id of ['ayat-al-kursi', 'al-ikhlas', 'al-falaq', 'an-nas']) {
        expect(ids).toContain(id);
      }
    }
  });

  /**
   * Morning and evening are not the same list, and the words that distinguish
   * them are the test: أصبحنا belongs to one end of the day and أمسينا to the
   * other, and swapping them would be a silent, embarrassing wrong.
   */
  it('keeps the morning and evening wordings apart', () => {
    const morning = adhkarFor('morning')
      .flatMap((d) => d.lines)
      .join(' ');
    const evening = adhkarFor('evening')
      .flatMap((d) => d.lines)
      .join(' ');

    expect(morning).toContain('أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ');
    expect(morning).not.toContain('أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ');
    expect(evening).toContain('أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ');
    expect(evening).not.toContain('أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ');
  });

  it('keeps the Qur\'an repeat counts as the sunnah gives them', () => {
    const morning = adhkarFor('morning');
    expect(morning.find((d) => d.id === 'al-ikhlas')?.repeat).toBe(3);
    expect(morning.find((d) => d.id === 'ayat-al-kursi')?.repeat).toBe(1);
  });
});

/**
 * The supplied adhkar pages.
 *
 * The one property that matters: every line on screen appears, character for
 * character, in data/adhkar-supplied.txt. The generator splits, classifies and
 * copies — it must never reword, never add tashkeel, never fill a gap.
 */
describe('the supplied pages', () => {
  const supplied = readFileSync(join(__dirname, '../data/adhkar-supplied.txt'), 'utf8');
  const fromPages = (time: 'morning' | 'evening') =>
    adhkarFor(time).filter((d) => d.source.kind !== 'quran');

  it('serves the supplied list, not the older hadith-only one', () => {
    expect(fromPages('morning').length).toBeGreaterThanOrEqual(12);
    expect(fromPages('evening').length).toBeGreaterThanOrEqual(12);
  });

  it('quotes every line verbatim from the supplied text', () => {
    for (const time of ['morning', 'evening'] as const) {
      for (const dhikr of fromPages(time)) {
        for (const line of dhikr.lines) {
          // the generator joins wrapped lines with a single space, so compare
          // against the supplied text with its own whitespace collapsed
          expect(supplied.replace(/\s+/g, ' ')).toContain(line);
        }
      }
    }
  });

  it('carries an Arabic title for every supplied item', () => {
    for (const time of ['morning', 'evening'] as const) {
      for (const dhikr of fromPages(time)) {
        expect(dhikr.titleAr).not.toBeNull();
        expect((dhikr.titleAr as string).length).toBeGreaterThan(2);
      }
    }
  });

  it('keeps no count restatement in a note', () => {
    // "4 مرات." under a du'a already marked x4 is noise, and it leaked once.
    for (const time of ['morning', 'evening'] as const) {
      for (const dhikr of fromPages(time)) {
        if (dhikr.note === null) continue;
        expect(dhikr.note).not.toMatch(/^\s*\d{1,3}\s*(مرات|مرة)\s*\.?\s*$/);
      }
    }
  });

  it('reads the repeat counts off the supplied titles', () => {
    const morning = fromPages('morning');
    expect(morning.find((d) => d.lines[0].includes('سُبْحَانَ اللَّهِ وَبِحَمْدِهِ'))?.repeat).toBe(100);
    expect(morning.find((d) => d.lines[0].includes('حَسْبِيَ اللَّهُ'))?.repeat).toBe(7);
    expect(morning.find((d) => d.lines[0].includes('رَضِيتُ بِاللَّهِ'))?.repeat).toBe(3);
    expect(morning.find((d) => d.lines[0].includes('أُشْهِدُكَ'))?.repeat).toBe(4);
  });

  it('still renders the four Qur\'an passages from the mushaf, not from the paste', () => {
    // The supplied Ayat al-Kursi is truncated with an ellipsis; a partial ayah
    // must never reach the screen.
    for (const time of ['morning', 'evening'] as const) {
      const quran = adhkarFor(time).filter((d) => d.source.kind === 'quran');
      expect(quran).toHaveLength(4);
      for (const dhikr of quran) {
        for (const line of dhikr.lines) expect(line).not.toContain('...');
      }
    }
  });

  it('cites a hadith only where the app can prove one', () => {
    const all = [...adhkarFor('morning'), ...adhkarFor('evening')];
    for (const dhikr of all) {
      if (dhikr.source.kind !== 'hadith') continue;
      const real = hadithByNumber(dhikr.source.collection, dhikr.source.number);
      expect(real).toBeDefined();
    }
    // and the ones it cannot prove name the page instead of inventing a number
    expect(all.some((d) => d.source.kind === 'page')).toBe(true);
  });
});
