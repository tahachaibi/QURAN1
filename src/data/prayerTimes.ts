/**
 * Prayer-time arithmetic, with no device dependencies.
 *
 * Split out from prayer.ts so it can be tested in plain Node: the fetching side
 * needs expo-location, and dragging that into a unit test of "is the warning five
 * minutes before the adhan" is how time arithmetic ends up untested.
 */

export const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;
export type PrayerName = (typeof PRAYERS)[number];

/** "HH:MM" on `base`'s date. Aladhan returns times like "05:14 (+01)". */
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

/** Prayer names in Arabic, for notifications and the prayer tab. */
export const PRAYER_ARABIC: Record<PrayerName, string> = {
  Fajr: 'الفجر',
  Dhuhr: 'الظهر',
  Asr: 'العصر',
  Maghrib: 'المغرب',
  Isha: 'العشاء',
};

// ---------------------------------------------------------------------------
// Calendar days
// ---------------------------------------------------------------------------

/**
 * A local calendar day as YYYY-MM-DD.
 *
 * Deliberately NOT toISOString().slice(0, 10), which is the UTC day: east of
 * Greenwich that is yesterday for the first hours of the morning, so Fajr —
 * the prayer most likely to be scheduled overnight — would be filed under the
 * wrong date.
 */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Midnight, local time, on a YYYY-MM-DD day — or null if that is not a real day.
 *
 * Strict on purpose. `new Date('2026-09-21')` parses as UTC midnight, which is
 * the previous evening in the Americas, and `new Date(2026, 1, 31)` silently
 * rolls into March. Both would put a prayer on the wrong day, and a wrong prayer
 * time is worse than a missing one — so anything unreadable returns null and the
 * caller drops that day rather than guessing at it.
 */
export function localMidnight(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const out = new Date(year, month - 1, date, 0, 0, 0, 0);
  if (out.getFullYear() !== year || out.getMonth() !== month - 1 || out.getDate() !== date) {
    return null;
  }
  return out;
}
