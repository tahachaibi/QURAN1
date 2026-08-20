#!/usr/bin/env node
/**
 * Generates src/assets/quran-search.json (spec §3.3).
 *
 * Inverted index: normalized word -> sorted global word positions. Turns
 * "where in the Quran is this phrase" into two or three array intersections,
 * cheap enough to run on EVERY partial result (spec §5.5) instead of being a
 * threshold-triggered special mode.
 *
 * The 40 most frequent words are dropped: they are useless as search anchors
 * and would otherwise dominate the file size.
 *
 * Postings are stored as comma-joined base36 DELTAS in one string per word.
 * JSON.parse then costs almost nothing and only the handful of words actually
 * queried get decoded (and cached) at runtime.
 */
import { writeFileSync, readFileSync } from 'node:fs';

const STOPWORD_COUNT = 40;

const { words: joined, count } = JSON.parse(readFileSync('src/assets/quran-words.json', 'utf8'));
const words = joined.split(' ');
if (words.length !== count) throw new Error(`word count mismatch ${words.length} != ${count}`);

/** word -> positions */
const postings = new Map();
for (let i = 0; i < words.length; i++) {
  const w = words[i];
  let list = postings.get(w);
  if (list === undefined) postings.set(w, (list = []));
  list.push(i);
}

const byFrequency = [...postings.entries()].sort((a, b) => b[1].length - a[1].length);
const stopwords = byFrequency.slice(0, STOPWORD_COUNT).map(([w]) => w);
const stopSet = new Set(stopwords);

const index = {};
let postingTotal = 0;
for (const [w, list] of postings) {
  if (stopSet.has(w)) continue;
  let prev = 0;
  let s = '';
  for (const p of list) {
    s += (s ? ',' : '') + (p - prev).toString(36);
    prev = p;
  }
  index[w] = s;
  postingTotal += list.length;
}

const out = { stopwords, index };
writeFileSync('src/assets/quran-search.json', JSON.stringify(out));
const bytes = JSON.stringify(out).length;
console.log(
  `quran-search.json: ${Object.keys(index).length} indexed words, ` +
    `${postingTotal} postings, ${(bytes / 1024 / 1024).toFixed(2)} MB`,
);
console.log('dropped stopwords:', stopwords.join(' '));
