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
 *                    emits as separate tokens.
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
 * Canonical tokenizer for mushaf text. Guarantees
 * `display.length === normalized.length` and that no normalized token is
 * empty, by fusing a token that normalizes to nothing into its neighbour
 * (quran-json splits `فَٱدَّـٰرَ ٰٔتُمۡ` in 2:72 that way).
 */
export function tokenizeAyah(text: string): AyahTokens {
  const raw = text.split(/\s+/).filter((t) => t.length > 0);
  const display: string[] = [];
  const normalized: string[] = [];
  for (const token of raw) {
    const n = normalizeWord(token);
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
export function normalizeAyah(text: string): string[] {
  return tokenizeAyah(text).normalized;
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
  if (!raw) return [];
  const parts = raw
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length > 0);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const next = parts[i + 1];
    const fusable = p === ARTICLE || (p.length === 1 && PROCLITICS.includes(p));
    if (fusable && next !== undefined) {
      const fused = p + next;
      const fusedIsWord = vocab === undefined || vocab.has(fused);
      const splitIsWord = vocab !== undefined && vocab.has(p) && vocab.has(next);
      if (fusedIsWord || !splitIsWord) {
        out.push(fused);
        i++;
        continue;
      }
    }
    out.push(p);
  }
  return out;
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
