/**
 * Prayer times (spec §8).
 *
 * Aladhan, from the device's own coordinates, with the last successful response
 * cached so the tab is useful offline. This and audio playback are the only two
 * things in the app that leave the device.
 *
 * THE TIMES ARE NOT ADJUSTED. Whatever the authority's own method returns is what
 * the tab shows. There used to be a per-country correction, measured against the
 * ministry's printed table for one city, and it is gone on request — a number
 * nudged in Beni Mellal is a guess in Casablanca. The only minutes that move a
 * time now are the ones the reader sets themselves.
 *
 * SEVERAL DAYS ARE SAVED, each with its own date. Only today's used to be, and
 * that one decision made the adhan unreliable: past Isha there was nothing left
 * to schedule, so tomorrow's Fajr — the prayer that always falls while the phone
 * sleeps — was never scheduled, and a day the app was not opened had no
 * notifications at all. See `fetchDays`.
 */
import * as Location from 'expo-location';

import { loadPrayerCache, savePrayerCache, today, type PrayerCache } from './storage';
import { adjustTimings, NO_OFFSETS, type PrayerOffsets } from './prayerOffsets';
import { FALLBACK_METHOD, fetchJson, fetchMethods } from './prayerMethods';
import { describeRegion, pickMethod, REGION_RULES, type ResolvedMethod } from './prayerRegion';
import { cachedDays, MAX_DAYS_AHEAD, type PrayerDayTimes } from './prayerSchedule';
import { translate, type T } from '../i18n/i18n';

const ENGLISH: T = (s, p) => translate('en', s, p);

const ALADHAN = 'https://api.aladhan.com/v1/timings';
const CALENDAR = 'https://api.aladhan.com/v1/calendar';

export interface PrayerOptions {
  /**
   * Force a calculation method. Normally left unset: the method is decided from
   * the country the phone is in, which is the question the user actually has an
   * answer to.
   */
  method?: number;
  /**
   * Per-prayer minute corrections for the times this returns. Never applied to
   * what is saved: the cache holds the API's own answer.
   */
  offsets?: PrayerOffsets;
  /** the interface translator, for the notes and errors this returns; English if unset */
  t?: T;
  /** the interface language, for the place line; English if unset */
  lang?: 'en' | 'ar';
  /**
   * Take a new position reading instead of accepting the last known one.
   *
   * Normally the last known fix is exactly right: it is instant, it costs no
   * battery, and prayer times do not change across a room. But it can be hours or
   * a city old, so a button that says "refresh my location" has to be able to
   * insist — otherwise it would return the same stale answer and look broken.
   */
  freshLocation?: boolean;
  /**
   * A refresh nobody asked for: the adhan keeping its saved days topped up from
   * wherever the app happens to be open.
   *
   * It must never put anything in front of the user. So it never asks for the
   * location permission — that question belongs on the prayer tab, where it
   * makes sense — never shows the "turn on location" dialog, and takes the last
   * known position or none at all.
   */
  quiet?: boolean;
}

export interface PrayerDay {
  /**
   * Today's times, corrected by `options.offsets` when any were passed. The
   * prayer tab passes none and applies the reader's corrections as it draws, so
   * a tap on a +/− needs no new request — and cannot be overtaken by an older one.
   */
  timings: Record<string, string>;
  /** e.g. "Beni Mellal, Morocco · وزارة الأوقاف والشؤون الإسلامية" */
  source: string;
  /** null when the country could not be matched to an authority */
  resolved: ResolvedMethod | null;
  /** why there is no authority, phrased for a human — null when there is one */
  authorityNote: string | null;
  /** the day `timings` are FOR, YYYY-MM-DD: not always today when they come from the cache */
  day: string;
  /** true when these came from the cache because the network was unreachable */
  fromCache: boolean;
  /** why we fell back, phrased for a human (§11) */
  note: string | null;
}

/**
 * Why there are no prayer times at all, for a screen that wants to offer the
 * right way out: the permission screen for a refusal, nothing for the rest.
 */
export type PrayerTimesProblem = 'permission' | 'location-off' | 'no-fix' | 'unreachable';

export class PrayerTimesError extends Error {
  constructor(
    readonly problem: PrayerTimesProblem,
    message: string,
  ) {
    super(message);
    this.name = 'PrayerTimesError';
  }
}

/** The problem behind a thrown error, or null when it is not one of these. */
export function problemOf(error: unknown): PrayerTimesProblem | null {
  const problem = (error as { problem?: unknown } | null)?.problem;
  return problem === 'permission' || problem === 'location-off' || problem === 'no-fix' || problem === 'unreachable'
    ? problem
    : null;
}

