/**
 * The theme context on its own, with no storage behind it.
 *
 * Separate from ThemeProvider so that anything which only READS the theme,
 * such as the interface language hook, does not pull AsyncStorage into every
 * component that uses it, or into every test that renders one.
 */
import { createContext, useContext } from 'react';

import type { FontStep, Palette } from './theme';
import type { Prefs } from '../data/storage';

export interface ThemeContextValue {
  palette: Palette;
  dark: boolean;
  /** OS "reduce motion" — respected everywhere, including the page turn (§6.7) */
  reduceMotion: boolean;
  highContrast: boolean;
  fontStep: FontStep;
  prefs: Prefs;
  setPrefs: (next: Partial<Prefs>) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * The theme if there is one. For hooks that have a sensible answer without it,
 * like the interface language (English), so a component rendered on its own,
 * in a test or a preview, still works.
 */
export function useOptionalTheme(): ThemeContextValue | null {
  return useContext(ThemeContext);
}
