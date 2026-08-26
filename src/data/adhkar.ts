/**
 * Morning and evening adhkar.
 *
 * Two kinds of entry, and the difference matters:
 *
 *   - DU'AS, whose Arabic is a verbatim slice of a hadith bundled in this app,
 *     cut out by scripts/gen-adhkar.mjs and carrying its collection and number.
 *     Nothing here is typed from memory; see that script for why.
 *   - QUR'AN PASSAGES, whose text comes from the bundled mushaf text and which
 *     are cited by surah and ayah only. The narrations that prescribe them for
 *     morning and evening are in Abu Dawud, at-Tirmidhi and an-Nasa'i, which this
 *     app does not bundle, so the app cites what it can actually show you and
 *     says so on the screen rather than inventing a reference.
 *
 * Several familiar adhkar are missing for the same reason — they are not in
 * Bukhari or Muslim. docs/hadith.md lists them. Missing is the honest state; an
 * approximation of a du'a is not.
 */
import raw from '../assets/adhkar.json';

import { ayahAt, surahInfo } from './quran';

export type AdhkarTime = 'morning' | 'evening';

export interface HadithSource {
  kind: 'hadith';
  collection: number;
  chapter: number;
  number: number;
  /** the whole narration, so the source can be read without leaving the screen */
  arabic: string;
  narrator: string;
  english: string;
}

export interface QuranSource {
  kind: 'quran';
  surah: number;
  fromAyah: number;
  toAyah: number;
  /** e.g. "Al-Ikhlas 112:1-4" */
  reference: string;
}

export interface Dhikr {
  id: string;
  /** how many times it is said */
  repeat: number;
  titleEn: string;
  note: string | null;
  /** verbatim Arabic, one entry per line to display */
  lines: string[];
  source: HadithSource | QuranSource;
}

interface RawDhikr {
  id: string;
  time: 'morning' | 'evening' | 'both';
  repeat: number;
  titleEn: string;
  note: string | null;
  lines: string[];
  hadith: { collection: number; chapter: number; number: number; arabic: string; narrator: string; english: string };
}

const GENERATED = (raw as unknown as { adhkar: RawDhikr[] }).adhkar;

/**
 * The Qur'an passages, as references only. Their text is read from the bundled
 * mushaf at call time, which is the same text the Read screen shows — there is no
 * second copy of the Qur'an in this app to drift out of step.
 */
const QURAN_ADHKAR: readonly { id: string; surah: number; from: number; to: number; repeat: number; titleEn: string }[] = [
  { id: 'ayat-al-kursi', surah: 2, from: 255, to: 255, repeat: 1, titleEn: 'Ayat al-Kursi' },
  { id: 'al-ikhlas', surah: 112, from: 1, to: 4, repeat: 3, titleEn: 'Surat al-Ikhlas' },
  { id: 'al-falaq', surah: 113, from: 1, to: 5, repeat: 3, titleEn: 'Surat al-Falaq' },
  { id: 'an-nas', surah: 114, from: 1, to: 6, repeat: 3, titleEn: 'Surat an-Nas' },
];

function quranDhikr(entry: (typeof QURAN_ADHKAR)[number]): Dhikr {
  const lines: string[] = [];
  for (let ayah = entry.from; ayah <= entry.to; ayah++) {
    lines.push(ayahAt(entry.surah, ayah).text);
  }
  const info = surahInfo(entry.surah);
  const range = entry.from === entry.to ? `${entry.from}` : `${entry.from}-${entry.to}`;
  return {
    id: entry.id,
    repeat: entry.repeat,
    titleEn: entry.titleEn,
    note: null,
    lines,
    source: {
      kind: 'quran',
      surah: entry.surah,
      fromAyah: entry.from,
      toAyah: entry.to,
      reference: `${info.transliteration} ${entry.surah}:${range}`,
    },
  };
}

function hadithDhikr(entry: RawDhikr): Dhikr {
  return {
    id: entry.id,
    repeat: entry.repeat,
    titleEn: entry.titleEn,
    note: entry.note,
    lines: entry.lines,
    source: { kind: 'hadith', ...entry.hadith },
  };
}

/**
 * The Qur'an first, then the du'as, which is the order the adhkar are normally
 * read in.
 */
export function adhkarFor(time: AdhkarTime): Dhikr[] {
  return [
    ...QURAN_ADHKAR.map(quranDhikr),
    ...GENERATED.filter((d) => d.time === time || d.time === 'both').map(hadithDhikr),
  ];
}

/** Which set to open by default. Noon is the switch: simple and predictable. */
export function defaultTime(now = new Date()): AdhkarTime {
  return now.getHours() < 12 ? 'morning' : 'evening';
}

export const adhkarCount = (time: AdhkarTime): number => adhkarFor(time).length;
