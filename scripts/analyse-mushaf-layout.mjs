#!/usr/bin/env node --experimental-sqlite
/**
 * Analyses a QUL mushaf-layout export before anything is generated from it.
 *
 * The layout gives, per page and line, a contiguous range of QUL word ids. QUL's
 * id space interleaves one ayah-end marker after each ayah's words, so the
 * predicted id of my word `i` is `i + 1 + ayahIndexOf(i)`.
 *
 * That prediction is off by a total of 3 across the Quran, which is the whole
 * reason this script exists: an unnoticed off-by-one shifts every later word
 * onto the wrong line, and in Al-Baqarah that would be roughly 48 pages of
 * silently wrong output. Reporting exactly where the drift happens is the
 * difference between importing this data and guessing at it.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const DB = process.argv[2] ?? 'src/assets/layout/qpc-v2-15-lines.db';

const db = new DatabaseSync(DB);
const info = db.prepare('SELECT * FROM info').get();
const rows = db
  .prepare('SELECT page_number p, line_number l, line_type t, is_centered c, first_word_id f, last_word_id x, surah_number s FROM pages ORDER BY page_number, line_number')
  .all()
  .map((r) => ({
    page: Number(r.p),
    line: Number(r.l),
    type: String(r.t),
    centered: Number(r.c) === 1,
    first: r.f === '' ? 0 : Number(r.f),
    last: r.x === '' ? 0 : Number(r.x),
    surah: r.s === '' ? 0 : Number(r.s),
  }));

const words = JSON.parse(readFileSync('src/assets/quran-words.json', 'utf8'));
const data = JSON.parse(readFileSync('src/assets/quran-data.json', 'utf8'));
const { ayahStartWord: ayahStart, pageStartWord: pageStart, surahStartWord: surahStart } = words;

const ayahOf = new Int32Array(words.count);
for (let g = 0; g < 6236; g++) for (let i = ayahStart[g]; i < ayahStart[g + 1]; i++) ayahOf[i] = g;
/** predicted QUL id of my word index i, 1-based */
const predict = (i) => i + 1 + ayahOf[i];

const ayahLines = rows.filter((r) => r.type === 'ayah');
const markerIds = new Set();
for (let g = 0; g < 6236; g++) markerIds.add(ayahStart[g + 1] + g + 1);

console.log(`layout: ${info.name} — ${info.number_of_pages} pages, ${info.lines_per_page} lines/page, font ${info.font_name}`);
console.log(`rows: ${rows.length} (${ayahLines.length} ayah, ${rows.filter((r) => r.type === 'surah_name').length} surah headers, ${rows.filter((r) => r.type === 'basmallah').length} basmala)`);

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failed++;
};

// --- structure ---
const pages = [...new Set(rows.map((r) => r.page))].sort((a, b) => a - b);
check('604 pages present', pages.length === 604 && pages[0] === 1 && pages[603] === 604, `${pages.length}`);
check('lines per page within 1..15', rows.every((r) => r.line >= 1 && r.line <= 15));
check('every surah has a header row', new Set(rows.filter((r) => r.type === 'surah_name').map((r) => r.surah)).size === 114);

// --- the id space tiles with no gap or overlap ---
let expect = 1;
let breaks = 0;
for (const r of ayahLines) {
  if (r.first !== expect) breaks++;
  expect = r.last + 1;
}
check('ayah lines tile the id space exactly', breaks === 0, `${breaks} breaks, max id ${expect - 1}`);

// --- drift of QUL's id space against my word array ---
const totalPredicted = words.count + 6236;
const drift = expect - 1 - totalPredicted;
console.log(`\nQUL ids: ${expect - 1}   my words + markers: ${totalPredicted}   drift: ${drift > 0 ? '+' : ''}${drift}`);

// --- where does the drift happen? anchor on surah starts ---
const ayahsBefore = [];
{
  let acc = 0;
  for (const row of data) {
    ayahsBefore.push(acc);
    acc += row[5].length;
  }
}
const firstAyahLineAfter = (i) => {
  for (let j = i + 1; j < rows.length; j++) if (rows[j].type === 'ayah') return rows[j];
  return null;
};
const surahAnchor = new Map();
rows.forEach((r, i) => {
  if (r.type !== 'surah_name') return;
  const next = firstAyahLineAfter(i);
  if (next !== null) surahAnchor.set(r.surah, next.first);
});

