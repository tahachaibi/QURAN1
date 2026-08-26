/**
 * Per-prayer corrections, and the calculation-method list.
 *
 * The bug that prompted this: Maghrib firing five minutes before the real time.
 * Maghrib is sunset, so no calculation method can be blamed for it and no change
 * of method can fix it — what differs is the local convention, which publishes
 * Maghrib a few minutes after astronomical sunset. Hence a correction, applied
 * once, at the edge, so the countdown, the notification and the adhan cannot
 * disagree about when a prayer is.
 */
import {
  adjustTimings,
  clampOffset,
  describeOffsets,
  hasOffsets,
  NO_OFFSETS,
  OFFSET_LIMIT,
  shiftTime,
} from '../src/data/prayerOffsets';
import { FALLBACK_METHOD, methodName, parseMethods } from '../src/data/prayerMethods';
import { nextPrayer } from '../src/data/prayerTimes';
import { planNotifications, CHANNEL_ADHAN } from '../src/data/prayerSchedule';
import { dueAdhan } from '../src/data/adhanTimer';

const TIMINGS = {
  Fajr: '05:14 (+01)',
  Sunrise: '06:40 (+01)',
  Dhuhr: '12:30 (+01)',
  Asr: '15:45 (+01)',
  Maghrib: '18:20 (+01)',
  Isha: '19:50 (+01)',
};

describe('shiftTime', () => {
  it('moves a time later and earlier', () => {
    expect(shiftTime('18:20 (+01)', 5)).toBe('18:25');
    expect(shiftTime('18:20 (+01)', -5)).toBe('18:15');
    expect(shiftTime('05:14', 0)).toBe('05:14');
  });

  it('carries across the hour', () => {
    expect(shiftTime('18:58', 5)).toBe('19:03');
    expect(shiftTime('19:03', -5)).toBe('18:58');
  });

  it('clamps to the same day rather than wrapping', () => {
    // An Isha pushed past midnight would read as "already passed" and lose its
    // notification — a wrong time that looks like a missing feature.
    expect(shiftTime('23:50', 30)).toBe('23:59');
    expect(shiftTime('00:10', -30)).toBe('00:00');
  });

  it('passes unparseable input through untouched', () => {
    expect(shiftTime('--:--', 5)).toBe('--:--');
  });
});

describe('adjustTimings', () => {
  it('corrects only the prayer asked for', () => {
    const out = adjustTimings(TIMINGS, { ...NO_OFFSETS, Maghrib: 5 });
    expect(out.Maghrib).toBe('18:25');
    expect(out.Fajr).toBe(TIMINGS.Fajr);
    expect(out.Sunrise).toBe(TIMINGS.Sunrise);
  });

  it('returns the very same object when nothing is corrected', () => {
    // identity, not just equality: the prayer tab re-renders every second
    expect(adjustTimings(TIMINGS, NO_OFFSETS)).toBe(TIMINGS);
  });

  it('clamps a wild offset instead of trusting it', () => {
    const out = adjustTimings(TIMINGS, { ...NO_OFFSETS, Fajr: 9999 });
    expect(out.Fajr).toBe(shiftTime(TIMINGS.Fajr, OFFSET_LIMIT));
  });

  it('copes with a missing prayer', () => {
    expect(adjustTimings({ Fajr: '05:14' }, { ...NO_OFFSETS, Maghrib: 5 }).Maghrib).toBeUndefined();
  });
});

/**
 * The point of correcting at the edge: everything downstream reads the corrected
 * time without knowing corrections exist.
 */
