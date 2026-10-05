/**
 * Folding Arabic for search: matching what a reader types against what the text
 * holds.
 *
 * Shared by every search box in the app — hadith, surahs, reciters — because
 * they all meet the same reader. Nobody types harakat on a phone, most people
 * leave the hamza off its seat (الاسراء, اسماعيل), and an Arabic keyboard types
 * its own digits. A search that only finds the exact spelling of the data finds
 * nothing for most of the people using it.
 *
 * Deliberately simple and separate from the recitation matcher's normalisation:
 * this is a text filter, not the aligner, and it must keep digits and Latin
 * letters, which the aligner throws away.
 */

/**
 * Harakat, Quranic annotation marks, the dagger alif and tatweel: what the text
 * is full of and the reader will not type. Arabic-Indic digits (U+0660–0669)
 * sit just past this range and are deliberately NOT in it.
 */
const MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

/** Strip the marks and normalise the letters that vary in spelling. */
export function foldArabic(value: string): string {
  return value
    .replace(MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ء/g, '');
}

/** ١٨ and ۱۸ are 18: an Arabic keyboard types its own digits. */
export function asciiDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Every spelling foldArabic() turns into a given letter. A letter with no entry
 * folds only to itself.
 */
const SPELLINGS: Readonly<Record<string, string>> = {
  'ا': 'اأإآٱ',
  'ي': 'يىئ',
  'و': 'وؤ',
  'ه': 'هة',
};

/** What foldArabic() deletes outright: the marks, and the hamza on the line. */
const DELETED = '(?:[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED\\u0640\\u0621])*';

const escapeRegExp = (ch: string): string => ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * A pattern that finds a needle in text that has NOT been folded.
 *
 * `foldedPattern(q).test(text)` gives the same answer as
 * `foldArabic(text).includes(foldArabic(q))`, without building a folded copy of
 * the text. That copy is the expensive part of a search: seven passes and a
 * fresh string per hadith, for fourteen thousand hadith, on every search. The
 * pattern instead lets each letter of the needle stand for every spelling that
 * folds to it, and lets anything folding deletes sit between two letters.
 *
 * Null for a needle that folds to nothing, which would otherwise match
 * everything.
 */
export function foldedPattern(needle: string): RegExp | null {
  const letters = [...foldArabic(needle)];
  if (letters.length === 0) return null;
  const source = letters
    .map((ch) => {
      const spellings = SPELLINGS[ch];
      return spellings === undefined ? escapeRegExp(ch) : `[${spellings}]`;
    })
    .join(DELETED);
  return new RegExp(source);
}
