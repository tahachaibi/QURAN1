/**
 * When the adhan sounds inside the app.
 *
 * The failure this guards against is not "the adhan did not play" but "the adhan
 * played at the wrong time": six hours late because the phone was asleep at
 * Maghrib and woken at midnight, or twice because two things noticed the same
 * prayer. Both are worse than silence, and both are arithmetic, so both are
 * tested here.
 */
import {
  adhanKey,
  DUE_GRACE_MS,
  dueAdhan,
  MAX_SLEEP_MS,
  msUntilCheck,
  timingsAreUsable,
  timingsForToday,
} from '../src/data/adhanTimer';
import { CHANNEL_ADHAN, CHANNEL_WARNING, soundFor } from '../src/data/prayerSchedule';

const TIMINGS = {
  Fajr: '05:14 (+01)',
  Sunrise: '06:40 (+01)',
  Dhuhr: '12:30 (+01)',
  Asr: '15:45 (+01)',
  Maghrib: '18:20 (+01)',
  Isha: '19:50 (+01)',
};

const at = (h: number, m: number, s = 0): Date => new Date(2026, 3, 20, h, m, s, 0);

describe('dueAdhan', () => {
  it('sounds at the exact prayer time', () => {
    const due = dueAdhan(TIMINGS, at(12, 30), null);
    expect(due?.prayer).toBe('Dhuhr');
  });

  it('still sounds inside the grace window, for a phone that woke up slowly', () => {
    expect(dueAdhan(TIMINGS, at(12, 31), null)?.prayer).toBe('Dhuhr');
    const edge = new Date(at(12, 30).getTime() + DUE_GRACE_MS);
    expect(dueAdhan(TIMINGS, edge, null)?.prayer).toBe('Dhuhr');
  });

  it('stays silent once the window has passed — a late adhan is worse than none', () => {
    const past = new Date(at(12, 30).getTime() + DUE_GRACE_MS + 1_000);
    expect(dueAdhan(TIMINGS, past, null)).toBeNull();
    expect(dueAdhan(TIMINGS, at(17, 0), null)).toBeNull();
  });

  it('stays silent before the time', () => {
    expect(dueAdhan(TIMINGS, at(12, 29, 59), null)).toBeNull();
  });

  it('never sounds the same prayer twice', () => {
    const first = dueAdhan(TIMINGS, at(12, 30), null);
    expect(first).not.toBeNull();
    expect(dueAdhan(TIMINGS, at(12, 31), (first as { key: string }).key)).toBeNull();
    // ...but a different prayer still gets through
    expect(dueAdhan(TIMINGS, at(15, 45), (first as { key: string }).key)?.prayer).toBe('Asr');
  });

  it('picks the most recent prayer, not the first of the day', () => {
    expect(dueAdhan(TIMINGS, at(19, 50), null)?.prayer).toBe('Isha');
  });

  it('ignores Sunrise, which is not a prayer', () => {
    expect(dueAdhan(TIMINGS, at(6, 40), null)).toBeNull();
  });

  it('copes with empty timings', () => {
    expect(dueAdhan({}, at(12, 30), null)).toBeNull();
  });

  it('keys by prayer and calendar day, so tomorrow sounds again', () => {
    const today = adhanKey('Fajr', at(5, 14));
    const tomorrow = adhanKey('Fajr', new Date(2026, 3, 21, 5, 14));
    expect(today).not.toBe(tomorrow);
    expect(adhanKey('Fajr', at(5, 14))).toBe(today);
  });
});

describe('msUntilCheck', () => {
  it('wakes just after the next prayer when it is close', () => {
    const ms = msUntilCheck(TIMINGS, at(12, 29, 30));
    expect(ms).toBeGreaterThan(30_000);
    expect(ms).toBeLessThanOrEqual(31_000);
  });

  it('never sleeps longer than a minute, because a long timeout is not honoured', () => {
    expect(msUntilCheck(TIMINGS, at(8, 0))).toBe(MAX_SLEEP_MS);
    expect(msUntilCheck({}, at(8, 0))).toBe(MAX_SLEEP_MS);
  });

  it('never spins, even on a clock that says the prayer is now', () => {
    expect(msUntilCheck(TIMINGS, at(12, 30))).toBeGreaterThanOrEqual(1_000);
  });
});

describe('timingsAreUsable', () => {
  it('accepts today and the last couple of days', () => {
    expect(timingsAreUsable('2026-04-20', at(12, 0))).toBe(true);
    expect(timingsAreUsable('2026-04-19', at(12, 0))).toBe(true);
    expect(timingsAreUsable('2026-04-18', at(12, 0))).toBe(true);
  });

  it('refuses stale times, which would sound the adhan at the wrong minute', () => {
    expect(timingsAreUsable('2026-04-17', at(12, 0))).toBe(false);
    expect(timingsAreUsable('2026-03-20', at(12, 0))).toBe(false);
  });

  it('refuses a future day and anything unparseable', () => {
    expect(timingsAreUsable('2026-04-21', at(12, 0))).toBe(false);
    expect(timingsAreUsable('', at(12, 0))).toBe(false);
    expect(timingsAreUsable('20-04-2026', at(12, 0))).toBe(false);
  });
});

