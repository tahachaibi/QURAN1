#!/usr/bin/env node
/**
 * Builds src/assets/hadith.json from the hadith-json dataset.
 *
 * SELECTION. All six books, on request: the two Sahihs and the four Sunan.
 *
 * That changes a property this file used to guarantee, and the change is worth
 * stating rather than burying. Bukhari and Muslim are accepted by the scholarly
 * tradition as authentic essentially in their entirety, so an app carrying only
 * those two can promise authenticity without anyone — least of all this script —
 * grading a narration. THE FOUR SUNAN DO NOT WORK THAT WAY: they hold sahih,
 * hasan and da'if side by side, deliberately, and this dataset carries no grading
 * field at all (`grades` is null on every row of all four). So the app cannot
 * label strength, and it must not imply one.
 *
 * What it can do, and does: name the collection and the number on every single
 * hadith, so anything shown can be looked up in a printed copy or against a
 * graded reference. That is the honest limit of what this data supports.
 *
 * Every hadith keeps its collection and its number in that collection, so any of
 * it can be checked against a printed copy.
 *
 * SHAPE. Compact rows rather than objects, the same as the Quran data. Split
 * across files ON PURPOSE:
 *
 *   hadith-index.json  collections, chapter names and counts — small, imported
 *                      eagerly so the tab can render its lists instantly
 *   hadith-1.json      Bukhari's text
 *   hadith-2.json      Muslim's text
 *
 * The two text files are ~11 MB each and are `require`d lazily when a collection
 * is opened, because Metro runs a module's factory on first require. Importing
 * all 22 MB at the top of a module would materialise every hadith in memory
 * whether or not anyone opened the tab.
 *
 *   index:    collections: [id, arTitle, enTitle, arAuthor, enAuthor,
 *                           [[chapterId, arName, enName, count], ...]]
 *   text:     [[chapterId, numberInBook, arabic, narrator, english], ...]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

/**
 * Ids are the dataset's own, so a hadith number in this app is the number in the
 * source. The ORDER here is display order: the two Sahihs first, then the Sunan
 * in the order they were asked for.
 */
const SOURCES = [
  { id: 1, file: '/tmp/bukhari.json', sahih: true },
  { id: 2, file: '/tmp/muslim.json', sahih: true },
  { id: 4, file: '/tmp/sunan-abudawud.json', sahih: false },
  { id: 5, file: '/tmp/sunan-tirmidhi.json', sahih: false },
  { id: 3, file: '/tmp/sunan-nasai.json', sahih: false },
  { id: 6, file: '/tmp/sunan-ibnmajah.json', sahih: false },
];

/** Collapse the runs of whitespace and stray newlines the scrape left behind. */
const tidy = (value) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').replace(/\s+([،.؛:])/g, '$1').trim() : '';

const collections = [];
const hadiths = [];
let skipped = 0;

for (const source of SOURCES) {
  const book = JSON.parse(readFileSync(source.file, 'utf8'));
  const meta = book.metadata;

  const chapters = book.chapters.map((c) => [Number(c.id), tidy(c.arabic), tidy(c.english)]);
  collections.push([
    source.id,
    tidy(meta.arabic?.title),
    tidy(meta.english?.title),
    tidy(meta.arabic?.author),
    tidy(meta.english?.author),
    chapters,
    // whether the tradition accepts this collection as authentic throughout;
    // the UI needs it to avoid implying a strength the data cannot support
    source.sahih ? 1 : 0,
  ]);

  const chapterIds = new Set(chapters.map((c) => c[0]));
  for (const h of book.hadiths) {
    const arabic = tidy(h.arabic);
    const english = tidy(h.english?.text);
    // A hadith with no Arabic is useless here, and one with no translation would
    // break the promised "English underneath". Drop rather than half-render.
    if (arabic.length === 0 || english.length === 0) {
      skipped++;
      continue;
    }
    const chapterId = Number(h.chapterId);
    if (!chapterIds.has(chapterId)) {
      skipped++;
      continue;
    }
    hadiths.push([
      source.id,
      chapterId,
      Number(h.idInBook),
      arabic,
      tidy(h.english?.narrator),
      english,
    ]);
  }
}

hadiths.sort((a, b) => a[0] - b[0] || a[2] - b[2]);

mkdirSync('src/assets', { recursive: true });
let totalBytes = 0;

// per-collection text files, required lazily at runtime
for (const collection of collections) {
  const id = collection[0];
  const rows = hadiths.filter((h) => h[0] === id).map((h) => [h[1], h[2], h[3], h[4], h[5]]);
  const json = JSON.stringify(rows);
  writeFileSync(`src/assets/hadith-${id}.json`, json);
  totalBytes += Buffer.byteLength(json, 'utf8');

  // per-chapter counts belong in the index, so lists render without the text
  const counts = new Map();
  for (const row of rows) counts.set(row[0], (counts.get(row[0]) ?? 0) + 1);
  for (const chapter of collection[5]) chapter.push(counts.get(chapter[0]) ?? 0);

  console.log(
    `  hadith-${id}.json  ${collection[2]}: ${rows.length} hadith, ` +
      `${collection[5].length} chapters, ${(Buffer.byteLength(json, 'utf8') / 1024 / 1024).toFixed(2)} MB`,
  );
}

// chapters with no hadith at all would be dead ends in the UI
for (const collection of collections) {
  const before = collection[5].length;
  collection[5] = collection[5].filter((c) => c[3] > 0);
  const dropped = before - collection[5].length;
  if (dropped > 0) console.log(`  ${collection[2]}: dropped ${dropped} empty chapter(s)`);
}

const indexJson = JSON.stringify({ collections });
writeFileSync('src/assets/hadith-index.json', indexJson);
const indexBytes = Buffer.byteLength(indexJson, 'utf8');

console.log(
  `hadith: ${collections.length} collections, ` +
    `${collections.reduce((n, c) => n + c[5].length, 0)} chapters, ${hadiths.length} hadith` +
    (skipped > 0 ? ` (${skipped} skipped for missing text)` : ''),
);
console.log(
  `  index ${(indexBytes / 1024).toFixed(0)} KB (eager) + text ${(totalBytes / 1024 / 1024).toFixed(2)} MB (lazy)`,
);