/** The cache as this file writes it: storage's PrayerCache plus every day fetched. */
type SavedPrayerCache = PrayerCache & { days?: PrayerDayTimes[] };

type Coords = { latitude: number; longitude: number };
type Place = { countryCode: string | null; country: string | null; city: string | null };

/**
 * Which country the coordinates are in.
 *
 * Android answers this from the platform geocoder, which usually works and
 * sometimes does not; a failure is not an error here, it just means the app falls
 * back to a general calculation and says so.
 */
async function whereAmI(coords: Coords): Promise<Place> {
  try {
    const places = await Location.reverseGeocodeAsync(coords);
    const place = places[0];
    if (place === undefined) return { countryCode: null, country: null, city: null };
    return {
      countryCode: place.isoCountryCode ?? null,
      // The country's NAME as well as its code: it is what lets a country with no
      // rule of its own still find the authority named after it.
      country: place.country ?? null,
      city: place.city ?? place.subregion ?? place.region ?? null,
    };
  } catch {
    return { countryCode: null, country: null, city: null };
  }
}

/** The place saved with the cache. */
const savedPlace = (cache: PrayerCache): Place => ({
  countryCode: cache.countryCode ?? null,
  country: cache.country ?? null,
  city: cache.city ?? null,
});

/**
 * Within about 25 km: the same town, give or take a commute.
 *
 * Deliberately not further. Oujda is ten kilometres from Algeria, and a phone
 * that has actually crossed a border must not be handed the old country's
 * timetable because the geocoder happened to be down that minute.
 */
function near(a: Coords, b: Coords): boolean {
  const dLat = (a.latitude - b.latitude) * 111;
  const dLon = (a.longitude - b.longitude) * 111 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLon) < 25;
}

/**
 * Work out whose timetable to follow, from the country, against the method list
 * the API itself publishes. Never from a number written into this app.
 *
 * It reports WHY when it cannot. One sentence used to cover three different
 * failures — the phone not knowing where it is, the list of authorities not
 * having loaded, and the country simply having no national timetable — and it
 * only described the first. Telling somebody in Türkiye that the app cannot tell
 * which country they are in, when the truth is that it has not downloaded the
 * list yet, sends them to look in the wrong place.
 */
async function resolveMethod(
  countryCode: string | null,
  countryName: string | null,
  t: T,
): Promise<{ method: ResolvedMethod | null; note: string | null }> {
  if (countryCode === null && countryName === null) {
    return {
      method: null,
      note: t('Could not tell where this phone is, so these use a general calculation.'),
    };
  }

  const { methods } = await fetchMethods();
  if (methods.length === 0) {
    return {
      method: null,
      note: t(
        'The list of prayer-time authorities has not downloaded yet, so these use a general calculation. Connect once and it is saved.',
      ),
    };
  }

  const method = pickMethod(countryCode, methods, countryName);
  if (method === null) {
    const where = countryName ?? countryCode ?? '?';
    return {
      method: null,
      note: t('No national prayer timetable is published for {where}, so these use a general calculation.', { where }),
    };
  }
  return { method, note: null };
}

/**
 * The days of an Aladhan calendar response, each under its own date.
 *
 * As tolerant as the methods parser, for the same reason: this was written on a
 * machine that cannot reach the API. Each entry must carry its gregorian date as
 * DD-MM-YYYY, which is how the API writes it; an entry without one is skipped
 * rather than placed by guesswork, and `cachedDays` drops any day whose times
 * are not text.
 */
export function parseCalendar(payload: unknown): PrayerDayTimes[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const days: { date: string; timings: unknown }[] = [];
  for (const entry of data as unknown[]) {
    if (entry === null || typeof entry !== 'object') continue;
    const { timings, date } = entry as { timings?: unknown; date?: { gregorian?: { date?: unknown } } };
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(date?.gregorian?.date ?? ''));
    if (match === null) continue;
    days.push({ date: `${match[3]}-${match[2]}-${match[1]}`, timings });
  }
  return cachedDays({ days });
}

/**
 * Today and the days after it, each with its own times.
 *
 * Two requests in parallel, and they are not redundant:
 *   - TODAY comes from the same single-day request the app has always made, so
 *     today's times are exactly as trustworthy as they were before;
 *   - THE DAYS AFTER come from the month calendar — one request per month that
 *     the next MAX_DAYS_AHEAD days touch, so two near a month's end — and are
 *     kept to the end of the last month fetched, which is what lets the tab show
 *     the right times through weeks without a connection.
 * If the calendar fails, today still arrives and the adhan is no worse off than
 * it always was; if the single day fails, the calendar's own today stands in.
 */
