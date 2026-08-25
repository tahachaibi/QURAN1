/**
 * Deciding WHICH prayer notifications to schedule — pure, and therefore tested.
 *
 * The scheduling call itself needs a device; this arithmetic does not, and it is
 * where the mistakes live: the five-minute offset, rolling into tomorrow, and
 * above all never scheduling a time that has already passed, which either fires
 * immediately or is dropped silently and looks like a bug either way.
 */
import { PRAYER_ARABIC, PRAYERS, parseTime, type PrayerName } from './prayerTimes';

/** Minutes before the adhan for the warning notification. */
export const WARNING_MINUTES = 5;
/** Two channels, because the two notifications want different sounds. */
export const CHANNEL_ADHAN = 'adhan';
export const CHANNEL_WARNING = 'prayer-warning';
/** Days ahead to schedule. Android caps concurrent alarms, so keep it modest. */
const DAYS_AHEAD = 7;

export interface ScheduleOptions {
  /** timings as returned by Aladhan, e.g. { Fajr: '05:14 (+01)' } */
  timings: Record<string, string>;
  /** notify five minutes before each prayer */
  warnBefore: boolean;
  /** play the adhan at prayer time */
  adhan: boolean;
  /** current time; injected so the scheduler is testable */
  now?: Date;
}

export interface PlannedNotification {
  channel: typeof CHANNEL_ADHAN | typeof CHANNEL_WARNING;
  prayer: PrayerName;
  at: Date;
  title: string;
  body: string;
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

  for (let day = 0; day < DAYS_AHEAD; day++) {
    const base = new Date(now);
    base.setDate(base.getDate() + day);

    for (const prayer of PRAYERS) {
      const raw = options.timings[prayer];
      if (raw === undefined) continue;
      const at = parseTime(raw, base);
      if (at.getTime() <= now.getTime()) continue;

      if (options.adhan) {
        out.push({
          channel: CHANNEL_ADHAN,
          prayer,
          at,
          title: `${PRAYER_ARABIC[prayer]} · ${prayer}`,
          body: 'حان الآن وقت الصلاة',
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
          });
        }
      }
    }
  }

  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out;
}

