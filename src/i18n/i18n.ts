/**
 * Two interface languages, English and Arabic.
 *
 * THE KEY IS THE ENGLISH SENTENCE. `t('Settings')` is English as written, and
 * Arabic when the dictionary has an entry. That keeps every screen readable in
 * its own source, with no table of opaque ids to look things up in. A missing
 * Arabic entry falls back to English rather than to a blank or a key name.
 * __tests__/i18n.test.ts fails the build if any literal passed to t() has no
 * Arabic entry, so the fallback is a safety net and never the plan.
 *
 * WHAT IS TRANSLATED is the interface: labels, buttons, explanations, errors.
 * What is already Arabic stays as it is in both languages: the Quran, the
 * hadith matn, the adhkar, prayer names in Arabic script. What exists only for
 * English readers (the hadith translation, transliterations) is hidden in
 * Arabic, because it is exactly the text an Arabic-only reader cannot use.
 *
 * LAYOUT DIRECTION is deliberately NOT flipped with I18nManager.forceRTL. The
 * mushaf lays each line out word by word in a row that is already right to
 * left. A global RTL flip would mirror those rows and print every line of the
 * Quran backwards. It also needs an app restart. Arabic strings still
 * right-align on their own, because Android aligns a paragraph to the
 * direction of its first strong character.
 */
import { AR } from './ar';

export type Lang = 'en' | 'ar';

export type Params = Record<string, string | number>;

/** "{n} words" with { n: 3 } → "3 words". Unknown names are left visible. */
export function interpolate(template: string, params?: Params): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/**
 * Arabic counts take six forms, and a sentence with the wrong one reads worse
 * than English. A dictionary entry can therefore be a set of forms, picked by
 * the {n} it is given:
 *   one 1 · two 2 · few 3–10 · many 11–99 · other 0, 100, 101, 102…
 * (the n % 100 rule, as in CLDR's Arabic plural rules).
 */
export interface ArabicForms {
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export function arabicForm(forms: ArabicForms, n: number): string {
  const r = Math.abs(Math.trunc(n)) % 100;
  if (n === 1 && forms.one !== undefined) return forms.one;
  if (n === 2 && forms.two !== undefined) return forms.two;
  if (r >= 3 && r <= 10 && forms.few !== undefined) return forms.few;
  if (r >= 11 && r <= 99 && forms.many !== undefined) return forms.many;
  return forms.other;
}

export function translate(lang: Lang, english: string, params?: Params): string {
  if (lang !== 'ar') return interpolate(english, params);
  const entry = AR[english];
  if (entry === undefined) return interpolate(english, params);
  if (typeof entry === 'string') return interpolate(entry, params);
  const n = Number(params?.n ?? 0);
  return interpolate(arabicForm(entry, Number.isFinite(n) ? n : 0), params);
}

export type T = (english: string, params?: Params) => string;

/**
 * Marks an English sentence that is produced in one place and translated in
 * another: a reason handed up from the recognizer, for instance. It returns
 * the string unchanged. Its only job is to let __tests__/i18n.test.ts find the
 * literal and insist on its Arabic, exactly as it does for t('…').
 * Display it with useT().tr(value).
 */
export const msg = (english: string): string => english;