async function fetchDays(coords: Coords, method: number, day: string): Promise<PrayerDayTimes[]> {
  const query = `latitude=${coords.latitude}&longitude=${coords.longitude}&method=${method}`;
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth(), now.getDate() + MAX_DAYS_AHEAD - 1);
  const months = [now, last]
    .map((d) => ({ year: d.getFullYear(), month: d.getMonth() + 1 }))
    .filter((m, i, all) => i === 0 || m.month !== all[0].month || m.year !== all[0].year);

  const [single, ...calendar] = await Promise.allSettled([
    fetchJson(`${ALADHAN}/${Math.floor(now.getTime() / 1000)}?${query}`),
    ...months.map((m) => fetchJson(`${CALENDAR}/${m.year}/${m.month}?${query}`)),
  ]);

  const fromCalendar = calendar.flatMap((r) => (r.status === 'fulfilled' ? parseCalendar(r.value) : []));
  const singleTimings =
    single.status === 'fulfilled' ? (single.value as { data?: { timings?: unknown } } | null)?.data?.timings : null;
  // The single day first: `cachedDays` keeps the first readable entry for a
  // date, so the calendar's copy of today only counts when the single day failed.
  const days = cachedDays({
    days: [{ date: day, timings: singleTimings }, ...fromCalendar.filter((d) => d.date >= day)],
  });
  if (days[0]?.date !== day) throw new Error('Aladhan returned no times for today');
  return days;
}

/**
 * The saved day to show on `day`: its own, or failing that the latest before
 * it — and failing that whatever is saved at all, which only a clock set
 * backwards produces.
 */
function savedFor(cache: PrayerCache, day: string): PrayerDayTimes | null {
  const days = cachedDays(cache);
  const earlier = days.filter((d) => d.date <= day);
  return days.find((d) => d.date === day) ?? earlier[earlier.length - 1] ?? days[0] ?? null;
}

export async function fetchPrayerTimes(options: PrayerOptions = {}): Promise<PrayerDay> {
  const offsets = options.offsets ?? NO_OFFSETS;
  const t = options.t ?? ENGLISH;
  const lang = options.lang ?? 'en';
  const quiet = options.quiet === true;
  const cached = await loadPrayerCache();
  const day = today();

  let granted = false;
  let coords: Coords | null = null;
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    const asked =
      permission.granted || quiet ? permission : await Location.requestForegroundPermissionsAsync();
    granted = asked.granted;
    if (granted) {
      const position = options.freshLocation ? null : await Location.getLastKnownPositionAsync();
      const fix =
        position ??
        (quiet
          ? null
          : await Location.getCurrentPositionAsync({
              // Balanced rather than Low when asked explicitly: someone pressing
              // refresh has just travelled, and a coarse fix is what they are trying
              // to correct.
              accuracy: options.freshLocation ? Location.Accuracy.Balanced : Location.Accuracy.Low,
            }));
      if (fix !== null) coords = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
    }
  } catch {
    coords = null;
  }

  /**
   * No position right now, but permission and a saved place: fetch today's
   * times for the saved place rather than showing old ones.
   *
   * This used to return the saved times on the spot, without trying the
   * network, so a phone with Location switched off showed the last day a fix
   * worked — undated, for as long as Location stayed off — and the adhan went
   * quiet two days later with nothing saying why.
   *
   * Only with the permission still granted. Somebody who has taken location
   * away has said where they stand, and sending the old coordinates out again
   * would be going behind that; they get the saved times, dated.
   *
   * The saved place comes with its saved country and method, never a fresh
   * reverse-geocode: without a fix that can fail, and a failure here would
   * quietly swap the country's own timetable for the general one.
   */
  const fromSavedPlace =
    coords === null &&
    granted &&
    cached !== null &&
    Number.isFinite(cached.latitude) &&
    Number.isFinite(cached.longitude);
  if (fromSavedPlace) coords = { latitude: cached.latitude, longitude: cached.longitude };

  if (coords === null) {
    if (cached !== null) {
      const saved = savedFor(cached, day);
      if (saved !== null) {
        const resolved = cachedResolved(cached);
        return {
          timings: adjustTimings(saved.timings, offsets),
          day: saved.date,
          fromCache: true,
          source: describeRegion(cached.city ?? null, resolved, lang),
          resolved,
          authorityNote:
            resolved === null ? t('Could not tell where this phone is, so these use a general calculation.') : null,
          note:
            saved.date === day
              ? t('Showing your last saved times — location is unavailable right now.')
              : t('Location is unavailable right now — these are the times saved for {day}.', { day: saved.date }),
        };
      }
    }
    throw await noLocation(granted, t);
  }

  let place: Place;
  let resolved: ResolvedMethod | null;
  let authorityNote: string | null;
  if (fromSavedPlace && cached !== null) {
    place = savedPlace(cached);
    resolved = cachedResolved(cached);
    authorityNote =
      resolved === null ? t('Could not tell where this phone is, so these use a general calculation.') : null;
  } else {
    /**
     * A geocoder that answers nothing is not news that the phone has left the
     * country. It fails on its own — "Service not available", a phone without
     * Google's services — and taking that at its word switched a Moroccan user
     * from the ministry's timetable to the general one, Fajr some twenty
     * minutes late, and then saved that over the good answer. If the phone is
     * where it was, the saved country still stands.
     */
    const geo = await whereAmI(coords);
    const unknown = geo.countryCode === null && geo.country === null;
    const knewIt = cached !== null && (cached.countryCode != null || cached.country != null);
    place = unknown && knewIt && near(coords, cached) ? savedPlace(cached) : geo;
    ({ method: resolved, note: authorityNote } = await resolveMethod(place.countryCode, place.country, t));
  }
  const method =
    options.method ?? resolved?.id ?? (fromSavedPlace ? cached?.methodId : undefined) ?? FALLBACK_METHOD;

  try {
    const days = await fetchDays(coords, method, day);
    const timings = days[0].timings;
    // The cache holds the API's own answer. Offsets are applied on the way OUT,
    // so changing one corrects the times without another request.
    const cache: SavedPrayerCache = {
      day,
      ...coords,
      timings,
      days,
      fetchedAt: Date.now(),
      countryCode: place.countryCode,
      country: place.country,
      city: place.city,
      methodId: method,
      methodName: resolved?.name ?? null,
    };
    await savePrayerCache(cache);
    return {
      timings: adjustTimings(timings, offsets),
      day,
      fromCache: false,
      source: describeRegion(place.city, resolved, lang),
      resolved,
      authorityNote,
      note: fromSavedPlace
        ? t('Location is unavailable right now, so these times are for the place saved last time.')
        : null,
    };
  } catch {
    const saved = cached === null ? null : savedFor(cached, day);
    if (cached !== null && saved !== null) {
      const resolvedBefore = cachedResolved(cached);
      return {
        timings: adjustTimings(saved.timings, offsets),
        day: saved.date,
        fromCache: true,
        source: describeRegion(cached.city ?? null, resolvedBefore, lang),
        resolved: resolvedBefore,
        authorityNote: null,
        note:
          saved.date === day
            ? t("You're offline — these are today's saved times.")
            : t("You're offline — these are the times saved on {day}.", { day: saved.date }),
      };
    }
    throw new PrayerTimesError(
      'unreachable',
      t('Prayer times could not be fetched and nothing is cached yet. Connect once and they will work offline afterwards.'),
    );
  }
}