console.log('\ndrift accumulates inside these surahs:');
let prev = 0;
const culprits = [];
for (let s = 2; s <= 114; s++) {
  const actual = surahAnchor.get(s);
  if (actual === undefined) continue;
  const off = actual - (surahStart[s - 1] + ayahsBefore[s - 1] + 1);
  if (off !== prev) {
    culprits.push({ surah: s - 1, from: prev, to: off });
    console.log(`  surah ${String(s - 1).padStart(3)}  offset ${prev} -> ${off}`);
    prev = off;
  }
}

// --- narrow each to a page, anchored on my verified page table ---
const firstOfPage = new Map();
for (const r of ayahLines) if (!firstOfPage.has(r.page)) firstOfPage.set(r.page, r.first);
const pageOffset = [];
for (let p = 1; p <= 604; p++) {
  const f = firstOfPage.get(p);
  pageOffset.push(f === undefined ? null : f - predict(pageStart[p - 1]));
}
const stepValues = new Set(culprits.map((c) => c.to));
stepValues.add(0);
const clean = pageOffset.filter((o) => o !== null && stepValues.has(o)).length;
console.log(`\npages whose offset is one of the step values {${[...stepValues].sort((a, b) => a - b)}}: ${clean}/604`);
console.log('pages where QUL and quran-meta disagree on where the page breaks:');
const odd = [];
for (let p = 1; p <= 604; p++) if (pageOffset[p - 1] !== null && !stepValues.has(pageOffset[p - 1])) odd.push(p);
console.log(`  ${odd.length} pages: ${odd.slice(0, 40).join(', ')}${odd.length > 40 ? ' …' : ''}`);

console.log('\noffset steps by page (this is where the extra words live):');
let last = pageOffset[0];
for (let p = 2; p <= 604; p++) {
  const o = pageOffset[p - 1];
  if (o === null || !stepValues.has(o) || o === last) continue;
  console.log(`  page ${String(p).padStart(3)}  offset ${last} -> ${o}`);
  last = o;
}

// --- does the mapping actually hold where the offset is stable? ---
const zeroWindows = [];
{
  let start = 1;
  let current = 0;
  const anchors = [...surahAnchor.entries()].sort((a, b) => a[0] - b[0]);
  for (const [s, id] of anchors) {
    const off = id - (surahStart[s - 1] + ayahsBefore[s - 1] + 1);
    if (off !== current) {
      if (current === 0) zeroWindows.push([start, id - 1]);
      current = off;
      start = id;
    }
  }
  if (current === 0) zeroWindows.push([start, expect - 1]);
}
let tested = 0;
let hits = 0;
for (const r of ayahLines) {
  if (!zeroWindows.some(([a, b]) => r.first >= a && r.last <= b)) continue;
  tested++;
  if (markerIds.has(r.last)) hits++;
}
const rate = tested === 0 ? 0 : hits / tested;
console.log(`\nmapping sanity, inside zero-offset windows only:`);
console.log(`  ${tested} lines tested, ${hits} end exactly on an ayah marker (${(rate * 100).toFixed(1)}%)`);
check(
  'lines ending on ayah markers at a plausible rate (a wrong mapping gives ~0%)',
  rate > 0.05,
  `${(rate * 100).toFixed(1)}%`,
);

// --- does QUL agree with the hand-checked printed-mushaf facts? ---
console.log('\nQUL vs the printed-mushaf facts scripts/verify-pages.mjs asserts:');
const globalAyahIndex = (s, a) => ayahsBefore[s - 1] + a - 1;
const idOfAyahStart = (s, a) => {
  const g = globalAyahIndex(s, a);
  return ayahStart[g] + 1 + g;
};
const pageOfId = (id) => {
  for (const r of ayahLines) if (id >= r.first && id <= r.last) return r.page;
  return -1;
};
const facts = [
  [1, 1, 1],
  [2, 1, 2],
  [2, 6, 3],
  [2, 17, 4],
  [2, 286, 49],
  [3, 1, 50],
  [36, 1, 440],
  [36, 83, 445],
  [67, 1, 562],
  [114, 1, 604],
];
for (const [s, a, expectedPage] of facts) {
  const id = idOfAyahStart(s, a);
  // the drift is at most 3 ids, far smaller than a page, so a +/-3 window is safe
  const found = [pageOfId(id), pageOfId(id - 3), pageOfId(id + 3)];
  const ok = found.includes(expectedPage);
  check(`${s}:${a} on page ${expectedPage}`, ok, ok ? '' : `QUL says ${found.join('/')}`);
}

console.log(
  failed === 0
    ? `\n${drift === 0 ? 'layout is directly importable' : `layout is structurally sound, but ${Math.abs(drift)} word(s) of drift must be resolved before import`}`
    : `\n${failed} CHECK(S) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
