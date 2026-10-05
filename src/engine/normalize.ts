/**
 * Arabic / Quranic text normalization (spec §5.1).
 *
 * SINGLE source of truth: the build-time generators in scripts/ import this
 * file directly through Node's type-stripping loader, so the bundled word
 * array and the runtime matcher can never disagree. Keep the syntax erasable
 * (no enums / namespaces) or the generators stop being able to load it.
 *
 * There are deliberately TWO tokenizers:
 *
 *   tokenizeAyah()   canonical mushaf text. Strictly 1:1 with the displayed
 *                    tokens, because the renderer paints per-word state by
 *                    index. Never merges the definite article.
 *   normalizeHeard() recognizer output. Merges the detached definite article
 *                    and single-letter proclitics that Android's recognizer
 *                    emits as separate tokens. normalizeHeardSpans() does the
 *                    same and also keeps each token's original spelling, which
 *                    is what the screen shows.
 *
 * Merging in the canonical path was a real bug: `ءَالِ` ("family of")
 * normalizes to `ال`, and collapsing it swallowed the following word in 23
 * ayahs (2:49, 3:11, 8:54, ...), desynchronising display words from cursor
 * words.
 */

/** Combining marks: harakat, tanwin, Quranic annotation and pause marks. */
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ​-‏⁠﻿]/g;

/** Everything that is not a bare Arabic letter or a space. */
const NON_ARABIC = /[^ء-غف-يٱ-ە ]/g;

const FOLD: Record<string, string> = {
  'آ': 'ا', // آ -> ا
  'أ': 'ا', // أ -> ا
  'إ': 'ا', // إ -> ا
  'ٱ': 'ا', // ٱ alef wasla -> ا
  'ٲ': 'ا',
  'ٳ': 'ا',
  'ٵ': 'ا',
  'ؤ': 'و', // ؤ -> و
  'ئ': 'ي', // ئ -> ي
  'ى': 'ي', // ى -> ي
  'ی': 'ي', // ی -> ي
  'ة': 'ه', // ة -> ه
  'ہ': 'ه',
  'ک': 'ك', // ک -> ك
  'ء': '', // ء dropped
};

/** Normalize one token. Returns '' when nothing survives (marks-only token). */
export function normalizeWord(raw: string): string {
  if (!raw) return '';
  const stripped = raw.replace(MARKS, '');
  let out = '';
  for (const ch of stripped) {
    const f = FOLD[ch];
    out += f === undefined ? ch : f;
  }
  return out.replace(NON_ARABIC, '');
}

export interface AyahTokens {
  /** display tokens, exactly as they should be painted, in order */
  display: string[];
  /** normalized tokens; normalized[i] always corresponds to display[i] */
  normalized: string[];
}

/**
 * Places where the source text joins two words that every Uthmani mushaf writes
 * SEPARATELY: `[surah, ayah, tokenIndex, splitAfterCodeUnits]`.
 *
 * All four are the same phenomenon — مَا or لَوْ fused to what follows — and all
 * four matter twice over. For the reciter they are two spoken words, so a joined
 * expectation could never match what the recognizer emits and would have logged a
 * false mistake every time. For the mushaf they are two positions on a line, so a
 * joined word left the word array one token short of the printed page, four times
 * over, which is exactly the drift the QUL layout analysis surfaced.
 *
 * Offsets were derived, not hand-counted: each is the unique split whose halves
 * normalize to the two expected forms and whose second half does not begin with a
 * combining mark. `npm run gen` re-derives and re-checks them.
 */
const SOURCE_SPLITS: readonly [number, number, number, number][] = [
  [15, 7, 0, 5], // لَّوۡمَا   -> لَّوۡ + مَا
  [27, 20, 3, 3], // مَالِيَ    -> مَا + لِيَ
  [36, 22, 0, 5], // وَمَالِيَ  -> وَمَا + لِيَ
  [41, 47, 24, 3], // مَامِنَّا  -> مَا + مِنَّا
];

/**
 * Apply the split table to one ayah's raw tokens. Identity for every ayah that
 * is not in the table, which is 6,232 of the 6,236.
 */
function applySourceSplits(surah: number, ayah: number, tokens: string[]): string[] {
  let out = tokens;
  for (const [s, a, index, at] of SOURCE_SPLITS) {
    if (s !== surah || a !== ayah) continue;
    const token = out[index];
    if (token === undefined || at <= 0 || at >= token.length) continue;
    out = [...out.slice(0, index), token.slice(0, at), token.slice(at), ...out.slice(index + 1)];
  }
  return out;
}

