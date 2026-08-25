/**
 * Prayer-notification planning.
 *
 * The scheduling call needs a device; the arithmetic does not, so it lives in a
 * pure function and is tested here: which prayers, which days, the five-minute
 * offset, and above all never scheduling something in the past — a notification
 * for a time that has already gone either fires immediately or is silently
 * dropped, and both look like a bug.
 */
import {
  CHANNEL_ADHAN,
  CHANNEL_WARNING,
  planNotifications,
  WARNING_MINUTES,
} from '../src/data/prayerSchedule';

/** Aladhan-shaped timings, including its "(+01)" suffix. */
const TIMINGS = {
  Fajr: '05:14 (+01)',
  Sunrise: '06:40 (+01)',
  Dhuhr: '12:30 (+01)',
  Asr: '15:45 (+01)',
  Maghrib: '18:20 (+01)',
  Isha: '19:50 (+01)',
};

const at = (h: number, m: number): Date => new Date(2026, 3, 20, h, m, 0, 0);

describe('planNotifications', () => {
  it('schedules an adhan and a warning for every prayer still to come today', () => {
    const plan = planNotifications({ timings: TIMINGS, warnBefore: true, adhan: true, now: at(4, 0) });
    const today = plan.filter((p) => p.at.getDate() === 20);
    expect(today.filter((p) => p.channel === CHANNEL_ADHAN)).toHaveLength(5);
    expect(today.filter((p) => p.channel === CHANNEL_WARNING)).toHaveLength(5);
  });

  it('puts the warning exactly five minutes before the adhan', () => {
    const plan = planNotifications({ timings: TIMINGS, warnBefore: true, adhan: true, now: at(4, 0) });
    const adhan = plan.find((p) => p.channel === CHANNEL_ADHAN && p.prayer === 'Dhuhr');
    const warn = plan.find((p) => p.channel === CHANNEL_WARNING && p.prayer === 'Dhuhr');
    expect(adhan).toBeDefined();
    expect(warn).toBeDefined();
    expect((adhan as { at: Date }).at.getTime() - (warn as { at: Date }).at.getTime()).toBe(
      WARNING_MINUTES * 60_000,
    );
  });

  it('never schedules anything in the past', () => {
    const now = at(16, 0); // after Asr, before Maghrib
    const plan = planNotifications({ timings: TIMINGS, warnBefore: true, adhan: true, now });
    expect(plan.length).toBeGreaterThan(0);
    for (const item of plan) expect(item.at.getTime()).toBeGreaterThan(now.getTime());
    // today's remaining prayers only
    const today = plan.filter((p) => p.at.getDate() === 20).map((p) => p.prayer);
    expect(new Set(today)).toEqual(new Set(['Maghrib', 'Isha']));
  });

  it('drops a warning whose five minutes have already elapsed but keeps the adhan', () => {
    // 12:27 — three minutes to Dhuhr, so the 12:25 warning is gone
    const plan = planNotifications({ timings: TIMINGS, warnBefore: true, adhan: true, now: at(12, 27) });
    const dhuhrToday = plan.filter((p) => p.prayer === 'Dhuhr' && p.at.getDate() === 20);
    expect(dhuhrToday.map((p) => p.channel)).toEqual([CHANNEL_ADHAN]);
  });

  it('honours the two switches independently', () => {
    const noAdhan = planNotifications({ timings: TIMINGS, warnBefore: true, adhan: false, now: at(4, 0) });
    expect(noAdhan.every((p) => p.channel === CHANNEL_WARNING)).toBe(true);

    const noWarn = planNotifications({ timings: TIMINGS, warnBefore: false, adhan: true, now: at(4, 0) });
    expect(noWarn.every((p) => p.channel === CHANNEL_ADHAN)).toBe(true);

    expect(planNotifications({ timings: TIMINGS, warnBefore: false, adhan: false, now: at(4, 0) })).toEqual([]);
  });

  it('covers a week ahead, so it survives a phone that is offline for days', () => {
    const plan = planNotifications({ timings: TIMINGS, warnBefore: true, adhan: true, now: at(4, 0) });
    const days = new Set(plan.map((p) => p.at.toDateString()));
    expect(days.size).toBe(7);
  });

  it('is sorted, and ignores non-prayer timings like Sunrise', () => {
    const plan = planNotifications({ timings: TIMINGS, warnBefore: true, adhan: true, now: at(4, 0) });
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].at.getTime()).toBeGreaterThanOrEqual(plan[i - 1].at.getTime());
    }
    expect(plan.some((p) => (p.prayer as string) === 'Sunrise')).toBe(false);
  });

  it('copes with a partial or empty timings payload', () => {
    expect(planNotifications({ timings: {}, warnBefore: true, adhan: true, now: at(4, 0) })).toEqual([]);
    const partial = planNotifications({
      timings: { Fajr: '05:14' },
      warnBefore: true,
      adhan: true,
      now: at(4, 0),
    });
    expect(new Set(partial.map((p) => p.prayer))).toEqual(new Set(['Fajr']));
  });

  it('names the prayer in Arabic and in English', () => {
    const plan = planNotifications({ timings: TIMINGS, warnBefore: true, adhan: true, now: at(4, 0) });
    const fajr = plan.find((p) => p.channel === CHANNEL_ADHAN && p.prayer === 'Fajr');
    expect(fajr?.title).toContain('الفجر');
    expect(fajr?.title).toContain('Fajr');
  });
});
