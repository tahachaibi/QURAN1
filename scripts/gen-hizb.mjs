/**
 * Build src/assets/hizb.json — the start of each of the sixty hizb.
 *
 * The references were supplied by hand (data/hizb-supplied.txt) because they are
 * not in any data this app already has: the bundled text tags every ayah with its
 * juz but never its hizb, the QUL layout database holds only pages and lines, and
 * the ۞ rub-el-hizb markers in the text are incomplete — 199 where 239 would be
 * needed, thinning to one in the last juz.
 *
 * SUPPLIED IS NOT THE SAME AS TRUE, so nothing here is taken on trust. Four
 * checks, and the build fails on any of them:
 *
 *  1. EVERY ODD HIZB MUST EQUAL A JUZ START. Hizb 2n-1 begins where juz n begins,
 *     and this app derives juz starts independently, from the juz number stored on
 *     every ayah. That is thirty checks the supplied list cannot pass by accident,
 *     and it is what makes the other thirty believable.
 *  2. EVERY EVEN HIZB MUST FALL STRICTLY INSIDE ITS JUZ — after that juz's start
 *     and before the next one. A half-juz cannot be anywhere else.
 *  3. THE OPENING WORDS MUST MATCH the bundled mushaf text at that ayah. This is
 *     what catches a mistyped reference: 2:75 and 2:57 are one keystroke apart and
 *     both exist.
 *  4. THE STARTS MUST INCREASE. Sixty of them, strictly, from 1:1 onwards.
 *
 * Run: npm run gen:hizb
 */
import { readFileSync, writeFileSync } from 'node:fs';

const words = JSON.parse(
  readFileSync(new URL('../src/assets/quran-words.json', import.meta.url), 'utf8'),
);
const data = JSON.parse(
  readFileSync(new URL('../src/assets/quran-data.json', import.meta.url), 'utf8'),
);
const supplied = readFileSync(new URL('../data/hizb-supplied.txt', import.meta.url), 'utf8');

const TOTAL_HIZB = 60;
const TOTAL_JUZ = 30;

/** Diacritics and the rest of the combining marks, as escapes. */
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const fold = (value) =>
  value
    .replace(MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^ء-ي\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// --- the bundled text, indexed by surah:ayah ---
const ayahText = new Map();
const ayahJuz = new Map();
for (const surah of data) {
  for (const ayah of surah[5]) {
    ayahText.set(`${surah[0]}:${ayah[0]}`, ayah[4]);
    ayahJuz.set(`${surah[0]}:${ayah[0]}`, ayah[3]);
  }
}

/** Global word index of the first word of an ayah, from the same tables the app uses. */
const globalAyahIndexOf = (surah, ayah) => {
  let count = 0;
  for (const s of data) {
    if (s[0] === surah) return count + ayah - 1;
    count += s[5].length;
  }
  throw new Error(`no surah ${surah}`);
};
const wordOf = (surah, ayah) => words.ayahStartWord[globalAyahIndexOf(surah, ayah)];
const pageOf = (surah, ayah) => {
  const row = data[surah - 1][5][ayah - 1];
  if (row === undefined) throw new Error(`no ayah ${surah}:${ayah}`);
  return row[2];
};

/** Juz starts, derived from the juz stored on every ayah — the app's own way. */
const juzStarts = [];
{
  let seen = 0;
  for (const surah of data) {
    for (const ayah of surah[5]) {
      if (ayah[3] === seen + 1) {
        juzStarts.push({ surah: surah[0], ayah: ayah[0] });
        seen = ayah[3];
      }
    }
  }
  if (juzStarts.length !== TOTAL_JUZ) {
    throw new Error(`derived ${juzStarts.length} juz starts, expected ${TOTAL_JUZ}`);
  }
}

// --- parse the supplied list ---
const rows = [];
for (const line of supplied.split('\n')) {
  if (/^\s*#/.test(line) || line.trim().length === 0) continue;
  const m = /^(\d{1,2})\s+(\d{1,3}):(\d{1,3})\s+(.+)$/.exec(line.trim());
  if (m === null) throw new Error(`cannot read line: ${line}`);
  rows.push({ hizb: Number(m[1]), surah: Number(m[2]), ayah: Number(m[3]), opening: m[4].trim() });
}

const fail = (message) => {
  console.error(`\nFAIL  ${message}`);
  process.exit(1);
};

if (rows.length !== TOTAL_HIZB) fail(`${rows.length} hizb supplied, expected ${TOTAL_HIZB}`);

const out = [];
let previousWord = -1;

for (const row of rows) {
  const key = `${row.surah}:${row.ayah}`;
  const text = ayahText.get(key);
  if (text === undefined) fail(`hizb ${row.hizb}: there is no ayah ${key}`);

  // check 3: the opening words must be the opening words
  const openingFolded = fold(row.opening);
  const ayahFolded = fold(text);
  if (!ayahFolded.startsWith(openingFolded)) {
    fail(
      `hizb ${row.hizb} (${key}): the supplied opening does not match the mushaf text.\n` +
        `      supplied: ${openingFolded}\n` +
        `      at ${key}:  ${ayahFolded.slice(0, 80)}`,
    );
  }

  // check 1 and 2: against juz derived from the bundled text
  const juz = ayahJuz.get(key);
  if (row.hizb % 2 === 1) {
    const expected = juzStarts[(row.hizb - 1) / 2];
    if (expected.surah !== row.surah || expected.ayah !== row.ayah) {
      fail(
        `hizb ${row.hizb} should begin where juz ${(row.hizb + 1) / 2} begins ` +
          `(${expected.surah}:${expected.ayah}) but was given as ${key}`,
      );
    }
  } else {
    const juzNumber = row.hizb / 2;
    const start = juzStarts[juzNumber - 1];
    const next = juzStarts[juzNumber];
    const here = wordOf(row.surah, row.ayah);
    if (here <= wordOf(start.surah, start.ayah)) {
      fail(`hizb ${row.hizb} (${key}) is not after the start of juz ${juzNumber}`);
    }
    if (next !== undefined && here >= wordOf(next.surah, next.ayah)) {
      fail(`hizb ${row.hizb} (${key}) is not before the start of juz ${juzNumber + 1}`);
    }
  }

  // check 4: strictly increasing
  const word = wordOf(row.surah, row.ayah);
  if (word <= previousWord) fail(`hizb ${row.hizb} (${key}) does not come after hizb ${row.hizb - 1}`);
  previousWord = word;

  out.push({ hizb: row.hizb, surah: row.surah, ayah: row.ayah, word, page: pageOf(row.surah, row.ayah), juz });
}

writeFileSync(
  new URL('../src/assets/hizb.json', import.meta.url),
  `${JSON.stringify({ hizb: out }, null, 1)}\n`,
);

console.log(`hizb.json: ${out.length} entries`);
console.log(`  ok   all 30 odd hizb land exactly on a juz start derived from the bundled text`);
console.log(`  ok   all 30 even hizb fall strictly inside their juz`);
console.log(`  ok   every supplied opening matches the mushaf text at that ayah`);
console.log(`  ok   strictly increasing, 1:1 to ${out[out.length - 1].surah}:${out[out.length - 1].ayah}`);
for (const h of out.filter((h) => h.hizb % 10 === 0)) {
  console.log(`  hizb ${String(h.hizb).padStart(2)}  ${h.surah}:${h.ayah}  word ${h.word}  page ${h.page}  juz ${h.juz}`);
}
