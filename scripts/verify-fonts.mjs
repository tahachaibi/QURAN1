#!/usr/bin/env node
/**
 * Verifies the ayah font against the text it has to render.
 *
 * Two invisible failure modes this catches, both found the hard way:
 *
 *  1. A MISSING GLYPH. Amiri Quran has no U+065E (ARABIC FATHA WITH TWO DOTS),
 *     which the bundled Uthmani text uses 1,807 times across 1,241 ayahs. A
 *     missing combining mark renders as nothing rather than a tofu box, so a
 *     fifth of the Quran was silently dropping a diacritic and every page still
 *     looked plausible. Al-Fatiha contains none of them, so the obvious test
 *     page could never reveal it.
 *
 *  2. COLOUR TABLES. Amiri Quran is in fact Amiri Quran *Coloured*: it carries
 *     COLR/CPAL painting 612 glyphs from a palette of red, green, orange and
 *     blue. Android honours COLRv0 from API 26, so the tashkeel came out red on
 *     device. That collides with the design on purpose-built channels: red is
 *     the missed-word signal (§6.3, "no red text on the sacred text") and the
 *     palette's #EE9933 sits almost on top of the accent gold #C9A227.
 *
 * Pure Node, no dependencies: parses the sfnt table directory and the cmap
 * subtable directly.
 */
import { readFileSync } from 'node:fs';

const AYAH_FONT = 'node_modules/@expo-google-fonts/amiri/Amiri_400Regular.ttf';
const DATA = 'src/assets/quran-data.json';

function tables(buf) {
  const numTables = buf.readUInt16BE(4);
  const out = new Map();
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const tag = buf.toString('latin1', off, off + 4);
    out.set(tag, { offset: buf.readUInt32BE(off + 8), length: buf.readUInt32BE(off + 12) });
  }
  return out;
}

/** Every codepoint the font has a glyph for. */
function coverage(buf, cmap) {
  const base = cmap.offset;
  const numSubtables = buf.readUInt16BE(base + 2);
  const candidates = [];
  for (let i = 0; i < numSubtables; i++) {
    const rec = base + 4 + i * 8;
    candidates.push({
      platform: buf.readUInt16BE(rec),
      encoding: buf.readUInt16BE(rec + 2),
      offset: base + buf.readUInt32BE(rec + 4),
    });
  }
  const covered = new Set();
  for (const sub of candidates) {
    const format = buf.readUInt16BE(sub.offset);
    if (format === 4) readFormat4(buf, sub.offset, covered);
    else if (format === 12) readFormat12(buf, sub.offset, covered);
  }
  return covered;
}

function readFormat4(buf, off, covered) {
  const segCount = buf.readUInt16BE(off + 6) / 2;
  const endsAt = off + 14;
  const startsAt = endsAt + segCount * 2 + 2;
  const deltaAt = startsAt + segCount * 2;
  const rangeAt = deltaAt + segCount * 2;
  for (let s = 0; s < segCount; s++) {
    const end = buf.readUInt16BE(endsAt + s * 2);
    const start = buf.readUInt16BE(startsAt + s * 2);
    if (start > end) continue;
    const delta = buf.readInt16BE(deltaAt + s * 2);
    const rangeOffset = buf.readUInt16BE(rangeAt + s * 2);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph;
      if (rangeOffset === 0) {
        glyph = (c + delta) & 0xffff;
      } else {
        const gi = rangeAt + s * 2 + rangeOffset + (c - start) * 2;
        if (gi + 1 >= buf.length) continue;
        glyph = buf.readUInt16BE(gi);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) covered.add(c);
    }
  }
}

function readFormat12(buf, off, covered) {
  const nGroups = buf.readUInt32BE(off + 12);
  for (let g = 0; g < nGroups; g++) {
    const rec = off + 16 + g * 12;
    const start = buf.readUInt32BE(rec);
    const end = buf.readUInt32BE(rec + 4);
    const startGlyph = buf.readUInt32BE(rec + 8);
    if (startGlyph === 0) continue;
    for (let c = start; c <= end; c++) covered.add(c);
  }
}

const buf = readFileSync(AYAH_FONT);
const dir = tables(buf);
const cmap = dir.get('cmap');
if (cmap === undefined) throw new Error(`${AYAH_FONT} has no cmap table`);

const covered = coverage(buf, cmap);

// --- 1. every codepoint the mushaf text uses must have a glyph ---
const data = JSON.parse(readFileSync(DATA, 'utf8'));
const used = new Map();
for (const surah of data) {
  for (const ayah of surah[5]) {
    for (const ch of ayah[4]) {
      const cp = ch.codePointAt(0);
      used.set(cp, (used.get(cp) ?? 0) + 1);
    }
  }
}

const missing = [...used.entries()]
  .filter(([cp]) => cp !== 0x20 && !covered.has(cp))
  .sort((a, b) => b[1] - a[1]);

// --- 2. the ayah font must not paint its own colours ---
const colourTables = ['COLR', 'CPAL', 'SVG ', 'sbix'].filter((t) => dir.has(t));

let failed = false;

console.log(`ayah font: ${AYAH_FONT}`);
console.log(`  ${covered.size} codepoints covered`);
console.log(`  ${used.size} distinct codepoints used by the bundled text`);

if (missing.length === 0) {
  console.log('  ok   every codepoint in the mushaf text has a glyph');
} else {
  failed = true;
  console.log(`  FAIL ${missing.length} codepoint(s) used by the text have no glyph:`);
  for (const [cp, n] of missing) {
    console.log(`         U+${cp.toString(16).toUpperCase().padStart(4, '0')} used ${n} times`);
  }
}

if (colourTables.length === 0) {
  console.log('  ok   no colour tables — the palette cannot fight the UI');
} else {
  failed = true;
  console.log(`  FAIL colour tables present: ${colourTables.join(', ')}`);
  console.log('       Android paints COLRv0 from API 26, so the marks would be');
  console.log('       coloured on device. Red is the missed-word signal (§6.3).');
}

process.exit(failed ? 1 : 0);
