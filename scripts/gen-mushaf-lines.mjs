#!/usr/bin/env node --experimental-sqlite
/**
 * Imports the QUL mushaf layout into src/assets/quran-lines.json, and makes the
 * layout the single source of truth for page boundaries.
 *
 * QUL's word-id space interleaves one ayah-end marker after each ayah's words,
 * so the id of my word `i` is exactly `i + 1 + ayahIndexOf(i)`. That identity
 * holds globally only after the four source splits and the one fusion in
 * src/engine/normalize.ts; scripts/analyse-mushaf-layout.mjs is what proved it,
 * and this generator re-proves it by reconstructing every one of the 83,668 ids
 * and comparing them against the database.
 *
 * Pages come from here, not from quran-meta. The two disagree on 26 pages, and
 * mixing a page list from one source with line breaks from another is exactly
 * the kind of split-brain that produces pages which look right and are not.
 * quran-meta still supplies juz. scripts/verify-pages.mjs then checks the RESULT
 * against hand-verified printed-mushaf facts, so adopting QUL cannot silently
 * move a page I have already confirmed by hand.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

const DB = process.argv[2] ?? 'src/assets/layout/qpc-v2-15-lines.db';

const db = new DatabaseSync(DB);
const info = db.prepare('SELECT * FROM info').get();
const raw = db
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
const ayahStart = words.ayahStartWord;
const TOTAL_AYAHS = 6236;

// --- the mapping, and its inverse ---------------------------------------
const ayahOf = new Int32Array(words.count);
for (let g = 0; g < TOTAL_AYAHS; g++) {
  for (let i = ayahStart[g]; i < ayahStart[g + 1]; i++) ayahOf[i] = g;
}
/** QUL id of my word index i (1-based) */
const idOfWord = (i) => i + 1 + ayahOf[i];
/** QUL id of the ayah-end marker after global ayah g */
const idOfMarker = (g) => ayahStart[g + 1] + g + 1;

const maxId = words.count + TOTAL_AYAHS;
const dbMaxId = Math.max(...raw.filter((r) => r.type === 'ayah').map((r) => r.last));
if (dbMaxId !== maxId) {
  throw new Error(
    `word-id drift: the layout has ${dbMaxId} ids, my word array implies ${maxId}. ` +
      `Run "node --experimental-sqlite scripts/analyse-mushaf-layout.mjs" — it names the surahs and pages where the drift accumulates.`,
  );
}

/** token at a QUL id: a word index, or a marker's ayah */
const tokenOf = (() => {
  const kind = new Uint8Array(maxId + 1); // 0 = word, 1 = marker
  const value = new Int32Array(maxId + 1);
  for (let i = 0; i < words.count; i++) {
    const id = idOfWord(i);
    kind[id] = 0;
    value[id] = i;
  }
  for (let g = 0; g < TOTAL_AYAHS; g++) {
    const id = idOfMarker(g);
    if (kind[id] === 1) throw new Error(`two markers share id ${id}`);
    kind[id] = 1;
    value[id] = g;
  }
  return (id) => ({ marker: kind[id] === 1, value: value[id] });
})();

// every id must be claimed exactly once
{
  const seen = new Uint8Array(maxId + 2);
  for (let i = 0; i < words.count; i++) seen[idOfWord(i)]++;
  for (let g = 0; g < TOTAL_AYAHS; g++) seen[idOfMarker(g)]++;
  for (let id = 1; id <= maxId; id++) {
    if (seen[id] !== 1) throw new Error(`id ${id} is claimed ${seen[id]} times, expected exactly 1`);
  }
}

// --- build the per-page line encoding ------------------------------------
const byPage = new Map();
for (const r of raw) {
  if (!byPage.has(r.page)) byPage.set(r.page, []);
  byPage.get(r.page).push(r);
}

const pageLines = [];
const pageFirstWord = [];
let reconstructed = 0;

