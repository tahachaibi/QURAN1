/**
 * The review sheet has to tell a reciter what they did wrong, in words.
 *
 * THE COMPLAINT, from the user after real sessions: "the errors shown aren't
 * understandable at all". Replaying their ten sessions showed why. For a
 * skipped اهبطوا (2:36) the sheet said "heard: يا", and that يا came from
 * "يا آدم", two ayahs earlier. For a skipped أندادا (2:22) it said
 * "heard: وا", the tail of a restarted segment. The heard word was simply the
 * first unmatched token anywhere in the utterance. On top of that, the ayah
 * context was printed after-word-before, so it read backwards.
 *
 * Three layers are pinned here: what counts as "said in its place", how a
 * mistake is explained, and what the sheet actually shows.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ReactElement } from 'react';

import { MistakeSheet } from '../src/components/MistakeSheet';
import { ayahByGlobal, ayahDisplayWords, globalAyahOf, wordIndexOf, words } from '../src/data/quran';
import type { AlignResult } from '../src/engine/align';
import { describeHint, explainMistake } from '../src/engine/mistakeExplain';
import type { Mistake } from '../src/engine/mistakes';
import { heardInPlaceOf } from '../src/engine/session';
import { DEFAULT_PREFS } from '../src/data/storage';
import { ThemeContext, type ThemeContextValue } from '../src/theme/themeContext';
import { lightPalette } from '../src/theme/theme';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve(), removeItem: () => Promise.resolve() },
}));

const result = (over: Partial<AlignResult>): AlignResult => ({
  cursor: 0,
  livePos: 0,
  anchor: 0,
  matches: [],
  skipped: [],
  unmatchedHeard: [],
  progress: 0,
  score: 0,
  empty: false,
  ...over,
});
const m = (word: number, heard: number) => ({ word, heard, distance: 0, ratio: 0 });
const text = (i: number) => ['وقلنا', 'اهبطوا', 'بعضكم', 'لبعض', 'قالوا', 'انومن', 'كما'][i] ?? '';

describe('what was said in the word\'s place', () => {
  it('is nothing when the words either side are adjacent in what was heard', () => {
    // "يا ... وقلنا بعضكم": the stray يا sits BEFORE the gap, so it is not the answer
    const heard = ['يا', 'وقلنا', 'بعضكم'];
    const r = result({ matches: [m(0, 1), m(2, 2)], skipped: [1], unmatchedHeard: [0] });
    expect(heardInPlaceOf(heard, r, 1, text)).toBe('');
  });

  it('is the token between the neighbours when there is one', () => {
    const heard = ['وقلنا', 'اهبطو', 'بعضكم'];
    const r = result({ matches: [m(0, 0), m(2, 2)], skipped: [1], unmatchedHeard: [1] });
    expect(heardInPlaceOf(heard, r, 1, text)).toBe('اهبطو');
  });

  it('is the attempt after the last repeat of the previous word', () => {
    // "قالوا وانوا من قالوا هلومن كما": the reciter went back and settled on هلومن
    const heard = ['قالوا', 'وانوا', 'من', 'قالوا', 'هلومن', 'كما'];
    const r = result({ matches: [m(4, 0), m(6, 5)], skipped: [5], unmatchedHeard: [1, 2, 3, 4] });
    expect(heardInPlaceOf(heard, r, 5, text)).toBe('هلومن');
  });

  it('opens with the words that ended the previous utterance when nothing here precedes it', () => {
    // "... هدى للمومنين" | pause | "الذين يومنون": للمتقين is found skipped only now
    const heard = ['الذين', 'يومنون'];
    const r = result({ matches: [m(1, 0), m(2, 1)], skipped: [0], unmatchedHeard: [] });
    const tail = { from: 0, tokens: ['للمومنين'], spelled: ['للمؤمنين'] };
    expect(heardInPlaceOf(heard, r, 0, text)).toBe('');
    expect(heardInPlaceOf(heard, r, 0, text, tail)).toBe('للمومنين');
    // but not for a word the tail was not said in place of
    expect(heardInPlaceOf(heard, r, 0, text, { ...tail, from: 1 })).toBe('');
  });
});

describe('explaining a mistake', () => {
  it('calls a word with nothing in its place skipped', () => {
    expect(explainMistake('اهبطوا', '')).toEqual({ kind: 'skipped', heard: '', hint: null, likelyRecognizer: false });
  });

  it('names a dropped letter', () => {
    // 2:19, from the phone: فيه said as في
    const e = explainMistake('فيه', 'في');
    expect(e.kind).toBe('wrong');
    expect(e.hint).toEqual({ type: 'missing', letters: 'ه' });
    expect(describeHint(e.hint!)).toBe('You left out the letter «ه».');
    expect(e.likelyRecognizer).toBe(false);
  });

  it('names a swapped letter, and owns up when the phone cannot hear the difference', () => {
    const e = explainMistake('الصراط', 'السراط');
    expect(e.hint).toEqual({ type: 'swapped', said: 'س', should: 'ص' });
    expect(describeHint(e.hint!)).toBe('You said «س» where the word has «ص».');
    expect(e.likelyRecognizer).toBe(true);
  });

  it('treats a lost madd as the recognizer\'s likelier fault', () => {
    const e = explainMistake('قالوا', 'قالو');
    expect(e.hint).toEqual({ type: 'missing', letters: 'ا' });
    expect(e.likelyRecognizer).toBe(true);
  });

  it('invents no letter story for words that are simply different', () => {
    // 2:22 from the phone: فراشا heard as فئران (normalized فيران)
    expect(explainMistake('فرشا', 'فيران')).toMatchObject({ kind: 'wrong', heard: 'فيران', hint: null });
    // 2:13: أنؤمن heard as هلؤمن, two letters changed
    expect(explainMistake('انومن', 'هلومن').hint).toBeNull();
  });
});

describe('the review sheet', () => {
  const at = (surah: number, ayah: number, offset: number) => wordIndexOf(surah, ayah) + offset;
  const SKIPPED = at(2, 36, 8); // اهبطوا
  const WRONG = at(2, 19, 4); // فيه, said as في

  function render(
    mistakes: Mistake[],
    focusWord: number | null = null,
    extra: Partial<Parameters<typeof MistakeSheet>[0]> = {},
    wrap: (node: ReactElement) => ReactElement = (node) => node,
  ): ReactTestRenderer {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        wrap(
          <MistakeSheet
            visible
            mistakes={mistakes}
            focusWord={focusWord}
            palette={lightPalette}
            onClose={() => undefined}
            onDismiss={() => undefined}
            onGoToWord={() => undefined}
            onPractise={() => undefined}
            onPlayWord={() => undefined}
            {...extra}
          />,
        ),
      );
    });
    return tree;
  }
  const arabic = (node: ReactElement): ReactElement => {
    const value: ThemeContextValue = {
      palette: lightPalette,
      dark: false,
      reduceMotion: true,
      highContrast: false,
      fontStep: 1,
      prefs: { ...DEFAULT_PREFS, language: 'ar' },
      setPrefs: () => undefined,
    };
    return <ThemeContext.Provider value={value}>{node}</ThemeContext.Provider>;
  };
  const flat = (tree: ReactTestRenderer): string => JSON.stringify(tree.toJSON());
  const display = (word: number) => {
    const a = ayahByGlobal(globalAyahOf(word));
    return ayahDisplayWords(a);
  };

  it('says "You said … / Correct …" for a wrong word, with the letter that was dropped', () => {
    const out = flat(render([{ word: WRONG, heardInstead: 'في', at: 1 }]));
    expect(out).toContain('Wrong word');
    expect(out).toContain('You said');
    expect(out).toContain('"في"');
    expect(out).toContain('Correct');
    expect(out).toContain(display(WRONG)[4]);
    expect(out).toContain('You left out the letter «ه».');
  });

  it('says "You skipped" for a skipped word, and where it goes', () => {
    const out = flat(render([{ word: SKIPPED, heardInstead: '', at: 1 }]));
    expect(out).toContain('Skipped');
    expect(out).toContain('You skipped');
    expect(out).toContain(`It comes right after «${display(SKIPPED)[7]}».`);
    expect(out).not.toContain('You said');
  });

  it('prints the ayah around the word in reading order', () => {
    const out = flat(render([{ word: SKIPPED, heardInstead: '', at: 1 }]));
    const d = display(SKIPPED);
    const before = out.indexOf(d.slice(5, 8).join(' '));
    const after = out.indexOf(d.slice(9, 12).join(' '));
    expect(before).toBeGreaterThanOrEqual(0);
    expect(after).toBeGreaterThan(before);
  });

  it('puts the word tapped on the page first, and does not list it twice', () => {
    const out = flat(render(
      [
        { word: WRONG, heardInstead: 'في', at: 1 },
        { word: SKIPPED, heardInstead: '', at: 2 },
      ],
      SKIPPED,
    ));
    expect(out).toContain('The word you tapped');
    expect(out.indexOf('The word you tapped')).toBeLessThan(out.indexOf('Wrong word'));
    expect(out.split('You skipped').length - 1).toBe(1);
  });

  it('shows what was said as the recognizer spelled it, and explains it on the folded form', () => {
    // 2:22 from the phone: فراشا heard as فئران
    const word = at(2, 22, 4);
    const out = flat(render([{ word, heardInstead: 'فيران', heardRaw: 'فئران', at: 1 }]));
    expect(out).toContain('"فئران"');
    expect(out).not.toContain('فيران');
    expect(out).toContain('Said فئران instead of');
    // a mistake saved before heardRaw existed still reads
    expect(flat(render([{ word, heardInstead: 'فيران', at: 1 }]))).toContain('"فيران"');
  });

  it('counts the words in each ayah group in the interface language', () => {
    const two = [
      { word: at(2, 19, 4), heardInstead: 'في', at: 1 },
      { word: at(2, 19, 6), heardInstead: '', at: 1 },
    ];
    expect(flat(render(two.slice(0, 1)))).toContain('1 word');
    expect(flat(render(two))).toContain('2 words');
    const ar = flat(render(two, null, {}, arabic));
    expect(ar).toContain('كلمتان');
    expect(ar).not.toContain('words');
    expect(flat(render(two.slice(0, 1), null, {}, arabic))).toContain('كلمة واحدة');
  });

  it('offers Undo after "I said it right", and hands the mistake back', () => {
    const mistake = { word: WRONG, heardInstead: 'في', at: 1 };
    const dismissed: number[] = [];
    const undone: Mistake[] = [];
    const tree = render([mistake], null, {
      onDismiss: (w: number) => dismissed.push(w),
      onUndismiss: (m: Mistake) => undone.push(m),
    });
    expect(flat(tree)).not.toContain('Undo');
    const button = tree.root.findAll((n) => n.props.accessibilityLabel === 'I said it right' && typeof n.props.onPress === 'function')[0];
    act(() => button.props.onPress());
    expect(dismissed).toEqual([WRONG]);
    expect(flat(tree)).toContain('will not be checked again.');
    const undo = tree.root.findAll((n) => n.props.accessibilityLabel === 'Undo' && typeof n.props.onPress === 'function')[0];
    act(() => undo.props.onPress());
    expect(undone).toEqual([mistake]);
    expect(flat(tree)).not.toContain('Undo');
  });

  it('labels its two actions in words, not just icons', () => {
    const out = flat(render([{ word: WRONG, heardInstead: 'في', at: 1 }]));
    expect(out).toContain('Show on page');
    expect(out).toContain('I said it right');
  });
});

it('the fixtures above point at the words they claim to', () => {
  expect(words[wordIndexOf(2, 36) + 8]).toBe('اهبطوا');
  expect(words[wordIndexOf(2, 19) + 4]).toBe('فيه');
});