/** A word cannot begin with a combining mark, so such a token continues the previous one. */
const STARTS_WITH_MARK = /^[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/;

/**
 * Canonical tokenizer for mushaf text. Guarantees
 * `display.length === normalized.length` and that no normalized token is empty.
 *
 * Two fusion rules, both about the SOURCE splitting one word across a space:
 *
 *  - a token that normalizes to nothing belongs to its neighbour;
 *  - a token that BEGINS WITH A COMBINING MARK continues the previous word,
 *    because no Arabic word can start with one. quran-json writes 2:72's
 *    فَٱدَّٰرَٰٔتُمۡ as `فَٱدَّـٰرَ` + `ٰٔتُمۡ`, and the second piece normalizes to
 *    a perfectly ordinary-looking `تم` — so without this rule the matcher
 *    expects the reciter to say two words where there is one, and the word array
 *    disagrees with every printed mushaf by one token.
 */
export function tokenizeAyah(text: string, surah = 0, ayah = 0): AyahTokens {
  const raw = applySourceSplits(surah, ayah, text.split(/\s+/).filter((t) => t.length > 0));
  const display: string[] = [];
  const normalized: string[] = [];
  for (const token of raw) {
    const n = normalizeWord(token);
    if (n !== '' && display.length > 0 && STARTS_WITH_MARK.test(token)) {
      display[display.length - 1] += token;
      normalized[normalized.length - 1] = normalizeWord(
        display[display.length - 1],
      );
      continue;
    }
    if (n === '') {
      if (display.length > 0) {
        // fuse backwards into the previous word
        display[display.length - 1] += token;
        continue;
      }
      // nothing to fuse into yet: hold it for the next token
      display.push(token);
      normalized.push('');
      continue;
    }
    if (normalized.length > 0 && normalized[normalized.length - 1] === '') {
      display[display.length - 1] += ' ' + token;
      normalized[normalized.length - 1] = n;
      continue;
    }
    display.push(token);
    normalized.push(n);
  }
  return { display, normalized };
}

/** Just the normalized words of an ayah, in order. */
export function normalizeAyah(text: string, surah = 0, ayah = 0): string[] {
  return tokenizeAyah(text, surah, ayah).normalized;
}

const PROCLITICS = 'وفبلك'; // و ف ب ل ك
const ARTICLE = 'ال'; // ال

/**
 * Tokenizer for recognizer output (spec §5.1, "collapse the definite
 * article's spacing variants").
 *
 * `vocab`, when supplied, disambiguates: a detached `ال` is only fused when
 * the fused form actually exists in the Quran's vocabulary, or when the split
 * form does not. That keeps `ءال فرعون` ("the family of Pharaoh", heard as
 * `ال فرعون`) from being mangled into `الفرعون`.
 */
export function normalizeHeard(raw: string, vocab?: ReadonlySet<string>): string[] {
  return normalizeHeardSpans(raw, vocab).tokens;
}

/** Everything that is not an Arabic letter: harakat, tatweel, digits, Latin, punctuation. */
const NOT_A_LETTER = /[^ء-غف-يٱ-ە]/g;

/**
 * A recognizer token as a person should READ it: the letters it was written
 * with, hamza seats, ة and ى included, minus anything that is not a letter.
 *
 * normalizeWord() folds أ/ؤ/ئ/ة/ى away because the matcher must not care how
 * the recognizer spelled a hamza. A reader does care. Shown "فيران" for what the
 * phone wrote as "فئران", or "علي" for "على", an Arabic reader sees an app that
 * cannot spell — the folded form is for comparing, never for showing.
 */
export function readableSpelling(raw: string): string {
  return raw.replace(NOT_A_LETTER, '');
}

export interface HeardSpans {
  /** normalized tokens, exactly what normalizeHeard() returns */
  tokens: string[];
  /** raw[i] is how the recognizer spelled tokens[i], for display only */
  raw: string[];
}

/**
 * The detached comparative ما (spec §5.1). The mushaf writes بَعۡدَ مَا and
 * مِثۡلَ مَا as two words, 44 times; a recognizer writes the modern بعدما, which
 * is not a Quran word, so it matched neither half and both were flagged wrong.
 *
 * Only split when the joined form is NOT in the vocabulary (كلما and انما are,
 * and stay whole) and the stem IS. A stem ending in ه or ك is a pronoun (ربهما,
 * عليكما): those are one word whatever the vocabulary says.
 */
function splitDetachedMa(token: string, vocab: ReadonlySet<string> | undefined): [string, string] | null {
  if (vocab === undefined || token.length < 4 || !token.endsWith('ما') || vocab.has(token)) return null;
  const stem = token.slice(0, -2);
  if (stem.endsWith('ه') || stem.endsWith('ك') || !vocab.has(stem)) return null;
  return [stem, 'ما'];
}

/**
 * normalizeHeard(), keeping track of how each normalized token was SPELLED.
 *
 * The mapping is many-to-one but monotone: a raw token that normalizes to
 * nothing (digits, Latin, a lone ء) is dropped, and a fused proclitic or
 * article is the two raw tokens written together, which is how Arabic writes
 * them anyway.
 */
export function normalizeHeardSpans(raw: string, vocab?: ReadonlySet<string>): HeardSpans {
  if (!raw) return { tokens: [], raw: [] };
  const parts: string[] = [];
  const src: string[] = [];
  for (const piece of raw.split(/\s+/)) {
    const n = normalizeWord(piece);
    if (n.length === 0) continue;
    parts.push(n);
    src.push(readableSpelling(piece) || n);
  }
  const tokens: string[] = [];
  const spelled: string[] = [];
  const push = (token: string, spelling: string): void => {
    const split = splitDetachedMa(token, vocab);
    if (split === null) {
      tokens.push(token);
      spelled.push(spelling);
      return;
    }
    // The spelling splits the same way when it ends in the same two letters,
    // which it does unless the recognizer wrote something exotic.
    const rawSplit = spelling.endsWith('ما') ? [spelling.slice(0, -2), 'ما'] : split;
    tokens.push(split[0], split[1]);
    spelled.push(rawSplit[0], rawSplit[1]);
  };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const next = parts[i + 1];
    const fusable = p === ARTICLE || (p.length === 1 && PROCLITICS.includes(p));
    if (fusable && next !== undefined) {
      const fused = p + next;
      const fusedIsWord = vocab === undefined || vocab.has(fused);
      const splitIsWord = vocab !== undefined && vocab.has(p) && vocab.has(next);
      if (fusedIsWord || !splitIsWord) {
        push(fused, src[i] + src[i + 1]);
        i++;
        continue;
      }
    }
    push(p, src[i]);
  }
  return { tokens, raw: spelled };
}

