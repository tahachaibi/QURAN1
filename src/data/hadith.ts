/**
 * Hadith: all six books, Arabic with the English underneath.
 *
 * WHAT THE TWO GROUPS ARE, because the difference is not decoration. Bukhari and
 * Muslim are accepted by the scholarly tradition as authentic essentially in their
 * entirety, so showing them promises authenticity without this code grading a
 * narration — which is a scholar's work, not a program's. The four Sunan hold
 * sahih, hasan and da'if side by side, deliberately, and the dataset they come
 * from carries NO grading field: `grades` is null on all 19,441 of their rows.
 *
 * So `sahih` on a collection is the only claim this app makes, and it makes it at
 * the level of the book rather than the narration. Every hadith shows its
 * collection and its number, which is what lets anything here be checked against
 * a printed copy or a graded reference — the honest limit of what the data
 * supports.
 *
 * LOADING. The index — collections, chapter names, counts — is 26 KB and is
 * imported eagerly. The text is 48 MB and is `require`d lazily per collection:
 * Metro runs a module's factory on first require, so nothing is materialised
 * until someone actually opens a collection.
 */
import rawIndex from '../assets/hadith-index.json';

/** [chapterId, arabicName, englishName, count] */
type ChapterRow = [number, string, string, number];
/** [id, arTitle, enTitle, arAuthor, enAuthor, chapters] */
type CollectionRow = [number, string, string, string, string, ChapterRow[], number];
/** [chapterId, numberInBook, arabic, narrator, english] */
type HadithRow = [number, number, string, string, string];

const INDEX = (rawIndex as unknown as { collections: CollectionRow[] }).collections;

export interface HadithChapter {
  id: number;
  collectionId: number;
  arabicName: string;
  englishName: string;
  count: number;
}

export interface HadithCollection {
  /**
   * True for the two Sahihs, which the tradition accepts as authentic throughout.
   *
   * False for the four Sunan, which hold sahih, hasan and da'if side by side and
   * arrive here with no grading field at all. The UI uses this to avoid implying
   * a strength the data cannot support.
   */
  sahih: boolean;
  id: number;
  arabicTitle: string;
  englishTitle: string;
  arabicAuthor: string;
  englishAuthor: string;
  chapters: HadithChapter[];
  total: number;
}

export interface Hadith {
  collectionId: number;
  chapterId: number;
  /** its number within its own collection, for citation */
  number: number;
  arabic: string;
  narrator: string;
  english: string;
}

export const collections: readonly HadithCollection[] = INDEX.map((row) => {
  const chapters = row[5].map((c) => ({
    id: c[0],
    collectionId: row[0],
    arabicName: c[1],
    englishName: c[2],
    count: c[3],
  }));
  return {
    id: row[0],
    sahih: row[6] === 1,
    arabicTitle: row[1],
    englishTitle: row[2],
    arabicAuthor: row[3],
    englishAuthor: row[4],
    chapters,
    total: chapters.reduce((n, c) => n + c.count, 0),
  };
});

export const collectionById = (id: number): HadithCollection | undefined =>
  collections.find((c) => c.id === id);

export const chapterOf = (collectionId: number, chapterId: number): HadithChapter | undefined =>
  collectionById(collectionId)?.chapters.find((c) => c.id === chapterId);

// ---------------------------------------------------------------------------
// lazy text
// ---------------------------------------------------------------------------

const loaded = new Map<number, HadithRow[]>();

/**
 * Load one collection's text. The require is inside the function on purpose:
 * at module scope it would pull 22 MB into memory on app start.
 */
function rowsOf(collectionId: number): HadithRow[] {
  const cached = loaded.get(collectionId);
  if (cached !== undefined) return cached;
  let rows: HadithRow[];
  /**
   * A switch of literal requires, not a template path.
   *
   * Metro resolves require() at build time, so `require(\`../assets/hadith-${id}.json\`)`
   * would resolve to nothing at all. Each file has to be named.
   */
  switch (collectionId) {
    case 1:
      rows = require('../assets/hadith-1.json') as HadithRow[];
      break;
    case 2:
      rows = require('../assets/hadith-2.json') as HadithRow[];
      break;
    case 3:
      rows = require('../assets/hadith-3.json') as HadithRow[];
      break;
    case 4:
      rows = require('../assets/hadith-4.json') as HadithRow[];
      break;
    case 5:
      rows = require('../assets/hadith-5.json') as HadithRow[];
      break;
    case 6:
      rows = require('../assets/hadith-6.json') as HadithRow[];
      break;
    default:
      return [];
  }
  loaded.set(collectionId, rows);
  return rows;
}

