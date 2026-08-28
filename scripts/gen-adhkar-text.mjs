/**
 * Turn data/adhkar-supplied.txt into src/assets/adhkar-pages.json.
 *
 * The text was supplied by hand because www.islambook.com cannot be reached from
 * the machine this app is built on — the egress proxy answers 403 to CONNECT for
 * that host, an organisation policy denial. Keeping the supplied text in the repo
 * rather than only the generated JSON is the point: what is on screen can always
 * be diffed against what was actually handed over.
 *
 * THE RULE, UNCHANGED: not one Arabic character is written by this app. This
 * script splits, classifies and copies. It never rewrites, never adds tashkeel,
 * never fills a gap. If something arrives wrong it is shown wrong, and the fix is
 * a corrected paste.
 *
 * THREE CLASSIFICATIONS, each mechanical and each logged so it can be checked:
 *
 *  1. THE COUNT comes off the title line ("— 3 مرات"), and a bare restatement of
 *     it further down ("4 مرات.") is dropped as redundant.
 *
 *  2. DHIKR versus COMMENTARY is decided by DIACRITIC DENSITY. The supplied du'a
 *     text is fully vowelled — اللَّهُمَّ أَنْتَ رَبِّي — and the explanatory
 *     sentences around it are not — ويمكنك الإكثار منها. Counting harakat per
 *     letter separates them without anybody guessing which Arabic sentence is
 *     scripture, which is not a judgement this script should be making.
 *
 *  3. QUR'AN PASSAGES are dropped, by title, and rendered from the bundled mushaf
 *     text instead. The supplied Ayat al-Kursi is truncated with an ellipsis, and
 *     an app that ships a partial ayah where a whole one belongs is worse than one
 *     that reads it from the text it already has.
 *
 * Run: npm run gen:adhkar-text
 */
import { readFileSync, writeFileSync } from 'node:fs';

const IN = new URL('../data/adhkar-supplied.txt', import.meta.url);
const OUT = new URL('../src/assets/adhkar-pages.json', import.meta.url);

const SOURCES = {
  morning: 'https://www.islambook.com/azkar/1/%D8%A3%D8%B0%D9%83%D8%A7%D8%B1-%D8%A7%D9%84%D8%B5%D8%A8%D8%A7%D8%AD',
  evening: 'https://www.islambook.com/azkar/2/%D8%A3%D8%B0%D9%83%D8%A7%D8%B1-%D8%A7%D9%84%D9%85%D8%B3%D8%A7%D8%A1',
};

/** Harakat and the other combining marks, as escapes: a literal class here matches letters. */
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const ARABIC_LETTER = /[ء-غف-ي]/g;

/** Titles whose content is Qur'an, read from the mushaf instead of from this text. */
const QURAN_TITLES = /آية الكرسي|سورة الإخلاص|سورة الفلق|سورة الناس/;

/** Spelled-out counts that appear on the title lines. */
const SPELLED = [
  [/مرة واحدة|مرةً واحدة/, 1],
  [/مرتين/, 2],
  [/ثلاث/, 3],
  [/أربع/, 4],
  [/خمس/, 5],
  [/سبع/, 7],
  [/عشر/, 10],
  [/مائة|مئة/, 100],
];

/**
 * Diacritics per Arabic letter.
 *
 * Vowelled du'a text runs well above 0.3; an unvowelled sentence sits at zero.
 * The gap is wide enough that the exact threshold does not matter much, which is
 * what makes this a safe rule rather than a clever one.
 */
function vowelDensity(line) {
  const letters = (line.match(ARABIC_LETTER) ?? []).length;
  if (letters === 0) return 0;
  const marks = (line.match(MARKS) ?? []).length;
  return marks / letters;
}
const VOWELLED = 0.15;

/**
 * A line that is nothing but a restatement of the count: "4 مرات.",
 * "10 مرات في المساء.".
 *
 * No \b anywhere: it is an ASCII word boundary and never matches after an Arabic
 * letter, which is why the first version of this let every restatement through
 * into the notes.
 */
const isCountOnly = (line) =>
  /^[(\s]*\d{1,3}\s*(?:مرات|مرة)(?:\s+(?:في|فى)\s+\S+)?[\s.)]*$/.test(line.trim());

const arabicCount = (title) => {
  const digits = /(\d{1,3})\s*(?:مرات|مرة)/.exec(title);
  if (digits !== null) return Number(digits[1]);
  for (const [pattern, n] of SPELLED) if (pattern.test(title)) return n;
  return 1;
};

/**
 * The du'as already sliced verbatim out of Bukhari and Muslim, with their numbers.
 *
 * Several supplied items are the same du'a. Where the wording overlaps strongly
 * enough to be certain, the citation is carried across, so the screen can say
 * "Sahih Muslim 6740" instead of only naming a website. The threshold is
 * deliberately high and every match is logged: a wrong hadith number is worse
 * than no hadith number.
 */
