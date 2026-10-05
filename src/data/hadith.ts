/**
 * Hadith: Sahih al-Bukhari and Sahih Muslim, Arabic with the English underneath.
 *
 * WHY ONLY THESE TWO. The brief was hadith that are authentic. Bukhari and Muslim
 * are the collections the scholarly tradition accepts as authentic essentially in
 * their entirety, so restricting to them answers that without this code grading
 * individual narrations — which is a scholar's work, not a program's. The other
 * books of the six carry sahih, hasan and da'if side by side. Every hadith here
 * shows its collection and its number, so any of it can be checked against a
 * printed copy.
 *
 * LOADING. The index — collections, chapter names, counts — is 11 KB and is
 * imported eagerly. The text is 21.8 MB and is `require`d lazily per collection:
 * Metro runs a module's factory on first require, so nothing is materialised
 * until someone actually opens a collection.
 *
 * Once opened, a collection stays in memory for the life of the process. That is
 * Metro's doing, not a choice made here: its module registry keeps every module's
 * exports once the factory has run, and has no way to forget one. There used to
 * be a release() that dropped this file's own reference and claimed to free the
 * text; the registry still held it, so it freed nothing, and it is gone rather
 * than left to mislead.
 */
import rawIndex from '../assets/hadith-index.json';
import { foldArabic, foldedPattern } from './fold';

export { foldArabic };

/** [chapterId, arabicName, englishName, count] */
type ChapterRow = [number, string, string, number];
/** [id, arTitle, enTitle, arAuthor, enAuthor, chapters] */
type CollectionRow = [number, string, string, string, string, ChapterRow[]];
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
 * at module scope it would pull 22 MB into memory on app start. (A collection
 * that has been opened stays open; see the note at the top of this file.)
 */
function rowsOf(collectionId: number): HadithRow[] {
  const cached = loaded.get(collectionId);
  if (cached !== undefined) return cached;
  let rows: HadithRow[];
  switch (collectionId) {
    case 1:
      rows = require('../assets/hadith-1.json') as HadithRow[];
      break;
    case 2:
      rows = require('../assets/hadith-2.json') as HadithRow[];
      break;
    default:
      rows = [];
  }
  loaded.set(collectionId, rows);
  return rows;
}

/** Whether a collection's text has been opened yet, which happens only on demand. */
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

export interface HadithSearchOptions {
  /** limit to one collection; omit to search both */
  collectionId?: number;
  limit?: number;
}

export interface HadithSearchPage {
  /** the matches shown, each collection's in its own order, Bukhari's first */
  hits: Hadith[];
  /** true when more hadith matched than `limit` let through */
  more: boolean;
}

/**
 * Substring search over the Arabic and the English.
 *
 * Deliberately a scan rather than an index: it runs only when the user has
 * typed something, and the alternative — an inverted index over 22 MB — is a
 * second bundled asset for a feature nobody uses at 60 fps.
 *
 * WHAT A SCAN COSTS is folding, not reading. Folding every narration to compare
 * it with the folded query was seven regex passes and a new string per hadith,
 * on every search: a quarter of a second per keystroke for a rare word, even
 * under V8, and the phone runs Hermes, which has no JIT. The query is now
 * compiled once into a pattern that matches the unfolded text directly (see
 * foldedPattern), which gives the same answers without copying anything.
 *
 * BOTH COLLECTIONS GET A FAIR SHARE when neither is named. Filling the limit in
 * collection order meant any common word showed forty Bukhari results and not
 * one from Muslim, under a box promising to search both. Each collection is now
 * offered an equal share of the limit, and whatever one cannot fill goes to the
 * other.
 */
export function searchHadithPage(query: string, options: HadithSearchOptions = {}): HadithSearchPage {
  const raw = query.trim();
  if (raw.length < 2) return { hits: [], more: false };
  const limit = options.limit ?? 60;
  const arabic = foldedPattern(raw);
  const englishNeedle = raw.toLowerCase();
  const ids =
    options.collectionId === undefined ? collections.map((c) => c.id) : [options.collectionId];

  // One more than the limit from each collection: enough to tell "exactly this
  // many" from "more than we are showing" without reading any further.
  const found = ids.map((id) => {
    const hits: Hadith[] = [];
    for (const row of rowsOf(id)) {
      if (
        (arabic !== null && arabic.test(row[2])) ||
        row[4].toLowerCase().includes(englishNeedle) ||
        row[3].toLowerCase().includes(englishNeedle)
      ) {
        hits.push(toHadith(id, row));
        if (hits.length > limit) break;
      }
    }
    return hits;
  });

  // Deal the limit out one at a time, round the collections, skipping any that
  // has run out — equal shares, with the unused part of one going to the rest.
  const take = found.map(() => 0);
  let left = limit;
  let dealt = true;
  while (left > 0 && dealt) {
    dealt = false;
    for (let i = 0; i < found.length && left > 0; i++) {
      if (take[i] < found[i].length) {
        take[i] += 1;
        left -= 1;
        dealt = true;
      }
    }
  }

  const total = found.reduce((n, hits) => n + hits.length, 0);
  return { hits: found.flatMap((hits, i) => hits.slice(0, take[i])), more: total > limit };
}

/** The matches alone, for callers that do not show whether there were more. */
export function searchHadith(query: string, options: HadithSearchOptions = {}): Hadith[] {
  return searchHadithPage(query, options).hits;
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
