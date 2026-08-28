/**
 * Persistence (spec §1: AsyncStorage, no database, no backend, no accounts).
 *
 * Every key is namespaced and every read is defensive: a corrupt or
 * partially-written value must degrade to the default, never crash a session.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Reciter } from './audio';
import type { MistakeRecord } from '../engine/confusion';
import type { HifzDeck } from '../engine/hifz';
import type { FontStep } from '../theme/theme';
import { NO_OFFSETS, type PrayerOffsets } from './prayerOffsets';
import { ALL_BELLS_ON, type PrayerBells } from './prayerSchedule';
import type { StoredAdhan } from './adhanLibrary';

const KEY = {
  prefs: 'qh:prefs:v1',
  progress: 'qh:progress:v1',
  dismissed: 'qh:dismissed:v1',
  sessions: 'qh:sessions:v1',
  streak: 'qh:streak:v1',
  prayerCache: 'qh:prayer-cache:v1',
  onboarded: 'qh:onboarded:v1',
  hifz: 'qh:hifz:v1',
  mistakeLog: 'qh:mistake-log:v1',
  reciters: 'qh:reciters:v1',
  adhkar: 'qh:adhkar:v1',
} as const;

export type { PrayerOffsets } from './prayerOffsets';
export type { PrayerBells } from './prayerSchedule';
export type { StoredAdhan } from './adhanLibrary';

export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  fontStep: FontStep;
  reduceMotion: boolean;
  highContrast: boolean;
  haptics: boolean;
  /** recognizer locale; quality varies, so let the user try (§4) */
  locale: string;
  preferOnDevice: boolean;
  allowSegmented: boolean;
  reciter: string;
  hiddenMode: boolean;
  showDebugOverlay: boolean;
  /** notify five minutes before each prayer */
  prayerWarning: boolean;
  /**
   * Recordings the user added themselves. Built-ins are not stored: their asset
   * ids are build-time numbers and mean nothing in saved settings.
   */
  addedAdhans: StoredAdhan[];
  /** which entry in the library sounds the adhan */
  adhanSelectedId: string | null;
  /**
   * A recording the user chose from their own phone, copied into app storage.
   *
   * Used for the in-app adhan only: Android freezes a notification channel's
   * sound at creation and it must be a resource inside the APK, so a chosen file
   * cannot be the closed-app notification sound.
   */
  /**
   * Per prayer: sound the adhan, or show the notice silently.
   *
   * Defaults to all five on, so an update never silences somebody's Fajr.
   */
  bells: PrayerBells;
  /**
   * Per-prayer corrections in minutes. Maghrib is the one that matters: national
   * timetables publish it a few minutes after astronomical sunset, and no
   * calculation method can express that.
   */
  prayerOffsets: PrayerOffsets;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  fontStep: 1,
  reduceMotion: false,
  highContrast: false,
  haptics: true,
  locale: 'ar-SA',
  preferOnDevice: true,
  allowSegmented: true,
  // a QuranicAudio folder now, not an alquran.cloud edition id
  reciter: 'yasser_ad-dussary/',
  hiddenMode: false,
  showDebugOverlay: false,
  prayerWarning: true,
  addedAdhans: [],
  adhanSelectedId: null,
  bells: ALL_BELLS_ON,
  prayerOffsets: NO_OFFSETS,
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return { ...fallback, ...(parsed as object) } as T;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A failed preference write is not worth interrupting a recitation.
  }
}

export const loadPrefs = (): Promise<Prefs> => readJson(KEY.prefs, DEFAULT_PREFS);
export const savePrefs = (prefs: Prefs): Promise<void> => writeJson(KEY.prefs, prefs);

// ---------------------------------------------------------------------------
// per-surah resume position (§6.7)
// ---------------------------------------------------------------------------

export type ProgressMap = Record<string, { cursor: number; at: number }>;

export const loadProgress = (): Promise<ProgressMap> => readJson<ProgressMap>(KEY.progress, {});

export async function saveProgress(surah: number, cursor: number): Promise<void> {
  const all = await loadProgress();
  all[String(surah)] = { cursor, at: Date.now() };
  await writeJson(KEY.progress, all);
}

/** The single most recent position across all surahs, for "continue reading". */
export async function lastPosition(): Promise<{ surah: number; cursor: number } | null> {
  const all = await loadProgress();
  let best: { surah: number; cursor: number; at: number } | null = null;
  for (const [surah, entry] of Object.entries(all)) {
    if (best === null || entry.at > best.at) best = { surah: Number(surah), cursor: entry.cursor, at: entry.at };
  }
  return best === null ? null : { surah: best.surah, cursor: best.cursor };
}

// ---------------------------------------------------------------------------
// permanently dismissed false mistakes (§5.6)
// ---------------------------------------------------------------------------

export async function loadDismissed(): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY.dismissed);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

export async function addDismissed(word: number): Promise<void> {
  const all = await loadDismissed();
  if (all.includes(word)) return;
  all.push(word);
  await writeJson(KEY.dismissed, all);
}

// ---------------------------------------------------------------------------
// session log -> tracker streak (§6.6, §8)
// ---------------------------------------------------------------------------

export interface LoggedSession {
  id: string;
  /** ISO date, local, YYYY-MM-DD */
  day: string;
  at: number;
  surah: number;
  wordsRecited: number;
  versesCovered: number;
  accuracy: number;
  longestCleanRun: number;
  hintsUsed: number;
  mistakes: number;
  durationMs: number;
  /** furthest word index reached, for "you got further than last time" */
  furthestWord: number;
}

export async function loadSessions(): Promise<LoggedSession[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY.sessions);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as LoggedSession[]) : [];
  } catch {
    return [];
  }
}

