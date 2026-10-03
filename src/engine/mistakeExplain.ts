/**
 * Turns a flagged word into something a reciter can act on.
 *
 * The review sheet used to show the expected word and "heard: X". A reciter
 * reading that has to work out for themselves whether X was their attempt at
 * the word, something from elsewhere in the ayah, or noise. The answer was
 * often the second, and that made the sheet useless. So this says three
 * things plainly:
 *
 *   1. WHAT KIND of mistake it was: the word was skipped, or another word was
 *      said in its place.
 *   2. WHICH LETTERS differ, when the two spellings are close enough for that
 *      to be meaningful. "You left out ه" teaches something. A letter diff
 *      between two unrelated words invents findings, so none is given.
 *   3. WHETHER THE PHONE IS THE LIKELIER CULPRIT. Android's Arabic model
 *      cannot reliably tell ص from س or ذ from ز. Telling somebody they
 *      mispronounced a letter the recognizer cannot hear would be a lie, so
 *      those cases say so and point at "I said it right".
 *
 * Works on the normalized spellings (no diacritics), which is what the
 * recognizer produces and what can honestly be compared.
 */
import { sharesClass, traceback } from './confusion';
import { weightedDistance } from './distance';
import { translate, type T } from '../i18n/i18n';

export type LetterHint =
  /** letters in the word that were not said */
  | { type: 'missing'; letters: string }
  /** letters said that are not in the word */
  | { type: 'extra'; letters: string }
  /** one letter said as another */
  | { type: 'swapped'; said: string; should: string };

export interface MistakeExplanation {
  kind: 'skipped' | 'wrong';
  /** what was said in the word's place, '' when skipped */
  heard: string;
  /** the letter-level difference, when there is a small, clear one */
  hint: LetterHint | null;
  /** the difference is one the recognizer itself commonly gets wrong */
  likelyRecognizer: boolean;
}

/** Beyond this share of the word differing, a letter diff means nothing. */
const HINT_LIMIT = 0.5;
/** More differing letters than this is no longer "one slip". */
const MAX_HINT_LETTERS = 2;
const LONG_VOWELS = 'اوي';

export function explainMistake(expected: string, heard: string): MistakeExplanation {
  if (heard.length === 0) {
    return { kind: 'skipped', heard: '', hint: null, likelyRecognizer: false };
  }
  const wrong = (hint: LetterHint | null, likelyRecognizer = false): MistakeExplanation => ({
    kind: 'wrong',
    heard,
    hint,
    likelyRecognizer,
  });
  if (expected.length === 0 || heard === expected) return wrong(null);

  const maxLen = Math.max(expected.length, heard.length);
  if (weightedDistance(expected, heard) / maxLen > HINT_LIMIT) return wrong(null);

  let missing = '';
  let extra = '';
  const swaps: { said: string; should: string }[] = [];
  for (const op of traceback(expected, heard)) {
    if (op.kind === 'match') continue;
    if (op.kind === 'sub') swaps.push({ said: op.heard, should: op.expected });
    else if (op.expected !== '') missing += op.expected;
    else extra += op.heard;
  }

  const kinds = (missing ? 1 : 0) + (extra ? 1 : 0) + (swaps.length > 0 ? 1 : 0);
  if (kinds !== 1) return wrong(null);

  if (swaps.length === 1) {
    const [swap] = swaps;
    return wrong({ type: 'swapped', ...swap }, sharesClass(swap.said, swap.should));
  }
  if (swaps.length > 0) return wrong(null);

  const letters = missing || extra;
  if (letters.length > MAX_HINT_LETTERS) return wrong(null);
  // A dropped or added long vowel is a madd the recognizer routinely loses.
  const onlyMadd = [...letters].every((ch) => LONG_VOWELS.includes(ch));
  return wrong(missing ? { type: 'missing', letters } : { type: 'extra', letters }, onlyMadd);
}

/** The hint as one sentence, with the Arabic letters in guillemets. */
export function describeHint(hint: LetterHint, t: T = (s, p) => translate('en', s, p)): string {
  const spaced = (s: string) => [...s].join(' ');
  switch (hint.type) {
    case 'missing':
      return hint.letters.length === 1
        ? t('You left out the letter «{letter}».', { letter: hint.letters })
        : t('You left out the letters «{letters}».', { letters: spaced(hint.letters) });
    case 'extra':
      return hint.letters.length === 1
        ? t('You added a «{letter}» that is not in the word.', { letter: hint.letters })
        : t('You added «{letters}», which are not in the word.', { letters: spaced(hint.letters) });
    case 'swapped':
      return t('You said «{said}» where the word has «{should}».', { said: hint.said, should: hint.should });
  }
}
