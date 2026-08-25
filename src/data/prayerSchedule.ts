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

export type NotificationChannel = typeof CHANNEL_ADHAN | typeof CHANNEL_WARNING;

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
export function soundFor(channel: NotificationChannel, adhanSound: string | null): string {
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

