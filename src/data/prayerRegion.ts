/**
 * Which authority's prayer times to follow, decided from where the phone is.
 *
 * The design this replaces asked the user to choose a "calculation method" from a
 * dropdown, which is the wrong question to put to anybody: nobody thinks "I
 * follow an 18-degree Fajr angle". They think "I am in Morocco, so I follow
 * وزارة الأوقاف والشؤون الإسلامية". The phone already knows the first half, so
 * the app should work out the second.
 *
 * TWO WAYS IN, and the second is why this works outside the countries anyone
 * thought to list:
 *
 *   1. AN ALIAS, for the authorities whose timetable is not named after their
 *      country. Nobody would guess that Saudi Arabia's is "Umm al-Qura", or
 *      Malaysia's "JAKIM", or Pakistan's "Karachi", from the country name alone.
 *   2. THE COUNTRY'S OWN NAME, matched against the names the API publishes. Most
 *      national authorities are simply named after their country — Tunisia,
 *      Algeria, Qatar, Kuwait, Jordan, Turkey, Egypt, Indonesia — so a phone in
 *      any of them resolves without a rule existing for it, and so does a phone
 *      in a country added to that list next year.
 *
 * What is NOT here, and cannot be: a feed from each country's own ministry.
 * There is no such thing to point at. A handful of authorities publish an API,
 * most publish a printed table per city, and many countries have no national body
 * doing this at all. What every one of them does have is a convention, and a
 * convention is what a method is.
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
  countryName: string | null = null,
): ResolvedMethod | null {
  const code = countryCode === null ? null : countryCode.trim().toUpperCase();
  const rule = code === null ? undefined : REGION_RULES.find((r) => r.code === code);

  // 1. the alias, for authorities not named after their country
  if (rule !== undefined) {
    const method = methods.find((m) => rule.match.test(m.name));
    if (method !== undefined) {
      return {
        id: method.id,
        name: method.name,
        country: rule.country,
        authority: rule.authority ?? null,
      };
    }
  }

  // 2. the country's own name, as the phone reports it
  const name = countryName?.trim() ?? '';
  if (name.length >= 3) {
    const method = methods.find((m) => mentionsCountry(m.name, name));
    if (method !== undefined) {
      return { id: method.id, name: method.name, country: name, authority: null };
    }
  }

  return null;
}

/**
 * Does this method's name mention this country, as a WORD?
 *
 * The word boundary is the whole point. "Mali" sits inside "Malaysia", and a
 * phone in Bamako following JAKIM's timetable because of four shared letters is
 * exactly the sort of silent wrongness this file exists to prevent. \b is no use
 * here either — it is ASCII-only and these names are not.
 */
export function mentionsCountry(methodName: string, countryName: string): boolean {
  const needle = countryName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z])${needle}(?:[^a-z]|$)`, 'i').test(methodName.toLowerCase());
}

/** "Beni Mellal, Morocco · وزارة الأوقاف والشؤون الإسلامية" */
export function describeRegion(city: string | null, resolved: ResolvedMethod | null): string {
  if (resolved === null) return city ?? '';
  const where = city === null || city.length === 0 ? resolved.country : `${city}, ${resolved.country}`;
  return resolved.authority === null ? `${where} · ${resolved.name}` : `${where} · ${resolved.authority}`;
}

