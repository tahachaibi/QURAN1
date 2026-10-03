/**
 * The interface follows the language chosen, and only the interface.
 *
 * Asked for by the user: pick Arabic or English when the app is first
 * installed, change it in Settings, and translate only "the words that
 * wouldn't be understood if the person doesn't know the language". So the
 * Quran and the hadith matn are Arabic in both languages. The English
 * translation of a hadith is shown only in English, because an Arabic-only
 * reader cannot use it.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ReactNode } from 'react';

import { HadithCard } from '../src/components/HadithCard';
import { MistakeSheet } from '../src/components/MistakeSheet';
import { hadithsOfChapter } from '../src/data/hadith';
import { wordIndexOf } from '../src/data/quran';
import { DEFAULT_PREFS, type Prefs } from '../src/data/storage';
import { ThemeContext, type ThemeContextValue } from '../src/theme/themeContext';
import { lightPalette } from '../src/theme/theme';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve(), removeItem: () => Promise.resolve() },
}));

function inLanguage(language: Prefs['language'], node: ReactNode): ReactTestRenderer {
  const value: ThemeContextValue = {
    palette: lightPalette,
    dark: false,
    reduceMotion: true,
    highContrast: false,
    fontStep: 1,
    prefs: { ...DEFAULT_PREFS, language },
    setPrefs: () => undefined,
  };
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<ThemeContext.Provider value={value}>{node}</ThemeContext.Provider>);
  });
  return tree;
}

const flat = (tree: ReactTestRenderer): string => JSON.stringify(tree.toJSON());

describe('a fresh install', () => {
  it('has not chosen a language yet, which is what sends it to the picker', () => {
    expect(DEFAULT_PREFS.language).toBeNull();
  });
});

describe('the mistakes sheet', () => {
  const sheet = (
    <MistakeSheet
      visible
      mistakes={[{ word: wordIndexOf(2, 19) + 4, heardInstead: 'في', at: 1 }]}
      palette={lightPalette}
      onClose={() => undefined}
      onDismiss={() => undefined}
      onGoToWord={() => undefined}
      onPractise={() => undefined}
      onPlayWord={() => undefined}
    />
  );

  it('speaks Arabic when Arabic is chosen', () => {
    const out = flat(inLanguage('ar', sheet));
    expect(out).toContain('قلتَ');
    expect(out).toContain('الصواب');
    expect(out).toContain('أسقطت حرف «ه».');
    expect(out).toContain('البقرة');
    expect(out).not.toContain('You said');
    expect(out).not.toContain('Al-Baqarah');
  });

  it('speaks English when English is chosen, and before anything is chosen', () => {
    for (const language of ['en', null] as const) {
      const out = flat(inLanguage(language, sheet));
      expect(out).toContain('You said');
      expect(out).toContain('Al-Baqarah');
      expect(out).not.toContain('الصواب');
    }
  });
});

describe('a hadith', () => {
  const hadith = hadithsOfChapter(1, 1)[0];
  const card = <HadithCard hadith={hadith} palette={lightPalette} fontStep={1} showSource />;

  it('keeps its Arabic in both languages', () => {
    expect(flat(inLanguage('ar', card))).toContain(JSON.stringify(hadith.arabic).slice(1, 40));
    expect(flat(inLanguage('en', card))).toContain(JSON.stringify(hadith.arabic).slice(1, 40));
  });

  it('shows the English translation only to an English reader', () => {
    const english = hadith.english.slice(0, 30);
    expect(flat(inLanguage('en', card))).toContain(english);
    expect(flat(inLanguage('ar', card))).not.toContain(english);
  });
});
