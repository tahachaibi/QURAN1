/**
 * Choosing whose timetable to follow from where the phone is.
 *
 * The rule this file protects: the method is matched by NAME against the list the
 * API publishes, never by an id written into the app. A wrong id would produce
 * prayer times that look deliberate and are wrong; a pattern that matches nothing
 * produces a visible "could not tell", which is a far better failure.
 */
import {
  describeCorrection,
  describeRegion,
  NO_CORRECTION,
  pickMethod,
  REGION_RULES,
} from '../src/data/prayerRegion';

/** Shaped like what /v1/methods returns, names as a real list would give them. */
const METHODS = [
  { id: 2, name: 'Islamic Society of North America (ISNA)' },
  { id: 3, name: 'Muslim World League' },
  { id: 4, name: 'Umm Al-Qura University, Makkah' },
  { id: 5, name: 'Egyptian General Authority of Survey' },
  { id: 13, name: 'Diyanet İşleri Başkanlığı, Turkey' },
  { id: 18, name: 'Tunisia' },
  { id: 19, name: 'Algeria' },
  { id: 21, name: 'Morocco' },
];

describe('pickMethod', () => {
  it('follows the Moroccan ministry when the phone is in Morocco', () => {
    const resolved = pickMethod('MA', METHODS);
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe(21);
    expect(resolved?.country).toBe('Morocco');
    expect(resolved?.authority).toBe('وزارة الأوقاف والشؤون الإسلامية');
  });

  it('takes the id from the list, not from this app', () => {
    // Same country, a list that numbers Morocco differently: the id must follow
    // the list. This is the whole reason the match is on the name.
    const renumbered = [{ id: 77, name: 'Morocco' }];
    expect(pickMethod('MA', renumbered)?.id).toBe(77);
  });

  it('is case- and whitespace-insensitive about the country code', () => {
    expect(pickMethod('ma', METHODS)?.id).toBe(21);
    expect(pickMethod(' MA ', METHODS)?.id).toBe(21);
  });

  it('resolves the other countries in the table', () => {
    expect(pickMethod('DZ', METHODS)?.id).toBe(19);
    expect(pickMethod('TN', METHODS)?.id).toBe(18);
    expect(pickMethod('EG', METHODS)?.id).toBe(5);
    expect(pickMethod('SA', METHODS)?.id).toBe(4);
    expect(pickMethod('TR', METHODS)?.id).toBe(13);
  });

  it('says it does not know rather than guessing', () => {
    expect(pickMethod(null, METHODS)).toBeNull();
    // a country with no rule
    expect(pickMethod('JP', METHODS)).toBeNull();
    // a country with a rule but nothing in the list matching it
    expect(pickMethod('MY', METHODS)).toBeNull();
    expect(pickMethod('MA', [])).toBeNull();
  });

  it('leaves the authority null where it was never given to me', () => {
    // Only Morocco's authority is stated, because that is the only one I was
    // told rather than guessed. The rest show the method name instead.
    const named = REGION_RULES.filter((r) => r.authority !== undefined).map((r) => r.code);
    expect(named).toEqual(['MA']);
    expect(pickMethod('DZ', METHODS)?.authority).toBeNull();
  });

  it('has no duplicate country codes', () => {
    const codes = REGION_RULES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  /**
   * The real risk is not a pattern that fails to match — that shows up as "could
   * not tell". It is a pattern LOOSE enough to match another country's method,
   * which would silently hand someone the wrong timetable.
   */
  it('has no pattern that matches another country in the table', () => {
    for (const rule of REGION_RULES) {
      for (const other of REGION_RULES) {
        if (other.code === rule.code) continue;
        expect(rule.match.test(other.country)).toBe(false);
      }
    }
  });

  it('has no pattern that matches an unrelated method name', () => {
    const foreign = ['Islamic Society of North America (ISNA)', 'Muslim World League', 'Moonsighting Committee'];
    for (const rule of REGION_RULES) {
      for (const name of foreign) expect(rule.match.test(name)).toBe(false);
    }
  });
});

describe('describeRegion', () => {
  it('names the town and the authority', () => {
    expect(describeRegion('Beni Mellal', pickMethod('MA', METHODS))).toBe(
      'Beni Mellal, Morocco · وزارة الأوقاف والشؤون الإسلامية',
    );
  });

  it('falls back to the method name where no authority is stated', () => {
    expect(describeRegion('Oran', pickMethod('DZ', METHODS))).toBe('Oran, Algeria · Algeria');
  });

  it('copes with no town and with nothing resolved', () => {
    expect(describeRegion(null, pickMethod('MA', METHODS))).toBe(
      'Morocco · وزارة الأوقاف والشؤون الإسلامية',
    );
    expect(describeRegion('Beni Mellal', null)).toBe('Beni Mellal');
    expect(describeRegion(null, null)).toBe('');
  });
});

/**
 * The gap between a calculation and a printed timetable.
 *
 * Aladhan's Morocco method reproduces the ministry's convention, and it came out
 * right for Fajr, Dhuhr and Isha but two minutes early for Asr and three for
 * Maghrib against the ministry's published times for Beni Mellal. A convention
 * and a printed table are not the same object — the table is rounded and carries
 * its own margins — so the difference is carried as data, from measurement.
 */
describe('the published-table correction', () => {
  const METHODS = [{ id: 21, name: 'Morocco' }, { id: 19, name: 'Algeria' }];

  it('corrects Asr and Maghrib for Morocco, and nothing else', () => {
    const resolved = pickMethod('MA', METHODS);
    expect(resolved?.correction).toEqual({ Fajr: 0, Dhuhr: 0, Asr: 2, Maghrib: 3, Isha: 0 });
  });

  it('leaves countries with no measurement alone', () => {
    // A correction invented for a country nobody has checked would be worse than
    // none: it would move times that were right.
    expect(pickMethod('DZ', METHODS)?.correction).toEqual(NO_CORRECTION);
    const measured = REGION_RULES.filter((r) => r.correction !== undefined).map((r) => r.code);
    expect(measured).toEqual(['MA']);
  });

  it('describes itself for the tab', () => {
    expect(describeCorrection({ Fajr: 0, Dhuhr: 0, Asr: 2, Maghrib: 3, Isha: 0 })).toBe(
      'Asr +2, Maghrib +3',
    );
    expect(describeCorrection(NO_CORRECTION)).toBe('');
    expect(describeCorrection({ ...NO_CORRECTION, Fajr: -1 })).toBe('Fajr −1');
  });
});
