/**
 * WHEN to sound the adhan inside the app — pure, and therefore tested.
 *
 * A notification is scheduled by the operating system and fires whether or not
 * the app is alive. Playing audio with a stop button is the opposite: it can only
 * happen while the app is running, driven by a timer in JavaScript. Timers do not
 * run while Android has the app frozen, so this cannot be "set a timeout for
 * Maghrib and trust it": the app may be asleep at Maghrib and woken at midnight,
 * and blasting the call to prayer six hours late is worse than staying silent.
 *
 * So the rule is a GRACE WINDOW. Every wake-up asks "has a prayer time passed
 * within the last minute and a half, and have I not already sounded it?" — which
 * is true when the phone is in the user's hand at the moment of the adhan, and
 * false when the app is opened long afterwards.
 */
import { PRAYERS, nextPrayer, parseTime, type PrayerName } from './prayerTimes';

/**
 * How late the adhan may still be sounded. Long enough to survive a slow wake-up
 * or a phone that dozed through the exact second, short enough that it is still
 * recognisably "now".
 */
export const DUE_GRACE_MS = 90_000;

/** Never sleep longer than this, so a re-check happens at least once a minute. */
export const MAX_SLEEP_MS = 60_000;

/** Never sleep less than this, so a mis-set clock cannot spin the timer. */
export const MIN_SLEEP_MS = 1_000;

export interface AdhanDue {
  prayer: PrayerName;
  /** the prayer's exact time today */
  at: Date;
  /** stable per prayer per day, so an adhan is sounded at most once */
  key: string;
}

/** Identifies one prayer on one calendar day. */
export function adhanKey(prayer: PrayerName, at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${prayer}@${at.getFullYear()}-${month}-${day}`;
}

/**
 * The prayer whose adhan should be sounding right now, or null.
 *
 * Walks the prayers backwards so that the most recent one wins, and refuses to
 * repeat one already sounded.
 */
export function dueAdhan(
  timings: Record<string, string>,
  now: Date,
  alreadySounded: string | null,
): AdhanDue | null {
  for (let i = PRAYERS.length - 1; i >= 0; i--) {
    const prayer = PRAYERS[i];
    const raw = timings[prayer];
    if (raw === undefined) continue;
    const at = parseTime(raw, now);
    const late = now.getTime() - at.getTime();
    if (late < 0 || late > DUE_GRACE_MS) continue;
    const key = adhanKey(prayer, at);
    return key === alreadySounded ? null : { prayer, at, key };
  }
  return null;
}

/**
 * How long to sleep before checking again: exactly up to the next prayer when
 * that is soon, and a minute otherwise.
 *
 * The half-second of slack lands the wake-up just INSIDE the window rather than
 * on its edge, where rounding decides whether the adhan happens at all.
 */
export function msUntilCheck(timings: Record<string, string>, now: Date): number {
  const next = nextPrayer(timings, now);
  if (next === null) return MAX_SLEEP_MS;
  return Math.min(Math.max(next.msAway + 500, MIN_SLEEP_MS), MAX_SLEEP_MS);
}

/**
 * How stale cached prayer times may be before they stop being used to sound the
 * adhan.
 *
 * Prayer times drift by about a minute a day, so yesterday's times are close
 * enough to be right; last month's are not, and an adhan half an hour off is
 * worse than none. Two days is the compromise, and it also means a phone that
 * has been offline over a weekend still hears the adhan.
 */
export const MAX_CACHE_AGE_DAYS = 2;

/** `day` is a YYYY-MM-DD string, as written by storage.today(). */
export function timingsAreUsable(day: string, now: Date): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) return false;
  const cached = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ageDays = Math.round((midnight.getTime() - cached.getTime()) / 86_400_000);
  return ageDays >= 0 && ageDays <= MAX_CACHE_AGE_DAYS;
}