for (let p = 1; p <= 604; p++) {
  const rows = byPage.get(p);
  if (rows === undefined) throw new Error(`page ${p} missing from the layout`);
  const segments = [];
  let firstWordOnPage = -1;

  for (const r of rows) {
    if (r.type === 'surah_name') {
      segments.push(`s${r.surah}`);
      continue;
    }
    if (r.type === 'basmallah') {
      segments.push('b');
      continue;
    }
    // an ayah line: a contiguous id range
    const tokens = [];
    for (let id = r.first; id <= r.last; id++) tokens.push(tokenOf(id));
    reconstructed += tokens.length;

    const wordTokens = tokens.filter((t) => !t.marker);
    const startsWithMarker = tokens.length > 0 && tokens[0].marker;
    const endsWithMarker = tokens.length > 0 && tokens[tokens.length - 1].marker;

    // words on a line are contiguous in my index space; assert it rather than assume
    for (let k = 1; k < wordTokens.length; k++) {
      if (wordTokens[k].value !== wordTokens[k - 1].value + 1) {
        throw new Error(`page ${p} line ${r.line}: word indices are not contiguous`);
      }
    }

    const from = wordTokens.length > 0 ? wordTokens[0].value : -1;
    const to = wordTokens.length > 0 ? wordTokens[wordTokens.length - 1].value : -1;
    if (from >= 0 && firstWordOnPage < 0) firstWordOnPage = from;

    const flags = `${startsWithMarker ? '^' : ''}${endsWithMarker ? '$' : ''}`;
    segments.push(`a${from}:${to}${flags}${r.centered ? '=' : ''}`);
  }

  if (firstWordOnPage < 0) throw new Error(`page ${p} has no words`);
  pageFirstWord.push(firstWordOnPage);
  pageLines.push(segments.join('|'));
}

if (reconstructed !== maxId) {
  throw new Error(`reconstructed ${reconstructed} ids, expected ${maxId}`);
}
// pages must start in increasing word order and cover the whole array
for (let p = 1; p < 604; p++) {
  if (pageFirstWord[p] <= pageFirstWord[p - 1]) {
    throw new Error(`page ${p + 1} starts at word ${pageFirstWord[p]}, not after page ${p}`);
  }
}
if (pageFirstWord[0] !== 0) throw new Error(`page 1 starts at word ${pageFirstWord[0]}, expected 0`);

// --- adopt the layout's pagination --------------------------------------
const newPageStart = [...pageFirstWord, words.count];
let pageChanges = 0;
for (let i = 0; i < newPageStart.length; i++) {
  if (newPageStart[i] !== words.pageStartWord[i]) pageChanges++;
}
words.pageStartWord = newPageStart;
writeFileSync('src/assets/quran-words.json', JSON.stringify(words));

// per-ayah page column in quran-data.json, from the layout
const pageOfWord = new Uint16Array(words.count);
for (let p = 1; p <= 604; p++) {
  for (let i = newPageStart[p - 1]; i < newPageStart[p]; i++) pageOfWord[i] = p;
}
let ayahPageChanges = 0;
{
  let g = 0;
  for (const surah of data) {
    for (const ayah of surah[5]) {
      const page = pageOfWord[ayahStart[g]];
      if (ayah[2] !== page) ayahPageChanges++;
      ayah[2] = page;
      g++;
    }
  }
}
writeFileSync('src/assets/quran-data.json', JSON.stringify(data));

const out = {
  name: String(info.name).trim(),
  pages: Number(info.number_of_pages),
  linesPerPage: Number(info.lines_per_page),
  font: String(info.font_name),
  lines: pageLines,
};
const json = JSON.stringify(out);
writeFileSync('src/assets/quran-lines.json', json);

console.log(`quran-lines.json: ${out.name}, ${out.pages} pages, ${out.linesPerPage} lines/page`);
console.log(`  ${raw.length} lines encoded, all ${maxId} word ids reconstructed and matched`);
console.log(`  page boundaries adopted from the layout: ${pageChanges} of 605 offsets changed, ${ayahPageChanges} ayah page numbers updated`);
console.log(`  ${(Buffer.byteLength(json, 'utf8') / 1024).toFixed(0)} KB`);
