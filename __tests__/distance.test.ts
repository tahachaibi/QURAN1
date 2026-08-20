import {
  weightedDistance,
  compareWords,
  matchThreshold,
  PHONETIC_CLASSES,
} from '../src/engine/distance';
import { normalizeWord, normalizeHeard, normalizeAyah, tokenizeAyah, stripLeadingBasmala } from '../src/engine/normalize';

describe('normalization (§5.1)', () => {
  it('strips tashkeel and Quranic annotation marks', () => {
    expect(normalizeAyah('بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ')).toEqual([
      'بسم',
      'الله',
      'الرحمن',
      'الرحيم',
    ]);
  });

  it('folds hamza carriers, taa marbuta and alef maqsura', () => {
    expect(normalizeWord('أَحَد')).toBe('احد');
    expect(normalizeWord('إِنَّ')).toBe('ان');
    expect(normalizeWord('آمَنَ')).toBe('امن');
    expect(normalizeWord('ٱلَّذِى')).toBe('الذي');
    expect(normalizeWord('رَحۡمَة')).toBe('رحمه');
    expect(normalizeWord('مُؤۡمِن')).toBe('مومن');
    expect(normalizeWord('شَيۡئًا')).toBe('شييا');
    expect(normalizeWord('شَىۡء')).toBe('شي');
  });

  it('removes non-Arabic characters', () => {
    expect(normalizeWord('الحمد123!')).toBe('الحمد');
    expect(normalizeWord('abcالحمد')).toBe('الحمد');
  });

  it('collapses the detached definite article in recognizer output only', () => {
    // recognizer path: fuse
    expect(normalizeHeard('ال رحمن')).toEqual(['الرحمن']);
    expect(normalizeHeard('و الله')).toEqual(['والله']);
    // canonical path: never fuse, so display tokens stay 1:1 with word indices
    expect(normalizeAyah('ءَالِ فِرۡعَوۡنَ')).toEqual(['ال', 'فرعون']);
  });

  it('uses the vocabulary to avoid mangling ءال (family of)', () => {
    const vocab = new Set(['ال', 'فرعون', 'الرحمن', 'رحمن']);
    expect(normalizeHeard('ال فرعون', vocab)).toEqual(['ال', 'فرعون']);
    expect(normalizeHeard('ال رحمن', vocab)).toEqual(['الرحمن']);
  });

  it('keeps display and normalized tokens 1:1', () => {
    const t = tokenizeAyah('وَإِذۡ قَتَلۡتُمۡ نَفۡسٗا فَٱدَّـٰرَ ٰٔتُمۡ فِيهَاۖ وَٱللَّهُ مُخۡرِجٞ مَّا كُنتُمۡ تَكۡتُمُونَ');
    expect(t.display.length).toBe(t.normalized.length);
    expect(t.normalized.every((w) => w.length > 0)).toBe(true);
  });

  it('strips a leading basmala, including when that is the whole transcript', () => {
    expect(stripLeadingBasmala(['بسم', 'الله', 'الرحمن', 'الرحيم', 'الم', 'ذلك'])).toEqual(['الم', 'ذلك']);
    // an all-basmala transcript strips to nothing: it must never anchor a jump
    expect(stripLeadingBasmala(['بسم', 'الله', 'الرحمن', 'الرحيم'])).toEqual([]);
    expect(stripLeadingBasmala(['الحمد', 'لله'])).toEqual(['الحمد', 'لله']);
  });
});

