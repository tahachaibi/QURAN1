#!/usr/bin/env node
/**
 * Validates generated Madani page numbers against a printed mushaf (spec §3).
 *
 * Every expectation below is a hand-checked fact about the standard 604-page
 * Madani mushaf, not a restatement of what quran-meta returned. If a future
 * data-source bump silently shifts pagination, this fails the build.
 */
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('src/assets/quran-data.json', 'utf8'));
const words = JSON.parse(readFileSync('src/assets/quran-words.json', 'utf8'));

const page = (s, a) => {
  const surah = data[s - 1];
  const v = surah[5].find((r) => r[0] === a);
  if (!v) throw new Error(`no ayah ${s}:${a}`);
  return v[2];
};
const juz = (s, a) => data[s - 1][5].find((r) => r[0] === a)[3];

/** [label, actual, expected] */
const checks = [
  // Al-Fatiha: the whole surah is page 1
  ['1:1 page', page(1, 1), 1],
  ['1:7 page', page(1, 7), 1],
  // Al-Baqarah, first three of its pages: 2:1-5 | 2:6-16 | 2:17-24
  ['2:1 page', page(2, 1), 2],
  ['2:5 page', page(2, 5), 2],
  ['2:6 page', page(2, 6), 3],
  ['2:16 page', page(2, 16), 3],
  ['2:17 page', page(2, 17), 4],
  ['2:24 page', page(2, 24), 4],
  ['2:25 page', page(2, 25), 5],
  // Al-Baqarah ends on page 49, Aal-Imran opens page 50
  ['2:286 page', page(2, 286), 49],
  ['3:1 page', page(3, 1), 50],
  // Yaseen spans pages 440-445
  ['36:1 page', page(36, 1), 440],
  ['36:83 page', page(36, 83), 445],
  ['37:1 page', page(37, 1), 446],
  // An-Nas is entirely on the last page
  ['114:1 page', page(114, 1), 604],
  ['114:6 page', page(114, 6), 604],
  // juz boundaries every mushaf prints
  ['1:1 juz', juz(1, 1), 1],
  ['2:142 juz', juz(2, 142), 2],
  ['2:253 juz', juz(2, 253), 3],
  ['36:1 juz', juz(36, 1), 22],
  ['67:1 juz', juz(67, 1), 29],
  ['78:1 juz', juz(78, 1), 30],
  // structural invariants
  ['surah count', data.length, 114],
  ['ayah count', data.reduce((n, s) => n + s[5].length, 0), 6236],
  ['page table length', words.pageStartWord.length, 605],
  ['ayah table length', words.ayahStartWord.length, 6237],
  ['surah table length', words.surahStartWord.length, 115],
  ['word count consistent', words.words.split(' ').length, words.count],
  ['al-fatiha word count', words.surahStartWord[1] - words.surahStartWord[0], 29],
  // 2:72 is one word, not two: quran-json splits it across a space
  ['2:72 word count', words.ayahStartWord[79] - words.ayahStartWord[78], 10],
  ['total word count', words.count, 77428],
];

let failed = 0;
for (const [label, actual, expected] of checks) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

// pages must partition the word array with no gaps and no overlaps
for (let p = 1; p <= 604; p++) {
  const start = words.pageStartWord[p - 1];
  const end = words.pageStartWord[p];
  if (!(end > start)) {
    console.log(`FAIL page ${p} is empty (${start}..${end})`);
    failed++;
  }
}

console.log(failed === 0 ? `\nall ${checks.length} mushaf checks passed` : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
