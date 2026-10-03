import { useMemo } from 'react';

import { useOptionalTheme } from '../theme/themeContext';
import { translate, type Lang, type T } from './i18n';

export interface I18n {
  t: T;
  lang: Lang;
  /** true when the interface is Arabic, for hiding English-only content */
  arabic: boolean;
  /**
   * Translate a string that arrives as a VALUE, made elsewhere with msg().
   * Only for those: t() is for literals, which the dictionary test can see.
   */
  tr: (english: string) => string;
}

/** The interface language and its translator. Re-renders when the language changes. */
export function useT(): I18n {
  const theme = useOptionalTheme();
  const lang: Lang = theme?.prefs.language === 'ar' ? 'ar' : 'en';
  return useMemo(
    () => ({
      t: (s, p) => translate(lang, s, p),
      tr: (s) => translate(lang, s),
      lang,
      arabic: lang === 'ar',
    }),
    [lang],
  );
}
