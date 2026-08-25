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
