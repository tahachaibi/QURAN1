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
  cachedDays,
  CHANNEL_ADHAN,
  CHANNEL_WARNING,
  MAX_DAYS_AHEAD,
  planNotifications,
  singleDay,
  upcomingDays,
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
/** The day `at` builds times on — month index 3 is April. */
const DAY = '2026-04-20';
/** Today's times, filed under today, which is nearly every test here. */
const oneDay = [{ date: DAY, timings: TIMINGS }];

describe('planNotifications', () => {
  it('schedules an adhan and a warning for every prayer still to come today', () => {
    const plan = planNotifications({ days: oneDay, warnBefore: true, adhan: true, now: at(4, 0) });
    const today = plan.filter((p) => p.at.getDate() === 20);
    expect(today.filter((p) => p.channel === CHANNEL_ADHAN)).toHaveLength(5);
    expect(today.filter((p) => p.channel === CHANNEL_WARNING)).toHaveLength(5);
  });

  it('puts the warning exactly five minutes before the adhan', () => {
    const plan = planNotifications({ days: oneDay, warnBefore: true, adhan: true, now: at(4, 0) });
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
    const plan = planNotifications({ days: oneDay, warnBefore: true, adhan: true, now });
    expect(plan.length).toBeGreaterThan(0);
    for (const item of plan) expect(item.at.getTime()).toBeGreaterThan(now.getTime());
    // today's remaining prayers only
    const today = plan.filter((p) => p.at.getDate() === 20).map((p) => p.prayer);
    expect(new Set(today)).toEqual(new Set(['Maghrib', 'Isha']));
  });

  it('drops a warning whose five minutes have already elapsed but keeps the adhan', () => {
    // 12:27 — three minutes to Dhuhr, so the 12:25 warning is gone
    const plan = planNotifications({ days: oneDay, warnBefore: true, adhan: true, now: at(12, 27) });
    const dhuhrToday = plan.filter((p) => p.prayer === 'Dhuhr' && p.at.getDate() === 20);
    expect(dhuhrToday.map((p) => p.channel)).toEqual([CHANNEL_ADHAN]);
  });

  it('honours the two switches independently', () => {
    const noAdhan = planNotifications({ days: oneDay, warnBefore: true, adhan: false, now: at(4, 0) });
    expect(noAdhan.every((p) => p.channel === CHANNEL_WARNING)).toBe(true);

    const noWarn = planNotifications({ days: oneDay, warnBefore: false, adhan: true, now: at(4, 0) });
    expect(noWarn.every((p) => p.channel === CHANNEL_ADHAN)).toBe(true);

    expect(planNotifications({ days: oneDay, warnBefore: false, adhan: false, now: at(4, 0) })).toEqual([]);
  });

  /**
   * This test used to assert `days.size === 7` off a SINGLE day's times, which
   * made the app's worst bug look like a feature: the plan did cover a week, by
   * scheduling today's clock times on all seven days, so day seven's adhan was a
   * week stale and fired minutes off. Coverage is the caller's job now — hand it
   * real times for real days — and these two pin what the planner owes.
   */
  it('schedules exactly the days it is handed, and never invents one', () => {
    const plan = planNotifications({ days: oneDay, warnBefore: true, adhan: true, now: at(4, 0) });
    expect(plan.length).toBeGreaterThan(0);
    expect(new Set(plan.map((p) => p.at.toDateString())).size).toBe(1);
  });

  it("uses each day's OWN times, not the first day's repeated", () => {
    // Maghrib drifts a minute a day, which is exactly how the bug hid: over a
    // week the error grows to the "adhan five minutes early" the user reported.
    const week = [
      { date: '2026-04-20', timings: { ...TIMINGS, Maghrib: '18:20' } },
      { date: '2026-04-21', timings: { ...TIMINGS, Maghrib: '18:21' } },
      { date: '2026-04-22', timings: { ...TIMINGS, Maghrib: '18:23' } },
    ];
    const plan = planNotifications({ days: week, warnBefore: false, adhan: true, now: at(4, 0) });
    const maghrib = plan
      .filter((p) => p.prayer === 'Maghrib')
      .map((p) => `${p.at.getDate()}@${p.at.getHours()}:${String(p.at.getMinutes()).padStart(2, '0')}`);
    expect(maghrib).toEqual(['20@18:20', '21@18:21', '22@18:23']);
  });

  it('drops a day whose date it cannot read rather than guessing at it', () => {
    // Guessing "today" here is precisely the original defect. A dropped day is a
    // missing reminder; a guessed one is a wrong call to prayer.
    const plan = planNotifications({
      days: [
        { date: 'not-a-date', timings: TIMINGS },
        { date: '2026-02-31', timings: TIMINGS }, // JS would roll this into March
        { date: DAY, timings: TIMINGS },
      ],
      warnBefore: false,
      adhan: true,
      now: at(4, 0),
    });
    expect(new Set(plan.map((p) => p.at.toDateString())).size).toBe(1);
    expect(plan.every((p) => p.at.getMonth() === 3 && p.at.getDate() === 20)).toBe(true);
  });

  it('singleDay files the times under the day they were fetched on', () => {
    const [only] = singleDay(TIMINGS, at(9, 30));
    expect(only.date).toBe(DAY);
    expect(only.timings).toBe(TIMINGS);
  });

  it('is sorted, and ignores non-prayer timings like Sunrise', () => {
    const plan = planNotifications({ days: oneDay, warnBefore: true, adhan: true, now: at(4, 0) });
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].at.getTime()).toBeGreaterThanOrEqual(plan[i - 1].at.getTime());
    }
    expect(plan.some((p) => (p.prayer as string) === 'Sunrise')).toBe(false);
  });

  it('copes with a partial or empty timings payload', () => {
    expect(planNotifications({ days: [{ date: DAY, timings: {} }], warnBefore: true, adhan: true, now: at(4, 0) })).toEqual([]);
    const partial = planNotifications({
      days: [{ date: DAY, timings: { Fajr: '05:14' } }],
      warnBefore: true,
      adhan: true,
      now: at(4, 0),
    });
    expect(new Set(partial.map((p) => p.prayer))).toEqual(new Set(['Fajr']));
  });

  it('names the prayer in Arabic and in English', () => {
    const plan = planNotifications({ days: oneDay, warnBefore: true, adhan: true, now: at(4, 0) });
    const fajr = plan.find((p) => p.channel === CHANNEL_ADHAN && p.prayer === 'Fajr');
    expect(fajr?.title).toContain('الفجر');
    expect(fajr?.title).toContain('Fajr');
  });

  /**
   * The sentence under the title was Arabic in both languages, so an English
   * reader got a prayer-time notification whose only sentence they could not
   * read. It follows the interface now, as the title already did.
   */
  it('writes the adhan sentence in the interface language', () => {
    const adhanIn = (lang: 'en' | 'ar') =>
      planNotifications({ days: oneDay, warnBefore: false, adhan: true, now: at(4, 0), lang }).find(
        (p) => p.prayer === 'Maghrib',
      );
    expect(adhanIn('en')?.body).toBe('It is time for Maghrib prayer');
    expect(adhanIn('en')?.body).not.toMatch(/[؀-ۿ]/);
    expect(adhanIn('ar')?.body).toBe('حان الآن وقت الصلاة');
  });
});

