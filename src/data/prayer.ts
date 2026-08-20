/**
 * Prayer times (spec §8).
 *
 * Aladhan, from the device's own coordinates, with the last successful response
 * cached so the tab is useful offline. This and audio playback are the only two
 * things in the app that leave the device.
 */
import * as Location from 'expo-location';

import { loadPrayerCache, savePrayerCache, today, type PrayerCache } from './storage';

export const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;
export type PrayerName = (typeof PRAYERS)[number];

export interface PrayerDay {
  timings: Record<string, string>;
  day: string;
  /** true when these came from the cache because the network was unreachable */
  fromCache: boolean;
  /** why we fell back, phrased for a human (§11) */
  note: string | null;
}

const ALADHAN = 'https://api.aladhan.com/v1/timings';

export async function fetchPrayerTimes(): Promise<PrayerDay> {
  const cached = await loadPrayerCache();

  let coords: { latitude: number; longitude: number } | null = null;
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    const granted = permission.granted
      ? permission
      : await Location.requestForegroundPermissionsAsync();
    if (granted.granted) {
      const position = await Location.getLastKnownPositionAsync();
      const fix = position ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
      coords = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
    }
  } catch {
    coords = null;
  }

  if (coords === null && cached !== null) {
    return {
      timings: cached.timings,
      day: cached.day,
      fromCache: true,
      note: 'Showing your last saved times — location is unavailable right now.',
    };
  }
  if (coords === null) {
    throw new Error(
      'Prayer times need your location once. Grant location access in Settings > Apps > Quran Habit > Permissions > Location.',
    );
  }

  const day = today();
  const stamp = Math.floor(Date.now() / 1000);
  const url = `${ALADHAN}/${stamp}?latitude=${coords.latitude}&longitude=${coords.longitude}&method=2`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Aladhan returned HTTP ${response.status}`);
    const json = (await response.json()) as { data?: { timings?: Record<string, string> } };
    const timings = json.data?.timings;
    if (timings === undefined) throw new Error('Aladhan response had no timings');
    const cache: PrayerCache = { day, ...coords, timings, fetchedAt: Date.now() };
    await savePrayerCache(cache);
    return { timings, day, fromCache: false, note: null };
  } catch {
    if (cached !== null) {
      return {
        timings: cached.timings,
        day: cached.day,
        fromCache: true,
        note:
          cached.day === day
            ? "You're offline — these are today's saved times."
            : `You're offline — these are the times saved on ${cached.day}.`,
      };
    }
    throw new Error(
      'Prayer times could not be fetched and nothing is cached yet. Connect once and they will work offline afterwards.',
    );
  }
}

/** "HH:MM" today, as a Date. Aladhan returns times like "05:14 (+01)". */
export function parseTime(value: string, base = new Date()): Date {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  const date = new Date(base);
  if (match === null) return date;
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date;
}

export interface NextPrayer {
  name: PrayerName;
  at: Date;
  msAway: number;
  /** true when the next prayer is tomorrow's Fajr */
  tomorrow: boolean;
}

export function nextPrayer(timings: Record<string, string>, now = new Date()): NextPrayer | null {
  for (const name of PRAYERS) {
    const raw = timings[name];
    if (raw === undefined) continue;
    const at = parseTime(raw, now);
    if (at.getTime() > now.getTime()) {
      return { name, at, msAway: at.getTime() - now.getTime(), tomorrow: false };
    }
  }
  const fajr = timings.Fajr;
  if (fajr === undefined) return null;
  const at = parseTime(fajr, now);
  at.setDate(at.getDate() + 1);
  return { name: 'Fajr', at, msAway: at.getTime() - now.getTime(), tomorrow: true };
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}
