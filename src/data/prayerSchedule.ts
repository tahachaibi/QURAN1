/**
 * Deciding WHICH prayer notifications to schedule — pure, and therefore tested.
 *
 * The scheduling call itself needs a device; this arithmetic does not, and it is
 * where the mistakes live: the five-minute offset, rolling into tomorrow, and
 * above all never scheduling a time that has already passed, which either fires
 * immediately or is dropped silently and looks like a bug either way.
 */
import {
  PRAYER_ARABIC,
  PRAYERS,
  localDayKey,
  localMidnight,
  parseTime,
  type PrayerName,
} from './prayerTimes';

/** Minutes before the adhan for the warning notification. */
export const WARNING_MINUTES = 5;
/** Three channels, because the three notifications want three different sounds. */
export const CHANNEL_ADHAN = 'adhan';
export const CHANNEL_WARNING = 'prayer-warning';
/**
 * Prayer time for a prayer whose bell is off: the notice appears, silently.
 *
 * A separate channel rather than a silent notification, because on Android the
 * channel owns the sound and a channel's sound cannot be changed after it is
 * created. Muting per prayer therefore means choosing a different channel, not
 * changing one.
 */
export const CHANNEL_SILENT = 'prayer-silent';
/**
 * The most days ahead worth scheduling, today included. Android caps concurrent
 * alarms, so keep it modest: seven days is seventy notifications at most.
 *
 * This is a ceiling on days somebody actually FETCHED, not a licence to invent
 * them: `upcomingDays` applies it to the saved days, and `planNotifications`
 * schedules exactly the days it is handed and no more. The difference is the
 * whole point of this file's rewrite — see `days` below.
 *
 * It is also why there are several days at all. With only today's times saved,
 * nothing could be scheduled past Isha, so tomorrow's Fajr — the one prayer that
 * always falls while the phone is asleep — was never scheduled unless somebody
 * happened to open the app between midnight and dawn.
 */
export const MAX_DAYS_AHEAD = 7;

/**
 * One calendar day's prayer times, tagged with the day they are FOR.
 *
 * The tag is not decoration. It is the fix for the worst bug this app has had:
 * the scheduler used to take a single `timings` object and apply it to each of
 * the next seven days, so tomorrow's Fajr alarm was set to TODAY's Fajr time and
 * day seven's was a week stale. Prayer times move a minute or two a day, so by
 * the end of the week the call to prayer was minutes off — and this file's own
 * comment says it best: a call to prayer five minutes early is worse than no
 * reminder, because it is wrong.
 *
 * Carrying the date with the times makes that mistake unexpressible. A day can
 * only be scheduled if someone actually knows that day's times.
 */
export interface PrayerDayTimes {
  /** the local calendar day these times belong to, as YYYY-MM-DD */
  date: string;
  /** timings as returned by Aladhan, e.g. { Fajr: '05:14 (+01)' } */
  timings: Record<string, string>;
}

export interface ScheduleOptions {
  /**
   * Every day to schedule, each carrying its OWN times.
   *
   * Hand it one day and one day is scheduled. There is deliberately no way to
   * say "and repeat that for a week".
   */
  days: PrayerDayTimes[];
  /** notify five minutes before each prayer */
  warnBefore: boolean;
  /** play the adhan at prayer time */
  adhan: boolean;
  /**
   * Per prayer: sound the adhan, or show the notice silently.
   *
   * Absent means all five sound, which is what every build before this did — an
   * update must not silence somebody's Fajr.
   */
  bells?: PrayerBells;
  /** current time; injected so the scheduler is testable */
  now?: Date;
  /** the interface language, for the notification titles and texts; English if unset */
  lang?: 'en' | 'ar';
}

export type NotificationChannel =
  | typeof CHANNEL_ADHAN
  | typeof CHANNEL_WARNING
  | typeof CHANNEL_SILENT;

/** Which prayers should actually sound the adhan. */
export type PrayerBells = Record<PrayerName, boolean>;

export const ALL_BELLS_ON: PrayerBells = {
  Fajr: true,
  Dhuhr: true,
  Asr: true,
  Maghrib: true,
  Isha: true,
};

/**
 * Travels with the notification so the app knows, when it is opened by a tap on
 * one, WHICH prayer's adhan to play. Without it the tap can only open the app.
 */
export interface NotificationPayload {
  kind: 'adhan' | 'warning';
  prayer: PrayerName;
  /** the prayer's own time as an ISO string, so a stale tap can be ignored */
  at: string;
}

export interface PlannedNotification {
  channel: NotificationChannel;
  prayer: PrayerName;
  at: Date;
  title: string;
  body: string;
  data: NotificationPayload;
}

/**
 * Which sound a notification carries.
 *
 * The five-minute warning NEVER carries the adhan — a call to prayer five
 * minutes early is worse than no reminder, because it is wrong. Only the
 * prayer-time notification does, and only as the fallback for a phone whose app
 * is closed; when the app is open the adhan is played properly, in full, with a
 * stop button, and the notification is muted so the two do not overlap.
 */
export function soundFor(channel: NotificationChannel, adhanSound: string | null): string | null {
  if (channel === CHANNEL_SILENT) return null;
  if (channel !== CHANNEL_ADHAN) return 'default';
  return adhanSound ?? 'default';
}

/**
 * Work out every notification to schedule, as pure data.
 *
 * Kept separate from the scheduling call so the arithmetic — which prayer, which
 * day, the five-minute offset, skipping times that have already passed — can be
 * tested without a device.
 */
