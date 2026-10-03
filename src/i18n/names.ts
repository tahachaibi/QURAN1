/**
 * Names that are content rather than interface: which form a reader can use.
 * An Arabic reader gets the surah's Arabic name. A transliteration is a
 * crutch for readers who cannot read Arabic script.
 */
import { surahInfo } from '../data/quran';
import { PRAYER_ARABIC, type PrayerName } from '../data/prayerTimes';
import type { Lang, T } from './i18n';

export function surahName(surah: number, lang: Lang): string {
  const info = surahInfo(surah);
  return lang === 'ar' ? info.name : info.transliteration;
}

/** "Fajr" in English, "الفجر" in Arabic. */
export function prayerName(prayer: PrayerName, lang: Lang): string {
  return lang === 'ar' ? PRAYER_ARABIC[prayer] : prayer;
}

/**
 * A recording's name in the reader's script. The two that ship with the app
 * are known. One the user added is called by its file name, which is theirs
 * and stays as it is.
 */
export function adhanName(entry: { id: string; name: string }, t: T, lang: Lang): string {
  if (entry.id === 'bundled') return lang === 'ar' ? 'عبد المجيد السبيحي' : entry.name;
  if (entry.id === 'chime') return t('Test chime');
  return entry.name;
}