/**
 * Saved times are wall-clock strings, so they only carry over while the clock
 * does. Morocco moves from UTC+1 to UTC+0 for Ramadan (7 February 2027) and back
 * afterwards (14 March 2027): across that night, yesterday's "13:31" is an hour
 * away from today's Dhuhr.
 */
describe('across a clock change', () => {
  /**
   * Jest hands each test file its own copy of process.env, so TZ cannot be
   * switched from in here. Africa/Casablanca's rule is played instead, by local
   * calendar day — UTC+1, except UTC+0 from 7 February to 13 March 2027 — which
   * is all the code under test asks of the clock: the offset at noon on a day.
   * Node's own tz data agrees, run with TZ=Africa/Casablanca: the offset at noon
   * is -60 on 6 February, 0 on 7 February and on 13 March, and -60 again on
   * 14 March 2027.
   */
  let offset: jest.SpyInstance;
  beforeAll(() => {
    offset = jest.spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(function (this: Date) {
      const day = this.getFullYear() * 10_000 + (this.getMonth() + 1) * 100 + this.getDate();
      return day >= 2027_02_07 && day < 2027_03_14 ? 0 : -60;
    });
  });
  afterAll(() => offset.mockRestore());

  const feb = (d: number, h: number, m = 0) => new Date(2027, 1, d, h, m);
  const BEFORE = { ...TIMINGS, Dhuhr: '13:31 (+01)' };
  const AFTER = { ...TIMINGS, Dhuhr: '12:31 (+00)' };

  it('is playing a clock change', () => {
    expect(feb(6, 12).getTimezoneOffset()).toBe(-60);
    expect(feb(7, 12).getTimezoneOffset()).toBe(0);
  });

  it('will not let the day before the change stand in for the day after', () => {
    expect(timingsAreUsable('2027-02-06', feb(7, 10))).toBe(false);
    expect(timingsAreUsable('2027-02-05', feb(8, 10))).toBe(false);
    expect(timingsForToday([{ date: '2027-02-06', timings: BEFORE }], feb(7, 10))).toBeNull();
    // the night of the change itself, before the clocks move: today is already the new day
    expect(timingsForToday([{ date: '2027-02-06', timings: BEFORE }], feb(7, 1))).toBeNull();
    // and back again at the end of Ramadan
    expect(timingsAreUsable('2027-03-13', new Date(2027, 2, 14, 10))).toBe(false);
  });

  it('still lets a recent day stand in when the clock has not changed', () => {
    expect(timingsAreUsable('2027-02-07', feb(9, 10))).toBe(true);
    expect(timingsForToday([{ date: '2027-02-07', timings: AFTER }], feb(9, 10))).toBe(AFTER);
  });

  it('uses the day’s own saved times across the change, which were calculated for it', () => {
    const days = [
      { date: '2027-02-06', timings: BEFORE },
      { date: '2027-02-07', timings: AFTER },
    ];
    const timings = timingsForToday(days, feb(7, 12, 31));
    expect(timings).toBe(AFTER);
    expect(dueAdhan(timings as Record<string, string>, feb(7, 12, 31), null)?.prayer).toBe('Dhuhr');
  });
});

describe('timingsForToday', () => {
  const yesterday = { date: '2026-04-19', timings: { ...TIMINGS, Maghrib: '18:19' } };
  const today = { date: '2026-04-20', timings: TIMINGS };
  const tomorrow = { date: '2026-04-21', timings: { ...TIMINGS, Maghrib: '18:21' } };

  it("picks today's own entry out of several days", () => {
    expect(timingsForToday([yesterday, today, tomorrow], at(12, 0))).toBe(TIMINGS);
  });

  it('moves on to the next day at midnight, with no new fetch', () => {
    expect(timingsForToday([today, tomorrow], new Date(2026, 3, 21, 0, 0, 1))).toBe(tomorrow.timings);
  });

  it('lets the most recent earlier day stand in only while it is recent', () => {
    expect(timingsForToday([yesterday], at(12, 0))).toBe(yesterday.timings);
    expect(timingsForToday([yesterday], new Date(2026, 3, 23, 12, 0))).toBeNull();
    // a day still to come is never borrowed for today
    expect(timingsForToday([tomorrow], at(12, 0))).toBeNull();
    expect(timingsForToday([], at(12, 0))).toBeNull();
  });
});

describe('soundFor', () => {
  it('never puts the adhan on the five-minute warning', () => {
    expect(soundFor(CHANNEL_WARNING, 'adhan')).toBe('default');
    expect(soundFor(CHANNEL_WARNING, null)).toBe('default');
  });

  it('puts it on the prayer-time notification when one is bundled', () => {
    expect(soundFor(CHANNEL_ADHAN, 'adhan')).toBe('adhan');
    expect(soundFor(CHANNEL_ADHAN, null)).toBe('default');
  });
});
