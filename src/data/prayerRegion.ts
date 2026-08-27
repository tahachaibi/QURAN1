/**
 * Which authority's prayer times to follow, decided from where the phone is.
 *
 * The design this replaces asked the user to choose a "calculation method" from a
 * dropdown, which is the wrong question to put to anybody: nobody thinks "I
 * follow an 18-degree Fajr angle". They think "I am in Morocco, so I follow
 * وزارة الأوقاف والشؤون الإسلامية". The phone already knows the first half, so
 * the app should work out the second.
 *
 * THE METHOD IS MATCHED BY NAME, NEVER BY ID. Aladhan's method numbers are its
 * own internal numbering, and the machine this was written on cannot reach the
 * API to check them; writing "21 is Morocco" from memory would have shipped a
 * screen whose label might not match the number it sends, and every prayer time
 * would then look deliberate while being wrong. So the app fetches the real list
 * at runtime and matches the country against the names the API itself gives. A
 * pattern that matches nothing costs nothing — it falls back and says so.
 */

export interface RegionRule {
  /** ISO 3166-1 alpha-2, as expo-location reports it */
  code: string;
  /** country name for the UI, in English */
  country: string;
  /**
   * Matched against the method names Aladhan returns. Deliberately loose: a
   * miss is visible and harmless, a wrong id would not be.
   */
  match: RegExp;
  /**
   * The body whose timetable this follows, written the way people there name it.
   * Only filled in where I have been told it rather than guessed — an authority
   * named from memory is exactly the sort of confident wrongness this file exists
   * to avoid.
   */
  authority?: string;
  /**
   * Minutes to add per prayer to match the authority's PUBLISHED table.
   *
   * A calculation method reproduces a convention; a national timetable is a
   * printed table, and the two differ by a minute or two because the table is
   * rounded and carries its own margins. Only measured differences go in here —
   * these are the ones reported against وزارة الأوقاف's times for Beni Mellal,
   * not a theory about what the ministry does.
   */
  correction?: Partial<Record<'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha', number>>;
}

export const REGION_RULES: readonly RegionRule[] = [
  {
    code: 'MA',
    country: 'Morocco',
    match: /morocco|maroc/i,
    authority: 'وزارة الأوقاف والشؤون الإسلامية',
    /**
     * Measured against the ministry's published times for Beni Mellal.
     *
     * Arrived at in two steps, and the first was my mistake: the first report
     * said "a difference of 2 minutes in Asr and 3 in Maghrib" and I assumed the
     * app was EARLY. A difference has a sign and that sentence did not carry one.
     * With +2/+3 applied the next report was explicit — Asr "exceeds its time by
     * 3 minutes", Maghrib by 1 — so the app was three and one minutes LATE, and
     * the true corrections are those minus what I had already added.
     */
    correction: { Asr: -1, Maghrib: 2 },
  },
  { code: 'DZ', country: 'Algeria', match: /algeri/i },
  { code: 'TN', country: 'Tunisia', match: /tunisi/i },
  { code: 'EG', country: 'Egypt', match: /egypt/i },
  { code: 'TR', country: 'Türkiye', match: /t[üu]rkiye|turkey|diyanet/i },
  { code: 'SA', country: 'Saudi Arabia', match: /umm al-?qura|makkah/i },
  { code: 'AE', country: 'United Arab Emirates', match: /dubai|emirat/i },
  { code: 'KW', country: 'Kuwait', match: /kuwait/i },
  { code: 'QA', country: 'Qatar', match: /qatar/i },
  { code: 'JO', country: 'Jordan', match: /jordan/i },
  { code: 'SG', country: 'Singapore', match: /singapore/i },
  { code: 'MY', country: 'Malaysia', match: /malaysia|jakim/i },
  { code: 'ID', country: 'Indonesia', match: /indonesia|kemenag/i },
  { code: 'PK', country: 'Pakistan', match: /karachi/i },
  { code: 'FR', country: 'France', match: /france|uoif/i },
  { code: 'PT', country: 'Portugal', match: /portugal/i },
  { code: 'RU', country: 'Russia', match: /russia/i },
];

export interface ResolvedMethod {
  id: number;
  /** the method's name, exactly as the API gave it */
  name: string;
  /** the country it was chosen for */
  country: string;
  /** the authority, where it is known */
  authority: string | null;
  /** minutes per prayer that bring the calculation onto the published table */
  correction: PrayerCorrection;
}

export type PrayerCorrection = Record<'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha', number>;

export const NO_CORRECTION: PrayerCorrection = { Fajr: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 };

/** Fill in the zeros so callers never deal with a partial record. */
function fullCorrection(partial: RegionRule['correction']): PrayerCorrection {
  return { ...NO_CORRECTION, ...(partial ?? {}) };
}

interface NamedMethod {
  id: number;
  name: string;
}

/**
 * Pick the method for a country out of the list the API returned.
 *
 * Returns null when the country is unknown to the table or the list holds nothing
 * matching — both of which the UI reports rather than papering over, because
 * "we could not tell which timetable you follow" is useful and a silently wrong
 * timetable is not.
 */
export function pickMethod(
  countryCode: string | null,
  methods: readonly NamedMethod[],
): ResolvedMethod | null {
  if (countryCode === null) return null;
  const code = countryCode.trim().toUpperCase();
  const rule = REGION_RULES.find((r) => r.code === code);
  if (rule === undefined) return null;

  const method = methods.find((m) => rule.match.test(m.name));
  if (method === undefined) return null;

  return {
    id: method.id,
    name: method.name,
    country: rule.country,
    authority: rule.authority ?? null,
    correction: fullCorrection(rule.correction),
  };
}

/** "Beni Mellal, Morocco · وزارة الأوقاف والشؤون الإسلامية" */
export function describeRegion(city: string | null, resolved: ResolvedMethod | null): string {
  if (resolved === null) return city ?? '';
  const where = city === null || city.length === 0 ? resolved.country : `${city}, ${resolved.country}`;
  return resolved.authority === null ? `${where} · ${resolved.name}` : `${where} · ${resolved.authority}`;
}

/** e.g. "Asr +2, Maghrib +3" — what was added to match the published table. */
export function describeCorrection(correction: PrayerCorrection): string {
  return (['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const)
    .filter((p) => correction[p] !== 0)
    .map((p) => `${p} ${correction[p] > 0 ? '+' : '−'}${Math.abs(correction[p])}`)
    .join(', ');
}
