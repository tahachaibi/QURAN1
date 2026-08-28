/**
 * Which authority's prayer times to follow, decided from where the phone is.
 *
 * The design this replaces asked the user to choose a "calculation method" from a
 * dropdown, which is the wrong question to put to anybody: nobody thinks "I
 * follow an 18-degree Fajr angle". They think "I am in Morocco, so I follow
 * وزارة الأوقاف والشؤون الإسلامية". The phone already knows the first half, so
 * the app should work out the second.
 *
 * NOTHING IS ADJUSTED HERE. The times are the authority's own calculation, as
 * published by the API, with no minutes added or taken off. There was a
 * correction — measured against the ministry's printed table for one city — and
 * it came out on request: a number nudged in Beni Mellal is a guess everywhere
 * else, and the times should be what the source says, not what this app thinks
 * the source meant.
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
}

export const REGION_RULES: readonly RegionRule[] = [
  {
    code: 'MA',
    country: 'Morocco',
    match: /morocco|maroc/i,
    authority: 'وزارة الأوقاف والشؤون الإسلامية',
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
  };
}

/** "Beni Mellal, Morocco · وزارة الأوقاف والشؤون الإسلامية" */
export function describeRegion(city: string | null, resolved: ResolvedMethod | null): string {
  if (resolved === null) return city ?? '';
  const where = city === null || city.length === 0 ? resolved.country : `${city}, ${resolved.country}`;
  return resolved.authority === null ? `${where} · ${resolved.name}` : `${where} · ${resolved.authority}`;
}

