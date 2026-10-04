import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';

import { darkPalette, lightPalette, type FontStep, type Palette } from './theme';
import { holdAcrossRestores, loadPrefs, savePrefs, type Prefs } from '../data/storage';

import { ThemeContext, type ThemeContextValue } from './themeContext';

export type { ThemeContextValue };

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const [prefs, setPrefsState] = useState<Prefs | null>(null);
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);

  useEffect(() => {
    void loadPrefs().then(setPrefsState);
  }, []);

  /**
   * A restore writes the settings underneath this provider, which keeps its
   * own copy and saves the WHOLE of it on every change. Without re-reading, the
   * next toggle anywhere in the app — theme, reciter, a prayer bell — put the
   * pre-restore settings back. There is nothing of ours to wait for first:
   * `setPrefs` issues its save as it happens, and AsyncStorage runs writes in
   * the order they were issued.
   */
  useEffect(
    () =>
      holdAcrossRestores(async (write) => {
        await write();
        setPrefsState(await loadPrefs());
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (!cancelled) setSystemReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduceMotion);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const value = useMemo<ThemeContextValue | null>(() => {
    if (prefs === null) return null;
    const dark = prefs.theme === 'system' ? scheme === 'dark' : prefs.theme === 'dark';
    const base = dark ? darkPalette : lightPalette;
    const palette: Palette = prefs.highContrast
      ? { ...base, ink: dark ? '#FFFFFF' : '#000000', text: dark ? '#FFFFFF' : '#000000' }
      : base;
    return {
      palette,
      dark,
      reduceMotion: systemReduceMotion || prefs.reduceMotion,
      highContrast: prefs.highContrast,
      fontStep: prefs.fontStep,
      prefs,
      setPrefs: (next) => {
        setPrefsState((current) => {
          if (current === null) return current;
          const merged = { ...current, ...next };
          void savePrefs(merged);
          return merged;
        });
      },
    };
  }, [prefs, scheme, systemReduceMotion]);

  if (value === null) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme was called outside ThemeProvider. Wrap the screen tree in app/_layout.tsx.');
  }
  return value;
}


export { useOptionalTheme } from './themeContext';
