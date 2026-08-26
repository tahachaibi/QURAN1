/**
 * The adhkar, and the one property that matters more than any other: that no
 * Arabic on that screen was written by this app.
 *
 * A du'a app that paraphrases teaches a du'a nobody said. So every line is
 * asserted to be a literal slice of a hadith bundled here, or the bundled mushaf
 * text of the ayah it claims to be. If a future edit types a word by hand,
 * however carefully, these tests fail.
 */
import { adhkarCount, adhkarFor, defaultTime } from '../src/data/adhkar';
import { collectionById, hadithByNumber } from '../src/data/hadith';
import { ayahAt } from '../src/data/quran';

/** The generator strips bidi controls and collapses runs of whitespace. */
const BIDI = /[‎‏؜]/g;
const normalize = (value: string): string => value.replace(BIDI, '').replace(/\s+/g, ' ').trim();

const ALL = [...adhkarFor('morning'), ...adhkarFor('evening')];

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
  it('quotes every du\'a verbatim from the hadith it cites', () => {
    const duas = ALL.filter((d) => d.source.kind === 'hadith');
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
    for (const dhikr of ALL) {
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

  it('includes the four Qur\'an passages and the well-known du\'as', () => {
    const morning = adhkarFor('morning').map((d) => d.id);
    const evening = adhkarFor('evening').map((d) => d.id);
    for (const id of ['ayat-al-kursi', 'al-ikhlas', 'al-falaq', 'an-nas']) {
      expect(morning).toContain(id);
      expect(evening).toContain(id);
    }
    // said at both ends of the day
    for (const id of ['sayyid-al-istighfar', 'tawhid-hundred', 'kalimat-tammat']) {
      expect(morning).toContain(id);
      expect(evening).toContain(id);
    }
    // and the two that belong to one end only
    expect(morning).toContain('asbahna');
    expect(morning).not.toContain('amsayna');
    expect(evening).toContain('amsayna');
    expect(evening).not.toContain('asbahna');
  });

  it('keeps the hundred-times dhikr at a hundred', () => {
    const tawhid = adhkarFor('morning').find((d) => d.id === 'tawhid-hundred');
    expect(tawhid?.repeat).toBe(100);
    expect(adhkarFor('morning').find((d) => d.id === 'al-ikhlas')?.repeat).toBe(3);
  });
});