const CITE_THRESHOLD = 0.7;

const fold = (value) =>
  value
    .replace(MARKS, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0621-\u064A\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const known = JSON.parse(readFileSync(new URL('../src/assets/adhkar.json', import.meta.url), 'utf8')).adhkar;

/**
 * Agreement between two texts, BOTH ways: shared words over all words.
 *
 * A one-directional measure — "how much of the known du'a appears in the supplied
 * one" — got this wrong on the first run. "أصبحنا وأصبح الملك لله" contains the
 * whole of Muslim 6677 ("لا إله إلا الله وحده...") as a fragment, so it scored
 * 100% and was about to be labelled with the wrong hadith. Every short du'a is a
 * perfect match for a long one that quotes it. Symmetry is what makes the
 * question "are these the same du'a" rather than "does one contain the other".
 */
function overlap(knownText, suppliedText) {
  const a = new Set(fold(knownText).split(' ').filter((w) => w.length > 1));
  const b = new Set(fold(suppliedText).split(' ').filter((w) => w.length > 1));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

function citationFor(suppliedText, log) {
  let best = null;
  for (const entry of known) {
    for (const line of entry.lines) {
      const score = overlap(line, suppliedText);
      if (best === null || score > best.score) best = { score, entry };
    }
  }
  if (best === null || best.score < CITE_THRESHOLD) return null;
  const h = best.entry.hadith;
  log.push(
    `    cite ${(best.score * 100).toFixed(0)}%  ${h.collection === 1 ? 'Bukhari' : 'Muslim'} ${h.number}  <- ${suppliedText.slice(0, 40)}`,
  );
  return { collection: h.collection, number: h.number, arabic: h.arabic, narrator: h.narrator, english: h.english };
}

const raw = readFileSync(IN, 'utf8').replace(/\r/g, '');
const lines = raw.split('\n');

/** Split the file at the evening heading. */
const eveningAt = lines.findIndex((l, i) => i > 0 && /^أذكار المساء\s*$/.test(l.trim()));
if (eveningAt < 0) throw new Error('no "أذكار المساء" heading — cannot tell the two halves apart');

const halves = {
  morning: lines.slice(0, eveningAt),
  evening: lines.slice(eveningAt),
};

const payload = {};
const report = [];

for (const [time, body] of Object.entries(halves)) {
  const items = [];
  let current = null;
  const dropped = [];

  const flush = () => {
    if (current === null) return;
    if (QURAN_TITLES.test(current.title)) {
      dropped.push(current.title);
      current = null;
      return;
    }
    const text = current.dhikr.join(' ').replace(/\s+/g, ' ').trim();
    if (text.length < 8) {
      dropped.push(`${current.title} (no vowelled text found)`);
      current = null;
      return;
    }
    items.push({
      id: `${time}-${items.length + 1}`,
      titleAr: current.title,
      repeat: current.repeat,
      lines: [text],
      note: current.notes.length > 0 ? current.notes.join(' ') : null,
      hadith: citationFor(text, report),
    });
    current = null;
  };

  for (const line of body) {
    const heading = /^(\d{1,2})\.\s*(.+)$/.exec(line.trim());
    if (heading !== null) {
      flush();
      const title = heading[2].trim();
      current = {
        // the count lives on the title line; strip it off the displayed title
        title: title.replace(/\s*[—–-]\s*(?:\d{1,3}\s*)?(?:مرات|مرة|مرتين).*$/, '').trim(),
        repeat: arabicCount(title),
        dhikr: [],
        notes: [],
      };
      continue;
    }
    if (current === null) continue;
    const text = line.trim();
    if (text.length === 0) continue;
    if (isCountOnly(text)) continue;
    if (vowelDensity(text) >= VOWELLED) current.dhikr.push(text);
    else current.notes.push(text);
  }
  flush();

  payload[time] = { source: SOURCES[time], items };
  report.push(`${time}: ${items.length} items, ${dropped.length} dropped`);
  for (const d of dropped) report.push(`    dropped: ${d}`);
}

writeFileSync(OUT, `${JSON.stringify(payload, null, 1)}\n`);
console.log(report.join('\n'));
console.log('');
for (const [time, set] of Object.entries(payload)) {
  console.log(`--- ${time} ---`);
  for (const item of set.items) {
    console.log(`x${String(item.repeat).padEnd(4)} ${item.titleAr}`);
    console.log(`      ${item.lines[0].slice(0, 72)}`);
    if (item.note !== null) console.log(`      note: ${item.note.slice(0, 72)}`);
  }
}