/**
 * Why there is no position, said so it can be acted on.
 *
 * One sentence used to cover all of it — "grant location access" — so somebody
 * who had simply switched Location off went to the permission screen, found it
 * already allowed, and was left with no prayer times and no idea why.
 */
async function noLocation(granted: boolean, t: T): Promise<PrayerTimesError> {
  if (!granted) {
    return new PrayerTimesError(
      'permission',
      t('Prayer times need your location once. Grant location access in Settings > Apps > Tasmee Hifz > Permissions > Location.'),
    );
  }
  const servicesOn = await Location.hasServicesEnabledAsync().catch(() => true);
  return servicesOn
    ? new PrayerTimesError(
        'no-fix',
        t('Could not find where this phone is right now. Check that Location is on, then tap Try again.'),
      )
    : new PrayerTimesError('location-off', t('Location is turned off on this phone. Turn it on, then tap Try again.'));
}

/** Rebuild just enough of the resolution to describe a cached response. */
function cachedResolved(cache: PrayerCache): ResolvedMethod | null {
  if (cache.methodId === undefined) return null;
  const rule = REGION_RULES.find((r) => r.code === cache.countryCode?.toUpperCase());
  // The rule's English name, not a translation: describeRegion translates it
  // for the Arabic interface, the same way it does a live answer.
  const country = rule?.country ?? cache.country ?? null;
  if (country === null) return null;
  return {
    id: cache.methodId,
    name: cache.methodName ?? `Method ${cache.methodId}`,
    country,
    authority: rule?.authority ?? null,
  };
}

// Re-exported so existing imports of './prayer' keep working; the arithmetic
// itself lives in prayerTimes.ts, which has no device dependencies.
export { PRAYERS, parseTime, nextPrayer, formatCountdown, PRAYER_ARABIC } from './prayerTimes';
export { adjustTimings, describeOffsets, hasOffsets, clampOffset, OFFSET_LIMIT } from './prayerOffsets';
export { describeRegion, pickMethod, REGION_RULES } from './prayerRegion';
export type { ResolvedMethod } from './prayerRegion';
export type { PrayerName, NextPrayer } from './prayerTimes';
