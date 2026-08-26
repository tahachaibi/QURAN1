/**
 * Per-prayer minute corrections — pure, and therefore tested.
 *
 * Why this exists rather than only a calculation-method setting: a calculation
 * method is a set of twilight angles, and Maghrib has no twilight angle. Maghrib
 * is sunset, so every method agrees on it to within a rounding error — which
 * means a Maghrib that is five minutes early cannot be fixed by changing method,
 * and anyone who tells you otherwise is guessing.
 *
 * What actually differs is the local convention. Many national timetables
 * (Morocco's among them) publish Maghrib a few minutes AFTER astronomical sunset,
 * as a deliberate safety margin, and publish Fajr and Isha against their own
 * angles. So the app needs a way to say "this prayer, plus N minutes, here" and
 * have every downstream thing — the countdown, the notification, the adhan —
 * follow from the corrected time rather than each applying its own idea.
 *
 * That is the whole design: correct the timings ONCE, at the edge, and let the
 * rest of the app keep believing there is only one prayer time.
 */
import { PRAYERS, type PrayerName } from './prayerTimes';

export type PrayerOffsets = Record<PrayerName, number>;

/** Minutes either way. Wide enough for any real convention, narrow enough that a mis-tap is obvious. */
export const OFFSET_LIMIT = 30;

export const NO_OFFSETS: PrayerOffsets = { Fajr: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 };

export const clampOffset = (minutes: number): number =>
  Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, Math.round(minutes)));

/**
 * Shift an Aladhan-shaped time string by minutes, returning "HH:MM".
 *
 * Clamped to the same day rather than wrapped: an Isha pushed past midnight would
 * land in the morning, be read as "already passed", and silently lose its
 * notification — a wrong time that looks like a missing feature.
 */
export function shiftTime(raw: string, minutes: number): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(raw.trim());
  if (match === null) return raw.trim();
  const total = Number(match[1]) * 60 + Number(match[2]) + Math.round(minutes);
  const clamped = Math.max(0, Math.min(24 * 60 - 1, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Apply the corrections to a whole timings payload.
 *
 * Only the five prayers are touched; Sunrise and the rest pass through untouched
 * so nothing downstream that reads them starts lying.
 */
export function adjustTimings(
  timings: Record<string, string>,
  offsets: PrayerOffsets,
): Record<string, string> {
  let changed = false;
  const out: Record<string, string> = { ...timings };
  for (const prayer of PRAYERS) {
    const raw = timings[prayer];
    const offset = clampOffset(offsets[prayer] ?? 0);
    if (raw === undefined || offset === 0) continue;
    out[prayer] = shiftTime(raw, offset);
    changed = true;
  }
  // Returning the same object when nothing moved keeps React from re-rendering
  // the prayer tab once a second for no reason.
  return changed ? out : timings;
}

/** True when any prayer is corrected, for the "adjusted" note on the tab. */
export const hasOffsets = (offsets: PrayerOffsets): boolean =>
  PRAYERS.some((prayer) => clampOffset(offsets[prayer] ?? 0) !== 0);

/** e.g. "Maghrib +5, Fajr −2" for the tab's one-line summary. */
export function describeOffsets(offsets: PrayerOffsets): string {
  return PRAYERS.filter((p) => clampOffset(offsets[p] ?? 0) !== 0)
    .map((p) => {
      const value = clampOffset(offsets[p]);
      return `${p} ${value > 0 ? '+' : '−'}${Math.abs(value)}`;
    })
    .join(', ');
}
