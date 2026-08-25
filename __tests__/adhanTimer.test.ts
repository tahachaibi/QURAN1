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