describe('one correction moves everything downstream', () => {
  const corrected = adjustTimings(TIMINGS, { ...NO_OFFSETS, Maghrib: 5 });
  const now = new Date(2026, 3, 20, 18, 21, 0, 0); // past 18:20, before 18:25

  it('the countdown still counts down to Maghrib', () => {
    expect(nextPrayer(TIMINGS, now)?.name).toBe('Isha');
    expect(nextPrayer(corrected, now)?.name).toBe('Maghrib');
  });

  it('the notification moves with it', () => {
    const before = planNotifications({ timings: TIMINGS, warnBefore: false, adhan: true, now: new Date(2026, 3, 20, 12, 0) });
    const after = planNotifications({ timings: corrected, warnBefore: false, adhan: true, now: new Date(2026, 3, 20, 12, 0) });
    const pick = (plan: typeof before) =>
      plan.find((p) => p.channel === CHANNEL_ADHAN && p.prayer === 'Maghrib')?.at.getMinutes();
    expect(pick(before)).toBe(20);
    expect(pick(after)).toBe(25);
  });

  it('the in-app adhan moves with it', () => {
    // at 18:20 the uncorrected time is due; the corrected one is not yet
    const at1820 = new Date(2026, 3, 20, 18, 20, 0, 0);
    expect(dueAdhan(TIMINGS, at1820, null)?.prayer).toBe('Maghrib');
    expect(dueAdhan(corrected, at1820, null)).toBeNull();

    const at1825 = new Date(2026, 3, 20, 18, 25, 0, 0);
    expect(dueAdhan(corrected, at1825, null)?.prayer).toBe('Maghrib');
  });
});

describe('offset helpers', () => {
  it('knows when anything is corrected', () => {
    expect(hasOffsets(NO_OFFSETS)).toBe(false);
    expect(hasOffsets({ ...NO_OFFSETS, Asr: -1 })).toBe(true);
  });

  it('describes the corrections for the tab', () => {
    expect(describeOffsets(NO_OFFSETS)).toBe('');
    expect(describeOffsets({ ...NO_OFFSETS, Maghrib: 5, Fajr: -2 })).toBe('Fajr −2, Maghrib +5');
  });

  it('clamps and rounds', () => {
    expect(clampOffset(5.4)).toBe(5);
    expect(clampOffset(100)).toBe(OFFSET_LIMIT);
    expect(clampOffset(-100)).toBe(-OFFSET_LIMIT);
  });
});

/**
 * The method list is fetched, never written into the app: ids are Aladhan's own
 * numbering and only Aladhan is authoritative about them. So the parser has to
 * cope with whatever shape comes back, the way the reciter parser had to.
 */
describe('parseMethods', () => {
  it('reads the documented object-map shape', () => {
    const methods = parseMethods({
      code: 200,
      data: {
        MWL: { id: 3, name: 'Muslim World League', params: { Fajr: 18, Isha: 17 } },
        ISNA: { id: 2, name: 'Islamic Society of North America', params: { Fajr: 15, Isha: 15 } },
      },
    });
    expect(methods.map((m) => m.id)).toEqual([2, 3]);
    expect(methods[1].name).toBe('Muslim World League');
    expect(methods[1].detail).toContain('Fajr 18');
  });

  it('reads a plain array just as well', () => {
    const methods = parseMethods([{ id: 1, name: 'Karachi' }]);
    expect(methods).toHaveLength(1);
    expect(methods[0].detail).toBeNull();
  });

  it('drops anything without a usable id and name', () => {
    const methods = parseMethods({
      data: {
        a: { id: 5, name: 'Egyptian' },
        b: { name: 'no id' },
        c: { id: 'x', name: 'bad id' },
        d: { id: 7, name: '   ' },
        e: null,
        f: 'nonsense',
      },
    });
    expect(methods.map((m) => m.name)).toEqual(['Egyptian']);
  });

  it('survives rubbish without throwing', () => {
    expect(parseMethods(null)).toEqual([]);
    expect(parseMethods('hello')).toEqual([]);
    expect(parseMethods({ data: 42 })).toEqual([]);
  });

  it('names a method, and admits when it cannot', () => {
    const methods = parseMethods([{ id: 3, name: 'Muslim World League' }]);
    expect(methodName(methods, 3)).toBe('Muslim World League');
    expect(methodName(methods, 21)).toBe('Method 21');
    expect(methodName([], FALLBACK_METHOD)).toBe(`Method ${FALLBACK_METHOD}`);
  });
});