/**
 * The isti'adha, normalized, in its two common forms: أعوذ بالله من الشيطان
 * الرجيم, and أعوذ بالله السميع العليم من الشيطان الرجيم. Both spellings of
 * الشيطان are listed — the mushaf's الشيطن and the recognizer's الشيطان.
 */
const ISTIADHA: readonly (readonly string[])[] = [
  ['اعوذ'],
  ['بالله'],
  ['السميع'],
  ['العليم'],
  ['من'],
  ['الشيطان', 'الشيطن'],
  ['الرجيم'],
];

/**
 * How many leading heard tokens are the isti'adha (spec §5.5), 0 when it is not
 * there.
 *
 * Almost every reciter opens with it, and it is not part of the surah. Left in,
 * "أعوذ بالله" localized to 2:67 (قال أعوذ بالله أن أكون), the one ayah where
 * those words are Quran, and the page flipped to Al-Baqarah from wherever the
 * reciter was. Three in-order words, starting with أعوذ AT THE FIRST TOKEN, are
 * required: an utterance that resumes mid-2:67 ("أعوذ بالله أن أكون") stops at
 * two, and 113:1 ("أعوذ برب الفلق") at one, so the Quran's own أعوذ is never
 * taken for the formula.
 */
export function leadingIstiadhaLength(heard: readonly string[]): number {
  if (heard[0] !== 'اعوذ') return 0;
  let i = 0;
  let last = -1;
  while (i < heard.length) {
    const at = ISTIADHA.findIndex((forms) => forms.includes(heard[i]));
    if (at === -1 || at <= last) break;
    last = at;
    i++;
  }
  return i >= 3 ? i : 0;
}

export function stripLeadingIstiadha(heard: readonly string[]): string[] {
  return heard.slice(leadingIstiadhaLength(heard));
}

/** صدق الله العظيم, said by many reciters when they finish. Not Quran text. */
const CLOSING: readonly string[] = ['صدق', 'الله', 'العظيم'];

/**
 * How many trailing heard tokens are the closing صدق الله العظيم.
 *
 * On a FINAL only the whole formula is stripped: "صدق الله" IS Quran (3:95, with
 * a pause mark right after it), and a reciter stopping there must be credited.
 * On a PARTIAL the formula's opening is stripped too, because partials paint
 * words and painted words never un-paint: "صدق الله" heard after 67:1 used to
 * walk three words into 67:2. Withholding them from a partial costs nothing —
 * if they were Quran, the next partial or the final has them.
 */
export function trailingClosingLength(heard: readonly string[], partial: boolean): number {
  for (let n = CLOSING.length; n >= (partial ? 1 : CLOSING.length); n--) {
    if (heard.length < n) continue;
    let ok = true;
    for (let k = 0; k < n; k++) {
      if (heard[heard.length - n + k] !== CLOSING[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return n;
  }
  return 0;
}

/** The four normalized words of the basmala, as they appear in 1:1. */
export const BASMALA_WORDS: readonly string[] = ['بسم', 'الله', 'الرحمن', 'الرحيم'];

/**
 * Drop a leading basmala from a heard token list (spec §5.5). Nearly every
 * surah opens with it, so it identifies nothing and must never anchor a jump.
 * Tolerates the reciter starting part-way in (e.g. from `الرحمن`).
 *
 * A transcript that is ONLY the basmala strips to nothing, on purpose. It has
 * to: reciting the basmala on the way into Al-Baqarah would otherwise localize
 * as a jump back to 1:1, which is the single most likely false jump in the app.
 * When the cursor really is at 1:1, local alignment handles the basmala without
 * any help from the localizer.
 */
export function stripLeadingBasmala(heard: readonly string[]): string[] {
  let i = 0;
  let lastAt = -1;
  while (i < heard.length && i < BASMALA_WORDS.length) {
    const at = BASMALA_WORDS.indexOf(heard[i]);
    if (at === -1 || at <= lastAt) break;
    lastAt = at;
    i++;
  }
  if (i >= 2) return heard.slice(i);
  return [...heard];
}
