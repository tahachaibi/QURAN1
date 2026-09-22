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
 * The most days ahead worth scheduling. Android caps concurrent alarms, so keep
 * it modest.
 *
 * This is a ceiling for whoever FETCHES the times, not a licence to invent them:
 * `planNotifications` schedules exactly the days it is handed and no more. The
 * difference is the whole point of this file's rewrite — see `days` below.
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
          title: `${PRAYER_ARABIC[prayer]} · ${prayer}`,
          body: 'حان الآن وقت الصلاة',
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
            title: `${prayer} in ${WARNING_MINUTES} minutes`,
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
 * The common case: the times we have, filed under the day they belong to.
 *
 * Most of the time the app holds exactly one day's times — the ones it fetched
 * today — and this is how you say so honestly. One day in, one day scheduled.
 */
export function singleDay(timings: Record<string, string>, now = new Date()): PrayerDayTimes[] {
  return [{ date: localDayKey(now), timings }];
}