export function planNotifications(options: ScheduleOptions): PlannedNotification[] {
  const now = options.now ?? new Date();
  const out: PlannedNotification[] = [];

  for (const day of options.days) {
    /**
     * A day whose date cannot be read is DROPPED, never guessed at.
     *
     * Falling back to "today" here would rebuild the original bug inside the
     * function written to prevent it.
     */
    const base = localMidnight(day.date);
    if (base === null) continue;

    for (const prayer of PRAYERS) {
      const raw = day.timings[prayer];
      if (raw === undefined) continue;
      const at = parseTime(raw, base);
      if (at.getTime() <= now.getTime()) continue;

      if (options.adhan) {
        const bells = options.bells ?? ALL_BELLS_ON;
        out.push({
          channel: bells[prayer] === false ? CHANNEL_SILENT : CHANNEL_ADHAN,
          prayer,
          at,
          // In Arabic the English name would only repeat the Arabic one.
          title: options.lang === 'ar' ? PRAYER_ARABIC[prayer] : `${PRAYER_ARABIC[prayer]} · ${prayer}`,
          // The sentence follows the interface like the title does. It used to
          // be Arabic in both, which left an English reader with a notification
          // whose only sentence they could not read. The prayer's Arabic NAME
          // stays in the English title; this is a sentence, not a name.
          body: options.lang === 'ar' ? 'حان الآن وقت الصلاة' : `It is time for ${prayer} prayer`,
          data: { kind: 'adhan', prayer, at: at.toISOString() },
        });
      }
      if (options.warnBefore) {
        const warnAt = new Date(at.getTime() - WARNING_MINUTES * 60_000);
        if (warnAt.getTime() > now.getTime()) {
          out.push({
            channel: CHANNEL_WARNING,
            prayer,
            at: warnAt,
            title:
              options.lang === 'ar'
                ? `${PRAYER_ARABIC[prayer]} بعد ${WARNING_MINUTES} دقائق`
                : `${prayer} in ${WARNING_MINUTES} minutes`,
            body: `${PRAYER_ARABIC[prayer]} — ${raw.trim().slice(0, 5)}`,
            data: { kind: 'warning', prayer, at: at.toISOString() },
          });
        }
      }
    }
  }

  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out;
}


/**
 * One day's times, filed under the day they belong to.
 *
 * One day in, one day scheduled. The app now saves several days at a time (see
 * `cachedDays`), but a caller holding just one still says so honestly with this.
 */
export function singleDay(timings: Record<string, string>, now = new Date()): PrayerDayTimes[] {
  return [{ date: localDayKey(now), timings }];
}

/**
 * The parts of the saved prayer-times cache this file reads.
 *
 * Structural rather than storage's own PrayerCache type, because what is read
 * back from storage is whatever an older build wrote, and every field is
 * checked before it is believed.
 */
export interface SavedDays {
  /** the day `timings` belong to, as YYYY-MM-DD */
  day?: unknown;
  timings?: unknown;
  /** every day fetched, each with its own times; absent in caches older than it */
  days?: unknown;
}

/**
 * Every day a saved cache holds, oldest first, each with its own times.
 *
 * A cache written before several days were saved holds exactly one — `day` and
 * `timings` — and reads as that one day, so an update keeps working offline on
 * the day it is installed. An entry whose date is not a real YYYY-MM-DD day, or
 * whose times are not text, is dropped: a day can only be scheduled if its
 * times are known, never guessed.
 */
export function cachedDays(cache: SavedDays | null | undefined): PrayerDayTimes[] {
  if (cache === null || cache === undefined) return [];
  const byDate = new Map<string, Record<string, string>>();
  const add = (date: unknown, timings: unknown) => {
    if (typeof date !== 'string' || localMidnight(date) === null || byDate.has(date)) return;
    const clean = textTimings(timings);
    if (clean !== null) byDate.set(date, clean);
  };
  if (Array.isArray(cache.days)) {
    for (const entry of cache.days as unknown[]) {
      if (entry === null || typeof entry !== 'object') continue;
      const { date, timings } = entry as { date?: unknown; timings?: unknown };
      add(date, timings);
    }
  }
  add(cache.day, cache.timings);
  return [...byDate.keys()].sort().map((date) => ({ date, timings: byDate.get(date) as Record<string, string> }));
}

/** The text-valued entries of a timings object, or null when no prayer is among them. */
function textTimings(value: unknown): Record<string, string> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') out[key] = raw;
  }
  return PRAYERS.some((prayer) => out[prayer] !== undefined) ? out : null;
}

/**
 * The days worth scheduling at `now`: today and the days after it, oldest
 * first, no further out than MAX_DAYS_AHEAD calendar days (today is the first).
 *
 * Yesterday is never "upcoming", however recently it was fetched. Its times
 * have passed, and treating them as today's is the mistake this file was
 * rewritten to rule out. A day missing from the middle stays missing.
 */
export function upcomingDays(
  days: readonly PrayerDayTimes[],
  now = new Date(),
  max = MAX_DAYS_AHEAD,
): PrayerDayTimes[] {
  const first = localDayKey(now);
  // Exclusive bound. Date arithmetic on the local calendar, so a daylight-saving
  // change inside the window cannot shift it by a day.
  const end = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + max));
  const seen = new Set<string>();
  return days
    .filter((day) => {
      if (localMidnight(day.date) === null || day.date < first || day.date >= end) return false;
      if (seen.has(day.date)) return false;
      seen.add(day.date);
      return true;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