/**
 * Several days, each with its own times.
 *
 * The bug these pin: only today's times were ever saved, so after Isha there
 * was nothing left to schedule, and tomorrow's Fajr — always asleep-time — was
 * only ever scheduled if somebody opened the app between midnight and dawn.
 */
describe('the days the app schedules from', () => {
  const TOMORROW = { ...TIMINGS, Fajr: '05:15 (+01)' };

  it('after Isha, still schedules tomorrow’s Fajr, at tomorrow’s own time', () => {
    const saved = {
      day: DAY,
      timings: TIMINGS,
      days: [
        { date: DAY, timings: TIMINGS },
        { date: '2026-04-21', timings: TOMORROW },
      ],
    };
    const now = at(21, 30);
    const plan = planNotifications({
      days: upcomingDays(cachedDays(saved), now),
      warnBefore: true,
      adhan: true,
      now,
    });
    const fajr = plan.find((p) => p.channel === CHANNEL_ADHAN && p.prayer === 'Fajr');
    expect(fajr?.at).toEqual(new Date(2026, 3, 21, 5, 15));
    expect(plan.find((p) => p.channel === CHANNEL_WARNING && p.prayer === 'Fajr')?.at).toEqual(
      new Date(2026, 3, 21, 5, 10),
    );
    expect(plan.filter((p) => p.channel === CHANNEL_ADHAN)).toHaveLength(5);
  });

  it('reads a cache written before several days were saved as its one day', () => {
    const older = { day: DAY, latitude: 32.3, longitude: -6.4, timings: TIMINGS, fetchedAt: 1 };
    expect(cachedDays(older)).toEqual([{ date: DAY, timings: TIMINGS }]);
    expect(cachedDays(null)).toEqual([]);
  });

  it('drops what it cannot read rather than guessing, and sorts what it can', () => {
    const days = cachedDays({
      days: [
        { date: '2026-04-22', timings: TIMINGS },
        { date: '2026-02-31', timings: TIMINGS },
        { date: 'tomorrow', timings: TIMINGS },
        { date: '2026-04-21', timings: { Sunrise: '06:39' } },
        { date: '2026-04-23', timings: 'not an object' },
        null,
        { date: DAY, timings: { ...TIMINGS, Fajr: 514 } },
      ],
    });
    expect(days.map((d) => d.date)).toEqual([DAY, '2026-04-22']);
    // a field that is not text is left out, the rest of the day is kept
    expect(days[0].timings.Fajr).toBeUndefined();
    expect(days[0].timings.Dhuhr).toBe(TIMINGS.Dhuhr);
  });

  it('keeps each date once, preferring the multi-day list', () => {
    const days = cachedDays({
      day: DAY,
      timings: { ...TIMINGS, Fajr: '04:00' },
      days: [{ date: DAY, timings: TIMINGS }],
    });
    expect(days).toEqual([{ date: DAY, timings: TIMINGS }]);
  });

  it('schedules today onwards, never yesterday, at most MAX_DAYS_AHEAD days out', () => {
    const month = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-04-${String(10 + i).padStart(2, '0')}`,
      timings: TIMINGS,
    }));
    const upcoming = upcomingDays(month, at(12, 0));
    expect(upcoming[0].date).toBe(DAY);
    expect(upcoming).toHaveLength(MAX_DAYS_AHEAD);
    expect(upcoming[upcoming.length - 1].date).toBe('2026-04-26');
    // nothing at all when every saved day has gone
    expect(upcomingDays(month, new Date(2026, 4, 1, 12, 0))).toEqual([]);
  });

  it('crosses a month end on the calendar, not by adding hours', () => {
    const days = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-05', '2026-11-06'].map((date) => ({
      date,
      timings: TIMINGS,
    }));
    expect(upcomingDays(days, new Date(2026, 9, 30, 23, 0)).map((d) => d.date)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-05',
    ]);
  });
});
