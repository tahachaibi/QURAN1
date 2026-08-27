/**
 * Prayer times (spec §8).
 *
 * Aladhan, from the device's own coordinates, with the last successful response
 * cached so the tab is useful offline. This and audio playback are the only two
 * things in the app that leave the device.
 */
import * as Location from 'expo-location';

import { loadPrayerCache, savePrayerCache, today, type PrayerCache } from './storage';
import { adjustTimings, NO_OFFSETS, type PrayerOffsets } from './prayerOffsets';
import { FALLBACK_METHOD, fetchMethods } from './prayerMethods';
import {
  describeRegion,
  NO_CORRECTION,
  pickMethod,
  REGION_RULES,
  type PrayerCorrection,
  type ResolvedMethod,
} from './prayerRegion';

const ALADHAN = 'https://api.aladhan.com/v1/timings';

export interface PrayerOptions {
  /**
   * Force a calculation method. Normally left unset: the method is decided from
   * the country the phone is in, which is the question the user actually has an
   * answer to.
   */
  method?: number;
  /** per-prayer minute corrections, applied before anything else sees the times */
  offsets?: PrayerOffsets;
}

export interface PrayerDay {
  /** already corrected by the user's offsets — nothing downstream re-applies them */
  timings: Record<string, string>;
  /** e.g. "Beni Mellal, Morocco · وزارة الأوقاف والشؤون الإسلامية" */
  source: string;
  /** null when the country could not be matched to an authority */
  resolved: ResolvedMethod | null;
  day: string;
  /** true when these came from the cache because the network was unreachable */
  fromCache: boolean;
  /** why we fell back, phrased for a human (§11) */
  note: string | null;
}

/**
 * Which country the coordinates are in.
 *
 * Android answers this from the platform geocoder, which usually works and
 * sometimes does not; a failure is not an error here, it just means the app falls
 * back to a general calculation and says so.
 */
async function whereAmI(
  coords: { latitude: number; longitude: number },
): Promise<{ countryCode: string | null; city: string | null }> {
  try {
    const places = await Location.reverseGeocodeAsync(coords);
    const place = places[0];
    if (place === undefined) return { countryCode: null, city: null };
    return {
      countryCode: place.isoCountryCode ?? null,
      city: place.city ?? place.subregion ?? place.region ?? null,
    };
  } catch {
    return { countryCode: null, city: null };
  }
}

/**
 * Work out whose timetable to follow, from the country, against the method list
 * the API itself publishes. Never from a number written into this app.
 */
async function resolveMethod(countryCode: string | null): Promise<ResolvedMethod | null> {
  if (countryCode === null) return null;
  const { methods } = await fetchMethods();
  return pickMethod(countryCode, methods);
}

/**
 * The authority's correction and the user's own, added together.
 *
 * Two separate things, deliberately kept separate up to this point: one is what
 * the country's published table does, the other is what this person decided. If
 * they were merged earlier, correcting the country's table would look like the
 * user had fiddled with it.
 */
function combine(correction: PrayerCorrection, offsets: PrayerOffsets): PrayerOffsets {
  return {
    Fajr: correction.Fajr + offsets.Fajr,
    Dhuhr: correction.Dhuhr + offsets.Dhuhr,
    Asr: correction.Asr + offsets.Asr,
    Maghrib: correction.Maghrib + offsets.Maghrib,
    Isha: correction.Isha + offsets.Isha,
  };
}

export async function fetchPrayerTimes(options: PrayerOptions = {}): Promise<PrayerDay> {
  const offsets = options.offsets ?? NO_OFFSETS;
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
      timings: adjustTimings(cached.timings, combine(cachedResolved(cached)?.correction ?? NO_CORRECTION, offsets)),
      day: cached.day,
      fromCache: true,
      source: describeRegion(cached.city ?? null, cachedResolved(cached)),
      resolved: cachedResolved(cached),
      note: 'Showing your last saved times — location is unavailable right now.',
    };
  }
  if (coords === null) {
    throw new Error(
      'Prayer times need your location once. Grant location access in Settings > Apps > Quran Habit > Permissions > Location.',
    );
  }

  const place = await whereAmI(coords);
  const resolved = await resolveMethod(place.countryCode);
  const method = options.method ?? resolved?.id ?? FALLBACK_METHOD;

  const day = today();
  const stamp = Math.floor(Date.now() / 1000);
  const url = `${ALADHAN}/${stamp}?latitude=${coords.latitude}&longitude=${coords.longitude}&method=${method}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Aladhan returned HTTP ${response.status}`);
    const json = (await response.json()) as { data?: { timings?: Record<string, string> } };
    const timings = json.data?.timings;
    if (timings === undefined) throw new Error('Aladhan response had no timings');
    // The cache holds the API's own answer. Offsets are applied on the way OUT,
    // so changing one corrects today's times without another request.
    const cache: PrayerCache = {
      day,
      ...coords,
      timings,
      fetchedAt: Date.now(),
      countryCode: place.countryCode,
      city: place.city,
      methodId: method,
      methodName: resolved?.name ?? null,
    };
    await savePrayerCache(cache);
    return {
      timings: adjustTimings(timings, combine(resolved?.correction ?? NO_CORRECTION, offsets)),
      day,
      fromCache: false,
      source: describeRegion(place.city, resolved),
      resolved,
      note: null,
    };
  } catch {
    if (cached !== null) {
      return {
        timings: adjustTimings(cached.timings, combine(cachedResolved(cached)?.correction ?? NO_CORRECTION, offsets)),
        day: cached.day,
        fromCache: true,
        source: describeRegion(cached.city ?? null, cachedResolved(cached)),
        resolved: cachedResolved(cached),
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

/** Rebuild just enough of the resolution to describe a cached response. */
function cachedResolved(cache: PrayerCache): ResolvedMethod | null {
  if (cache.methodId === undefined || cache.countryCode == null) return null;
  const rule = REGION_RULES.find((r) => r.code === cache.countryCode?.toUpperCase());
  if (rule === undefined) return null;
  return {
    id: cache.methodId,
    name: cache.methodName ?? `Method ${cache.methodId}`,
    country: rule.country,
    authority: rule.authority ?? null,
    correction: { ...NO_CORRECTION, ...(rule.correction ?? {}) },
  };
}

// Re-exported so existing imports of './prayer' keep working; the arithmetic
// itself lives in prayerTimes.ts, which has no device dependencies.
export { PRAYERS, parseTime, nextPrayer, formatCountdown, PRAYER_ARABIC } from './prayerTimes';
export { adjustTimings, describeOffsets, hasOffsets, clampOffset, OFFSET_LIMIT } from './prayerOffsets';
export { describeRegion, describeCorrection, pickMethod, REGION_RULES, NO_CORRECTION } from './prayerRegion';
export type { ResolvedMethod } from './prayerRegion';
export type { PrayerName, NextPrayer } from './prayerTimes';
