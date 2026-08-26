/**
 * Build src/assets/adhkar.json — the morning and evening adhkar.
 *
 * THE RULE THIS SCRIPT EXISTS TO ENFORCE: not one Arabic character in the adhkar
 * screen is typed by hand. Every line is a verbatim slice of a hadith that is
 * already bundled in this app, located by anchor, and the English under it is
 * that hadith's own bundled translation. Sacred text written from memory is how
 * a du'a app ends up teaching people a du'a that was never said, and no amount
 * of care while typing prevents it — only refusing to type it does.
 *
 * The mechanism: these translations wrap the Prophet's words in double quotes, so
 * the odd-indexed parts of text.split('"') are the quoted spans. An entry names a
 * hadith, which of its spans to take, and optionally where inside the span the
 * du'a itself starts and ends. Everything else — the isnad, "he who says this
 * shall...", the narrative around it — is dropped by construction rather than by
 * judgement.
 *
 * Anything that cannot be sourced this way is NOT in the file. Several
 * well-known morning adhkar come from Abu Dawud, at-Tirmidhi and an-Nasa'i, which
 * this app does not bundle; they are absent rather than approximated, and
 * docs/hadith.md lists them.
 *
 * Run: npm run gen:adhkar
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ASSETS = new URL('../src/assets/', import.meta.url);

/** Diacritics and tatweel, as escapes. A literal class here silently matches letters. */
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
/** Bidi controls the source text sprinkles around its quotation marks. */
const BIDI = /[‎‏؜]/g;