/** Free a collection's text. Reading two whole collections at once is 22 MB. */
export function release(collectionId?: number): void {
  if (collectionId === undefined) loaded.clear();
  else loaded.delete(collectionId);
}

export const isLoaded = (collectionId: number): boolean => loaded.has(collectionId);

const toHadith = (collectionId: number, row: HadithRow): Hadith => ({
  collectionId,
  chapterId: row[0],
  number: row[1],
  arabic: row[2],
  narrator: row[3],
  english: row[4],
});

/** Every hadith of one chapter, in the collection's own order. */
export function hadithsOfChapter(collectionId: number, chapterId: number): Hadith[] {
  return rowsOf(collectionId)
    .filter((row) => row[0] === chapterId)
    .map((row) => toHadith(collectionId, row));
}

export function hadithByNumber(collectionId: number, number: number): Hadith | undefined {
  const row = rowsOf(collectionId).find((r) => r[1] === number);
  return row === undefined ? undefined : toHadith(collectionId, row);
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

/**
 * Fold Arabic so a search types like a search: strip the harakat the text is
 * full of and the reader will not type, and normalise the letters that vary in
 * spelling. Reuses the same idea as the recitation matcher, deliberately kept
 * simple — this is a text filter, not the aligner.
 */
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
export function foldArabic(value: string): string {
  return value
    .replace(MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ء/g, '');
}

export interface HadithSearchOptions {
  /** limit to one collection; omit to search both */
  collectionId?: number;
  limit?: number;
}

/**
 * Substring search over the Arabic and the English.
 *
 * Deliberately a scan rather than an index: it runs over one collection at a
 * time, only when the user has typed something, and the alternative — an
 * inverted index over 22 MB — is a second bundled asset for a feature nobody
 * uses at 60 fps.
 */
export function searchHadith(query: string, options: HadithSearchOptions = {}): Hadith[] {
  const raw = query.trim();
  if (raw.length < 2) return [];
  const limit = options.limit ?? 60;
  const arabicNeedle = foldArabic(raw);
  const englishNeedle = raw.toLowerCase();
  const ids =
    options.collectionId === undefined ? collections.map((c) => c.id) : [options.collectionId];

  const out: Hadith[] = [];
  /**
   * Searching every book means opening every book, and there are 48 MB of them.
   *
   * A common word stops at the limit and only ever touches the first collection.
   * A rare one walks all six — and without this, all six would then stay resident
   * for the rest of the session because one search asked a question of them. So
   * anything opened BY this search and found to contain nothing is released
   * again. Results keep the strings they matched; it is the row arrays that go.
   */
  const openedHere: number[] = [];
  const contributed = new Set<number>();

  try {
    for (const id of ids) {
      if (!isLoaded(id)) openedHere.push(id);
      for (const row of rowsOf(id)) {
        if (
          foldArabic(row[2]).includes(arabicNeedle) ||
          row[4].toLowerCase().includes(englishNeedle) ||
          row[3].toLowerCase().includes(englishNeedle)
        ) {
          contributed.add(id);
          out.push(toHadith(id, row));
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  } finally {
    for (const id of openedHere) if (!contributed.has(id)) release(id);
  }
}

/** Filter chapters by name, for the chapter list's own search box. */
export function searchChapters(collectionId: number, query: string): HadithChapter[] {
  const collection = collectionById(collectionId);
  if (collection === undefined) return [];
  const raw = query.trim();
  if (raw.length === 0) return collection.chapters;
  const ar = foldArabic(raw);
  const en = raw.toLowerCase();
  return collection.chapters.filter(
    (c) => foldArabic(c.arabicName).includes(ar) || c.englishName.toLowerCase().includes(en),
  );
}
