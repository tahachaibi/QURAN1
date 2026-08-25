/**
 * Prayer times (spec §8).
 *
 * Aladhan, from the device's own coordinates, with the last successful response
 * cached so the tab is useful offline. This and audio playback are the only two
 * things in the app that leave the device.
 */
import * as Location from 'expo-location';

import { loadPrayerCache, savePrayerCache, today, type PrayerCache } from './storage';

const ALADHAN = 'https://api.aladhan.com/v1/timings';

export interface PrayerDay {
  timings: Record<string, string>;
  day: string;
  /** true when these came from the cache because the network was unreachable */
  fromCache: boolean;
  /** why we fell back, phrased for a human (§11) */
  note: string | null;
}

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

// Re-exported so existing imports of './prayer' keep working; the arithmetic
// itself lives in prayerTimes.ts, which has no device dependencies.
export { PRAYERS, parseTime, nextPrayer, formatCountdown, PRAYER_ARABIC } from './prayerTimes';
export type { PrayerName, NextPrayer } from './prayerTimes';
