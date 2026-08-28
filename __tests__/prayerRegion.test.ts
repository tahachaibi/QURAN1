/**
 * Choosing whose timetable to follow from where the phone is.
 *
 * The rule this file protects: the method is matched by NAME against the list the
 * API publishes, never by an id written into the app. A wrong id would produce
 * prayer times that look deliberate and are wrong; a pattern that matches nothing
 * produces a visible "could not tell", which is a far better failure.
 */
import { describeRegion, mentionsCountry, pickMethod, REGION_RULES } from '../src/data/prayerRegion';

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
 * Nothing is adjusted.
 *
 * There was a correction here — measured against the ministry's printed table for
 * Beni Mellal — and it came out on request. A number nudged in one city is a guess
 * in every other, so the tab shows what the authority's own method returns and
 * nothing else. This test exists to keep it that way: a resolved method carries a
 * name, a country and an authority, and no minutes.
 */
describe('no adjustment', () => {
  const METHODS = [{ id: 21, name: 'Morocco' }, { id: 19, name: 'Algeria' }];

  it('resolves a method without carrying any correction', () => {
    const resolved = pickMethod('MA', METHODS);
    expect(resolved).not.toBeNull();
    expect(Object.keys(resolved as object).sort()).toEqual(['authority', 'country', 'id', 'name']);
  });

  it('leaves no rule in the table able to shift a prayer time', () => {
    for (const rule of REGION_RULES) {
      expect(Object.keys(rule)).not.toContain('correction');
    }
  });
});

/**
 * Resolving by the country's own name.
 *
 * This is what makes the app work in a country nobody wrote a rule for. Most
 * national authorities are simply named after their country, so a phone reporting
 * "Tunisia" finds Tunisia's timetable without anything in the table saying so —
 * and so will a phone in a country the API adds next year.
 */
describe('resolving by country name', () => {
  const METHODS = [
    { id: 2, name: 'Islamic Society of North America (ISNA)' },
    { id: 3, name: 'Muslim World League' },
    { id: 4, name: 'Umm Al-Qura University, Makkah' },
    { id: 13, name: 'Diyanet İşleri Başkanlığı, Turkey' },
    { id: 17, name: 'JAKIM (Malaysia)' },
    { id: 18, name: 'Tunisia' },
    { id: 19, name: 'Algeria' },
    { id: 21, name: 'Morocco' },
    { id: 23, name: 'Jordan' },
  ];

  it('finds an authority named after the country, with no rule for it', () => {
    // no JO/TN entry is needed for these to work
    expect(pickMethod(null, METHODS, 'Jordan')?.id).toBe(23);
    expect(pickMethod('ZZ', METHODS, 'Tunisia')?.id).toBe(18);
    expect(pickMethod(null, METHODS, 'Algeria')?.country).toBe('Algeria');
  });

  it('prefers the alias when there is one, because it is more specific', () => {
    // "Saudi Arabia" appears in no method name; the alias knows to look for Umm al-Qura
    expect(pickMethod('SA', METHODS, 'Saudi Arabia')?.id).toBe(4);
    // and Malaysia's is named after an institution, not the country
    expect(pickMethod('MY', METHODS, 'Malaysia')?.id).toBe(17);
  });

  it('says nothing rather than guessing when no authority matches', () => {
    // China has no national body publishing a timetable, and no method is named
    // for it — so the app falls back and says so, instead of picking one.
    expect(pickMethod('CN', METHODS, 'China')).toBeNull();
    expect(pickMethod(null, METHODS, null)).toBeNull();
    expect(pickMethod(null, METHODS, 'Ne')).toBeNull();
  });

  it('matches a country as a WORD, never as a fragment', () => {
    // "Mali" is inside "Malaysia", and a phone in Bamako must not end up on
    // JAKIM's timetable because of four shared letters.
    expect(pickMethod(null, METHODS, 'Mali')).toBeNull();
    expect(mentionsCountry('JAKIM (Malaysia)', 'Mali')).toBe(false);
    expect(mentionsCountry('JAKIM (Malaysia)', 'Malaysia')).toBe(true);
    expect(mentionsCountry('Tunisia', 'Tunisia')).toBe(true);
    expect(mentionsCountry('Muslim World League', 'Oman')).toBe(false);
  });

  it('is not confused by punctuation or case in either name', () => {
    expect(mentionsCountry('Diyanet İşleri Başkanlığı, Turkey', 'turkey')).toBe(true);
    expect(mentionsCountry('Morocco', 'MOROCCO')).toBe(true);
  });
});