describe('weighted distance (§5.2)', () => {
  it('MANDATORY REGRESSION: الرحمن and الرحيم never match', () => {
    // Loosening this broke Al-Fatiha in the previous build.
    expect(compareWords('الرحمن', 'الرحيم').ok).toBe(false);
    expect(compareWords('الرحيم', 'الرحمن').ok).toBe(false);
    // and the same for the plene spelling a recognizer often emits
    expect(compareWords('الرحمان', 'الرحمن').ok).toBe(true);
    expect(weightedDistance('الرحمن', 'الرحيم')).toBeGreaterThan(matchThreshold('الرحمن', 'الرحيم'));
  });

  it('costs same-class substitutions 0.5 and cross-class 1', () => {
    expect(weightedDistance('سلم', 'صلم')).toBeCloseTo(0.5); // س/ص same class
    expect(weightedDistance('سلم', 'ملم')).toBeCloseTo(1); // س/م different
  });

  it('costs a long-vowel gap 0.25', () => {
    expect(weightedDistance('قال', 'قل')).toBeCloseTo(0.25);
    expect(weightedDistance('يقول', 'يقل')).toBeCloseTo(0.25);
    expect(weightedDistance('قلم', 'قم')).toBeCloseTo(1); // ل is not a long vowel
  });

  it('is symmetric', () => {
    const pairs: [string, string][] = [
      ['الحمد', 'الحمدو'],
      ['العلمين', 'العالمين'],
      ['نستعين', 'نستعن'],
      ['الصراط', 'السراط'],
    ];
    for (const [a, b] of pairs) {
      expect(weightedDistance(a, b)).toBeCloseTo(weightedDistance(b, a));
    }
  });

  it('requires an exact match for words of length <= 2', () => {
    expect(matchThreshold('من', 'عن')).toBe(0);
    expect(compareWords('من', 'عن').ok).toBe(false);
    expect(compareWords('ما', 'لا').ok).toBe(false);
    expect(compareWords('في', 'في').ok).toBe(true);
  });

  it('accepts the real recognizer confusions we care about', () => {
    // Table of substitutions Android's ar-SA recognizer actually emits for
    // Quranic Arabic. Each of these must be treated as the same word.
    const shouldMatch: [string, string][] = [
      ['العالمين', 'العلمين'], // madd written plene
      ['الصراط', 'السراط'], // ص/س
      ['المستقيم', 'المستكيم'], // ق/ك
      ['نستعين', 'نستعن'], // dropped madd
      ['اهدنا', 'اهدنا'],
      ['مالك', 'ملك'], // مالك/ملك orthography
      ['الضالين', 'الظالين'], // ض/ظ
      ['المغضوب', 'المغظوب'], // ض/ظ
      ['عليهم', 'عليهم'],
      ['الدين', 'الذين'], // د/ذ  (see the guard test below)
      ['تعبدون', 'تعبدون'],
      ['اياك', 'اياك'],
      ['الحمد', 'الحمدو'],
      ['رب', 'رب'],
    ];
    for (const [a, b] of shouldMatch) {
      expect({ a, b, ok: compareWords(a, b).ok }).toEqual({ a, b, ok: true });
    }
  });

  it('still refuses genuinely different words', () => {
    const shouldNotMatch: [string, string][] = [
      ['الرحمن', 'الرحيم'],
      ['نعبد', 'نستعين'],
      ['قل', 'كل'],
      ['الحمد', 'المجد'],
      ['اهدنا', 'ارزقنا'],
      ['نعمل', 'نعبد'],
      ['الصراط', 'الكتاب'],
      ['المستقيم', 'المغضوب'],
    ];
    for (const [a, b] of shouldNotMatch) {
      expect({ a, b, ok: compareWords(a, b).ok }).toEqual({ a, b, ok: false });
    }
  });

  /**
   * The thresholds in §5.2 are the ones the spec dictates, and they are looser
   * at the word level than the spec's own "full of near-minimal pairs" framing
   * suggests: a single cross-class substitution fits inside 1.0 for short words
   * and inside 2.0 up to length 9. These pairs are therefore accepted TODAY.
   *
   * This is pinned rather than silently re-tuned because the aligner is what
   * actually prevents confusion in practice: locked on, it only ever compares a
   * heard word against the next 3 expected words, and none of these pairs are
   * within 3 words of each other anywhere in the Quran. Tightening the numbers
   * belongs in a pass driven by real device transcripts through the replay
   * harness (§9), not by guesswork.
   */
  it('documents the pairs the mandated thresholds do accept', () => {
    const knownPermissive: [string, string][] = [
      ['الحمد', 'الحميد'], // madd insertion is deliberately near-free
      ['اهدنا', 'اهدني'], // ا/ي both long vowels
      ['العالمين', 'الظالمين'], // one cross-class substitution inside 2.0
      ['يوم', 'قوم'], // one cross-class substitution inside 1.0
      ['انعمت', 'انعم'], // one consonant deletion inside 1.0
      ['عليهم', 'عليهن'], // ن/م same class
    ];
    for (const [a, b] of knownPermissive) {
      expect({ a, b, ok: compareWords(a, b).ok }).toEqual({ a, b, ok: true });
    }
  });

  it('has non-overlapping-safe class lookup for every listed letter', () => {
    for (const cls of PHONETIC_CLASSES) {
      for (const ch of cls) {
        for (const other of cls) {
          if (ch === other) continue;
          expect(weightedDistance(ch + 'ثث', other + 'ثث')).toBeCloseTo(0.5);
        }
      }
    }
  });
});
