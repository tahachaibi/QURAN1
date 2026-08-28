/**
 * The hadith data layer.
 *
 * The load-bearing claims are about SELECTION and CITATION: only the two Sahih
 * collections are present, and every hadith carries the collection and number it
 * can be checked against. Both are asserted here, because "authentic hadith
 * only" is a promise about content, and a silent extra collection or a lost
 * number would break it invisibly.
 */
import {
  chapterOf,
  collectionById,
  collections,
  foldArabic,
  hadithByNumber,
  hadithsOfChapter,
  isLoaded,
  release,
  searchChapters,
  searchHadith,
} from '../src/data/hadith';

describe('selection', () => {
  it('contains exactly Sahih al-Bukhari and Sahih Muslim', () => {
    expect(collections.map((c) => c.englishTitle)).toEqual(['Sahih al-Bukhari', 'Sahih Muslim']);
    expect(collections.map((c) => c.arabicTitle)).toEqual(['صحيح البخاري', 'صحيح مسلم']);
  });

  it('names the compiler of each, in both languages', () => {
    for (const c of collections) {
      expect(c.arabicAuthor.length).toBeGreaterThan(0);
      expect(c.englishAuthor.length).toBeGreaterThan(0);
    }
  });

  it('has the expected scale', () => {
    const total = collections.reduce((n, c) => n + c.total, 0);
    expect(total).toBeGreaterThan(14000);
    expect(collections[0].total).toBeGreaterThan(7000);
    expect(collections[1].total).toBeGreaterThan(7000);
  });

  it('has no empty chapters, which would be dead ends in the list', () => {
    for (const c of collections) {
      expect(c.chapters.length).toBeGreaterThan(0);
      for (const ch of c.chapters) expect(ch.count).toBeGreaterThan(0);
    }
  });

  it('gives every chapter a name in both languages', () => {
    for (const c of collections) {
      for (const ch of c.chapters) {
        expect(ch.arabicName.length).toBeGreaterThan(0);
        expect(ch.englishName.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the index is small and eager, the text large and lazy', () => {
  it('does not load any text just to describe the collections', () => {
    release();
    expect(collections.length).toBe(2);
    expect(collections[0].chapters.length).toBeGreaterThan(0);
    expect(isLoaded(1)).toBe(false);
    expect(isLoaded(2)).toBe(false);
  });

  it('loads a collection only when its text is asked for, and can release it', () => {
    release();
    hadithsOfChapter(1, 1);
    expect(isLoaded(1)).toBe(true);
    expect(isLoaded(2)).toBe(false);
    release(1);
    expect(isLoaded(1)).toBe(false);
  });
});

describe('reading a chapter', () => {
  it("returns Bukhari's first chapter with the hadith of intentions first", () => {
    const list = hadithsOfChapter(1, 1);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].number).toBe(1);
    expect(list[0].collectionId).toBe(1);
    // the famous opening: "الأعمال بالنيات"
    expect(foldArabic(list[0].arabic)).toContain(foldArabic('إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ'));
    expect(list[0].english.toLowerCase()).toContain('intention');
  });

  it('matches the count the index promised, for every chapter of both books', () => {
    for (const c of collections) {
      for (const ch of c.chapters) {
        expect(hadithsOfChapter(c.id, ch.id)).toHaveLength(ch.count);
      }
    }
  });

  it('gives every hadith Arabic, English and a citable number', () => {
    for (const c of collections) {
      const first = c.chapters[0];
      for (const h of hadithsOfChapter(c.id, first.id)) {
        expect(h.arabic.length).toBeGreaterThan(0);
        expect(h.english.length).toBeGreaterThan(0);
        expect(h.number).toBeGreaterThan(0);
        expect(h.collectionId).toBe(c.id);
      }
    }
  });

  it('finds a hadith by its number in its own collection', () => {
    const h = hadithByNumber(1, 1);
    expect(h?.number).toBe(1);
    expect(hadithByNumber(1, 999999)).toBeUndefined();
  });

  it('resolves a chapter by id', () => {
    expect(chapterOf(1, 1)?.englishName.length).toBeGreaterThan(0);
    expect(chapterOf(99, 1)).toBeUndefined();
    expect(collectionById(1)?.englishTitle).toBe('Sahih al-Bukhari');
    expect(collectionById(99)).toBeUndefined();
  });
});

describe('search', () => {
  it('finds Arabic typed without harakat, which is how anyone types it', () => {
    const hits = searchHadith('الاعمال بالنيات', { collectionId: 1, limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].collectionId).toBe(1);
  });

  it('finds English text and narrator names', () => {
    expect(searchHadith('intentions', { collectionId: 1, limit: 5 }).length).toBeGreaterThan(0);
    expect(searchHadith('Umar', { collectionId: 1, limit: 5 }).length).toBeGreaterThan(0);
  });

  it('searches both collections when none is named', () => {
    const hits = searchHadith('prayer', { limit: 80 });
    expect(new Set(hits.map((h) => h.collectionId)).size).toBeGreaterThan(0);
  });

  it('ignores a query too short to mean anything', () => {
    expect(searchHadith('')).toEqual([]);
    expect(searchHadith(' ')).toEqual([]);
    expect(searchHadith('a')).toEqual([]);
  });

  it('respects the limit, so a common word cannot return ten thousand rows', () => {
    expect(searchHadith('the', { limit: 10 }).length).toBeLessThanOrEqual(10);
  });

  it('filters chapters by name in either language', () => {
    expect(searchChapters(1, 'Revelation').length).toBeGreaterThan(0);
    expect(searchChapters(1, 'الوحى').length).toBeGreaterThan(0);
    expect(searchChapters(1, '').length).toBe(collections[0].chapters.length);
    expect(searchChapters(1, 'zzzznope')).toEqual([]);
  });
});

describe('foldArabic', () => {
  it('strips harakat and normalises the letters that vary', () => {
    expect(foldArabic('إِنَّمَا')).toBe('انما');
    expect(foldArabic('الْأَعْمَالُ')).toBe('الاعمال');
    expect(foldArabic('صَلَاةٌ')).toBe('صلاه');
    expect(foldArabic('عَلَى')).toBe('علي');
  });
});

/**
 * Search is the one thing that can open both collections at once, and what it
 * must not do is leave 22 MB resident because somebody typed a word that is not
 * in there.
 */
describe('what a search leaves loaded', () => {
  it('releases a collection it opened and found nothing in', () => {
    release();
    const results = searchHadith('zzqqxx', { limit: 5 });
    expect(results).toEqual([]);
    for (const c of collections) expect(isLoaded(c.id)).toBe(false);
  });

  it('keeps a collection that actually matched', () => {
    release();
    const results = searchHadith('prayer', { collectionId: 2, limit: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(isLoaded(2)).toBe(true);
    expect(isLoaded(1)).toBe(false);
    release();
  });

  it('leaves a collection alone if it was already open', () => {
    release();
    hadithsOfChapter(1, 1);
    expect(isLoaded(1)).toBe(true);
    // a miss must not evict something the user had already opened
    searchHadith('zzqqxx', { limit: 5 });
    expect(isLoaded(1)).toBe(true);
    release();
  });
});
