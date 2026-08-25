#!/usr/bin/env node
/**
 * Builds src/assets/hadith.json from the hadith-json dataset.
 *
 * SELECTION. Only Sahih al-Bukhari and Sahih Muslim. That is a deliberate line,
 * not a shortcut: those two are the collections the scholarly tradition accepts
 * as authentic essentially in their entirety, so restricting to them answers
 * "only hadith that are authentic" without anyone — least of all this script —
 * grading individual narrations. The other books of the six contain sahih, hasan
 * and da'if side by side, and separating them is a scholar's work.
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

const SOURCES = [
  { id: 1, file: process.argv[2] ?? '/tmp/bukhari.json' },
  { id: 2, file: process.argv[3] ?? '/tmp/muslim.json' },
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
