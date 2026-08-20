#!/usr/bin/env node --experimental-strip-types
/**
 * Generates src/assets/quran-words.json (spec §3.2 / §2).
 *
 * The flat, normalized word array for the WHOLE Quran plus the offset tables
 * the global cursor is defined against.
 *
 * On-disk layout is deliberately not an array of 78k objects:
 *   words         one space-joined string  (split at load; normalized words
 *                 never contain spaces, so this round-trips exactly and parses
 *                 an order of magnitude faster than a 78k-element JSON array)
 *   ayahStartWord  int[6237]  first word index of each ayah, + total sentinel
 *   pageStartWord  int[605]   first word index of each Madani page, + sentinel
 *   surahStartWord int[115]   first word index of each surah, + sentinel
 *
 * The per-word {surah, ayah, wordInAyah, page} lookup of §2 is materialised at
 * load time as typed arrays from these tables (see src/data/quran.ts) — same
 * O(1) access, ~550 KB of typed arrays instead of 78k JS objects.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { normalizeAyah } from '../src/engine/normalize.ts';

const data = JSON.parse(readFileSync('src/assets/quran-data.json', 'utf8'));

const words = [];
const ayahStartWord = [];
const pageStartWord = [];
const surahStartWord = [];

let lastPage = 0;
for (const [surah, , , , , verses] of data) {
  surahStartWord[surah - 1] = words.length;
  for (const [, , page, , text] of verses) {
    ayahStartWord.push(words.length);
    while (lastPage < page) {
      pageStartWord[lastPage] = words.length;
      lastPage += 1;
    }
    const ws = normalizeAyah(text);
    if (ws.length === 0) throw new Error(`surah ${surah}: ayah normalized to zero words: ${text}`);
    for (const w of ws) {
      if (w.includes(' ')) throw new Error(`normalized word contains a space: ${JSON.stringify(w)}`);
      words.push(w);
    }
  }
}
// sentinels: one past the end, so [start[i], start[i+1]) is always a valid range
ayahStartWord.push(words.length);
pageStartWord.push(words.length);
surahStartWord.push(words.length);

if (ayahStartWord.length !== 6237) throw new Error(`ayahStartWord ${ayahStartWord.length} != 6237`);
if (pageStartWord.length !== 605) throw new Error(`pageStartWord ${pageStartWord.length} != 605`);
if (surahStartWord.length !== 115) throw new Error(`surahStartWord ${surahStartWord.length} != 115`);
for (let i = 1; i < pageStartWord.length; i++) {
  if (pageStartWord[i] < pageStartWord[i - 1]) throw new Error(`pageStartWord not monotonic at ${i}`);
}

const out = {
  count: words.length,
  words: words.join(' '),
  ayahStartWord,
  pageStartWord,
  surahStartWord,
};
writeFileSync('src/assets/quran-words.json', JSON.stringify(out));
const bytes = JSON.stringify(out).length;
console.log(
  `quran-words.json: ${words.length} words, ${(bytes / 1024 / 1024).toFixed(2)} MB, ` +
    `unique ${new Set(words).size}`,
);