export async function logSession(session: LoggedSession): Promise<void> {
  const all = await loadSessions();
  all.push(session);
  // keep two years of history; a habit app does not need more and this keeps
  // the AsyncStorage value small enough to parse instantly on cold start
  const trimmed = all.slice(Math.max(0, all.length - 800));
  await writeJson(KEY.sessions, trimmed);
}

export async function bestPreviousFor(surah: number): Promise<LoggedSession | null> {
  const all = await loadSessions();
  let best: LoggedSession | null = null;
  for (const s of all) {
    if (s.surah !== surah) continue;
    if (best === null || s.furthestWord > best.furthestWord) best = s;
  }
  return best;
}

// ---------------------------------------------------------------------------
// prayer times cache (§8: cache the last successful response for offline)
// ---------------------------------------------------------------------------

export interface PrayerCache {
  day: string;
  latitude: number;
  longitude: number;
  timings: Record<string, string>;
  fetchedAt: number;
  /** ISO 3166-1 alpha-2, from reverse geocoding — decides whose timetable to follow */
  countryCode?: string | null;
  /** the country's name, which resolves authorities named after their country */
  country?: string | null;
  /** the town, only so the tab can say where it thinks you are */
  city?: string | null;
  /** the calculation method actually used for these timings */
  methodId?: number;
  methodName?: string | null;
}

export const loadPrayerCache = (): Promise<PrayerCache | null> =>
  AsyncStorage.getItem(KEY.prayerCache)
    .then((raw) => (raw === null ? null : (JSON.parse(raw) as PrayerCache)))
    .catch(() => null);

export const savePrayerCache = (cache: PrayerCache): Promise<void> => writeJson(KEY.prayerCache, cache);

// ---------------------------------------------------------------------------
// adhkar tallies
// ---------------------------------------------------------------------------

/**
 * How many times each dhikr has been said, today.
 *
 * Persisted because the alternative is cruel: counting a dhikr a hundred times
 * and losing the tally to a phone call, a screen lock or a stray back-swipe.
 * Only today is kept — yesterday's count is not a thing anybody wants to see.
 */
export type AdhkarCounts = Record<string, number>;

interface AdhkarStore {
  day: string;
  morning: AdhkarCounts;
  evening: AdhkarCounts;
}

const EMPTY_ADHKAR: AdhkarStore = { day: '', morning: {}, evening: {} };

export async function loadAdhkarCounts(time: 'morning' | 'evening'): Promise<AdhkarCounts> {
  const store = await readJson<AdhkarStore>(KEY.adhkar, EMPTY_ADHKAR);
  return store.day === today() ? (store[time] ?? {}) : {};
}

export async function saveAdhkarCounts(
  time: 'morning' | 'evening',
  counts: AdhkarCounts,
): Promise<void> {
  const store = await readJson<AdhkarStore>(KEY.adhkar, EMPTY_ADHKAR);
  const fresh = store.day === today() ? store : { ...EMPTY_ADHKAR, day: today() };
  await writeJson(KEY.adhkar, { ...fresh, day: today(), [time]: counts });
}

// ---------------------------------------------------------------------------
// first run
// ---------------------------------------------------------------------------

/**
 * KEY.streak held per-day prayer check-offs and is now retired: the prayer rows
 * are read-only and the tracker counts recitation only. Old values are left on
 * the device rather than migrated — nothing reads them, and deleting a user's
 * data to tidy up a key name is not a trade worth making.
 */

export const hasOnboarded = (): Promise<boolean> =>
  AsyncStorage.getItem(KEY.onboarded)
    .then((v) => v === '1')
    .catch(() => false);

export const setOnboarded = (): Promise<void> =>
  AsyncStorage.setItem(KEY.onboarded, '1').catch(() => undefined);

/** Local YYYY-MM-DD, which is what a streak should be counted in. */
export function today(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// hifz deck: the spaced-repetition state, keyed by global ayah index
// ---------------------------------------------------------------------------

export const loadHifzDeck = (): Promise<HifzDeck> => readJson<HifzDeck>(KEY.hifz, {});

export const saveHifzDeck = (deck: HifzDeck): Promise<void> => writeJson(KEY.hifz, deck);

// ---------------------------------------------------------------------------
// mistake history, for the confusion profile
// ---------------------------------------------------------------------------

/** Keep a bounded window: enough to see a pattern, small enough to parse fast. */
export const MISTAKE_LOG_CAP = 500;

export async function loadMistakeLog(): Promise<MistakeRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY.mistakeLog);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is MistakeRecord =>
        r !== null &&
        typeof r === 'object' &&
        typeof (r as MistakeRecord).word === 'number' &&
        typeof (r as MistakeRecord).expected === 'string' &&
        typeof (r as MistakeRecord).heardInstead === 'string',
    );
  } catch {
    return [];
  }
}

export async function appendMistakeLog(records: readonly MistakeRecord[]): Promise<MistakeRecord[]> {
  if (records.length === 0) return loadMistakeLog();
  const all = [...(await loadMistakeLog()), ...records];
  const trimmed = all.slice(Math.max(0, all.length - MISTAKE_LOG_CAP));
  await writeJson(KEY.mistakeLog, trimmed);
  return trimmed;
}

// ---------------------------------------------------------------------------
// the fetched reciter list (§8)
// ---------------------------------------------------------------------------

export interface CachedReciters {
  fetchedAt: number;
  reciters: Reciter[];
}

export async function loadCachedReciters(): Promise<CachedReciters | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY.reciters);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as CachedReciters;
    return Array.isArray(parsed.reciters) && parsed.reciters.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export const saveCachedReciters = (reciters: Reciter[]): Promise<void> =>
  writeJson(KEY.reciters, { fetchedAt: Date.now(), reciters } satisfies CachedReciters);
