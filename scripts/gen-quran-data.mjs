#!/usr/bin/env node --experimental-strip-types
/**
 * Generates src/assets/quran-data.json (spec §3.1).
 *
 * Display text from `quran-json` (Uthmani, full tashkeel + Quranic marks),
 * Madani page and juz from `quran-meta`'s Hafs riwaya.
 *
 * Compact row layout, not verbose objects:
 *   [surah, name, translit, translation, type,
 *     [[ayahNo, globalAyahNo, page, juz, text], ...]]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHafs } from 'quran-meta/hafs';

const require = createRequire(import.meta.url);
const chapters = require('quran-json/dist/quran_en.json');

const q = createHafs();

if (chapters.length !== 114) throw new Error(`expected 114 surahs, got ${chapters.length}`);

/**
 * Surah names quran-json spells wrongly, corrected here so a regeneration cannot
 * bring them back. These are names in the interface, not mushaf text: the ayah
 * text is never touched.
 *
 *   - إبراهيم and الإنسان begin with hamzat al-qat', which the source drops —
 *     while writing الأنعام, الإسراء and الإخلاص with theirs.
 *   - الانفطار and الانشقاق are masdars of انفعل verbs, which begin with hamzat
 *     al-wasl: no hamza is written.
 *   - سبأ and النبأ: the source has سبإ and النبإ, the genitive spelling the
 *     mushaf uses after "سورة". Standing alone, as the lists show them, a final
 *     hamza after a fatha sits on alif.
 *
 * English: 21 follows the usual transliteration; 86 and 107 are typos.
 */
const NAME_FIX = {
  14: 'إبراهيم',
  34: 'سبأ',
  76: 'الإنسان',
  78: 'النبأ',
  82: 'الانفطار',
  84: 'الانشقاق',
};
const TRANSLITERATION_FIX = { 21: 'Al-Anbiya' };
const TRANSLATION_FIX = { 86: 'The Nightcomer', 107: 'The Small Kindnesses' };

const rows = [];
let globalAyah = 0;
for (const c of chapters) {
  if (c.verses.length !== c.total_verses) {
    throw new Error(`surah ${c.id}: total_verses ${c.total_verses} != verses ${c.verses.length}`);
  }
  const verses = c.verses.map((v) => {
    globalAyah += 1;
    const page = q.findPage(c.id, v.id);
    const juz = q.findJuz(c.id, v.id);
    if (!Number.isInteger(page) || page < 1 || page > 604) {
      throw new Error(`bad page ${page} for ${c.id}:${v.id}`);
    }
    if (!Number.isInteger(juz) || juz < 1 || juz > 30) {
      throw new Error(`bad juz ${juz} for ${c.id}:${v.id}`);
    }
    const text = v.text.trim();
    if (!text) throw new Error(`empty text at ${c.id}:${v.id}`);
    return [v.id, globalAyah, page, juz, text];
  });
  rows.push([
    c.id,
    NAME_FIX[c.id] ?? c.name,
    TRANSLITERATION_FIX[c.id] ?? c.transliteration,
    TRANSLATION_FIX[c.id] ?? c.translation,
    c.type,
    verses,
  ]);
}

if (globalAyah !== q.meta.numAyahs) {
  throw new Error(`ayah count ${globalAyah} != quran-meta ${q.meta.numAyahs}`);
}

mkdirSync('src/assets', { recursive: true });
const json = JSON.stringify(rows);
writeFileSync('src/assets/quran-data.json', json);
// Byte length, not string length: Arabic is two bytes per character in UTF-8,
// so `.length` reports about half the real file size.
const bytes = Buffer.byteLength(json, 'utf8');
console.log(`quran-data.json: 114 surahs, ${globalAyah} ayahs, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