function fold(value) {
  return value
    .replace(MARKS, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

// Guard the fold itself: the version of this class written with literal
// characters matches every Arabic letter, which would make every anchor below
// match everywhere and produce silent nonsense.
if (fold('اللَّهُمَّ أَنْتَ') !== 'اللهم انت') {
  throw new Error('fold() is broken — it is not stripping only the marks');
}

/**
 * Fold a string while remembering where each surviving character came from, so an
 * anchor found in folded space can be cut out of the original text with its
 * tashkeel intact.
 */
function foldWithMap(value) {
  let out = '';
  const origin = [];
  let lastWasSpace = true;
  for (let i = 0; i < value.length; i++) {
    let ch = value[i];
    if (MARKS.test(ch)) { MARKS.lastIndex = 0; continue; }
    MARKS.lastIndex = 0;
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      out += ' ';
      origin.push(i);
      lastWasSpace = true;
      continue;
    }
    lastWasSpace = false;
    ch = fold(ch) || ch;
    out += ch;
    origin.push(i);
  }
  // trailing space would make an end anchor land past the text
  while (out.endsWith(' ')) { out = out.slice(0, -1); origin.pop(); }
  return { folded: out, origin };
}

/** Quoted spans, cleaned of bidi marks and the "‏.‏" separators around them. */
function quotedSpans(text) {
  return text.split('"').map((part, i) => ({
    index: i,
    quoted: i % 2 === 1,
    text: part.replace(BIDI, '').replace(/\s+/g, ' ').trim(),
  }));
}

/**
 * Cut `from`..`to` (both folded anchors, inclusive) out of `text`, keeping the
 * original vowelling. Missing anchors are a hard error: a silently un-trimmed
 * du'a would put "he who says this shall enter Paradise" into the du'a itself.
 */
function slice(text, from, to, label) {
  const { folded, origin } = foldWithMap(text);
  let start = 0;
  let end = text.length;
  if (from !== undefined) {
    const at = folded.indexOf(fold(from));
    if (at < 0) throw new Error(`${label}: start anchor not found: ${from}`);
    start = origin[at];
  }
  if (to !== undefined) {
    const needle = fold(to);
    const at = folded.lastIndexOf(needle);
    if (at < 0) throw new Error(`${label}: end anchor not found: ${to}`);
    end = origin[at + needle.length - 1] + 1;
    // carry any trailing marks on the final letter
    while (end < text.length && MARKS.test(text[end])) { MARKS.lastIndex = 0; end++; }
    MARKS.lastIndex = 0;
  }
  if (end <= start) throw new Error(`${label}: anchors are in the wrong order`);
  return text.slice(start, end).replace(BIDI, '').replace(/\s+/g, ' ').trim();
}

/**
 * The adhkar. `spans` are indices into quotedSpans(); `from`/`to` trim the first
 * and last of them. Titles and notes are English, deliberately: an Arabic label I
 * wrote would be the one piece of Arabic on the screen with no source.
 */
const ENTRIES = [
  {
    id: 'sayyid-al-istighfar',
    time: 'both',
    repeat: 1,
    titleEn: 'The best way of asking forgiveness',
    source: { collection: 1, chapter: 80, number: 6069 },
    spans: [1],
    from: 'اللهم انت ربي',
    note: 'The hadith promises Paradise to whoever says it by day or by night, believing in it, and dies before the next.',
  },
  {
    id: 'tawhid-hundred',
    time: 'both',
    repeat: 100,
    titleEn: 'Declaring the oneness of Allah, a hundred times',
    source: { collection: 2, chapter: 48, number: 6677 },
    spans: [1],
    from: 'لا اله الا الله وحده',
    to: 'قدير',
  },
  {
    id: 'kalimat-tammat',
    time: 'both',
    repeat: 3,
    titleEn: 'Seeking refuge in the perfect words of Allah',
    source: { collection: 2, chapter: 48, number: 6711 },
    spans: [1],
    from: 'اعوذ بكلمات الله التامات',
    to: 'ما خلق',
  },
  {
    id: 'laka-aslamtu',
    time: 'both',
    repeat: 1,
    titleEn: 'Surrendering to Allah and seeking refuge in His might',
    source: { collection: 2, chapter: 48, number: 6731 },
    spans: [1],
  },
  {
    id: 'hamm-wal-hazan',
    time: 'both',
    repeat: 1,
    titleEn: 'Seeking refuge from worry, grief and debt',
    source: { collection: 1, chapter: 80, number: 6126 },
    spans: [3],
  },
  {
    id: 'adad-khalqih',
    time: 'morning',
    repeat: 3,
    titleEn: 'Four words that outweigh a morning of remembrance',
    source: { collection: 2, chapter: 48, number: 6745 },
    spans: [3],
    from: 'سبحان الله وبحمده',
    note: 'Said by the Prophet after the dawn prayer, and he told Juwayriya it outweighed everything she had recited since morning.',
  },
  {
    id: 'asbahna',
    time: 'morning',
    repeat: 1,
    titleEn: 'On entering the morning',
    source: { collection: 2, chapter: 48, number: 6740 },
    spans: [5],
    note: 'The narration gives the morning wording only this far and then abbreviates; the evening entry below carries the rest of the same supplication.',
  },
  {
    id: 'amsayna',
    time: 'evening',
    repeat: 1,
    titleEn: 'On entering the evening',
    source: { collection: 2, chapter: 48, number: 6740 },
    spans: [1, 3],
    note: 'The second line is the narrator’s addition: he said he thought these words were among them.',
  },
];

const books = {
  1: JSON.parse(readFileSync(new URL('hadith-1.json', ASSETS), 'utf8')),
  2: JSON.parse(readFileSync(new URL('hadith-2.json', ASSETS), 'utf8')),
};

const out = ENTRIES.map((entry) => {
  const { collection, chapter, number } = entry.source;
  const row = books[collection].find((r) => r[0] === chapter && r[1] === number);
  if (row === undefined) throw new Error(`${entry.id}: no hadith ${collection}/${chapter}/${number}`);

  const spans = quotedSpans(row[2]);
  const lines = entry.spans.map((index, i) => {
    const span = spans[index];
    if (span === undefined || !span.quoted || span.text.length === 0) {
      throw new Error(`${entry.id}: span ${index} is not a non-empty quoted span`);
    }
    const first = i === 0;
    const last = i === entry.spans.length - 1;
    return slice(span.text, first ? entry.from : undefined, last ? entry.to : undefined, entry.id);
  });

  for (const line of lines) {
    if (line.length < 12) throw new Error(`${entry.id}: suspiciously short line "${line}"`);
    if (line.includes('"')) throw new Error(`${entry.id}: a quote mark survived into "${line}"`);
    // The isnad always names a transmitter with حدثنا/أخبرنا; none may leak in.
    if (/حَدَّثَنَا|أَخْبَرَنَا|حَدَّثَنِي/.test(line)) {
      throw new Error(`${entry.id}: chain of narration leaked into the du'a`);
    }
  }

  return {
    id: entry.id,
    time: entry.time,
    repeat: entry.repeat,
    titleEn: entry.titleEn,
    note: entry.note ?? null,
    lines,
    /** the whole hadith, verbatim, so the source can be read in the app */
    hadith: {
      collection,
      chapter,
      number,
      arabic: row[2],
      narrator: row[3] ?? '',
      english: row[4] ?? '',
    },
  };
});

const ids = new Set(out.map((d) => d.id));
if (ids.size !== out.length) throw new Error('duplicate adhkar id');

writeFileSync(new URL('adhkar.json', ASSETS), `${JSON.stringify({ adhkar: out }, null, 1)}\n`);

console.log(`adhkar.json: ${out.length} entries`);
for (const d of out) {
  const times = d.time.padEnd(7);
  console.log(`  ${d.id.padEnd(22)} ${times} x${String(d.repeat).padEnd(4)} ${d.lines.length} line(s)  ${d.lines[0].slice(0, 60)}`);
}
