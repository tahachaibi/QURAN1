/**
 * Fetching prayer times: where the phone is, whose timetable, which days, and
 * what happens when any of that is unavailable.
 *
 * The device and the network are stood in for — expo-location, AsyncStorage and
 * fetch — so what is under test is the decisions: which days are saved, which
 * place and method a request goes out with, and what the reader is told.
 */
import * as Location from 'expo-location';

import { fetchPrayerTimes, parseCalendar, problemOf } from '../src/data/prayer';
import { fetchJson } from '../src/data/prayerMethods';
import { translate } from '../src/i18n/i18n';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => Promise.resolve(mockStore.get(key) ?? null),
    setItem: (key: string, value: string) => {
      mockStore.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      mockStore.delete(key);
      return Promise.resolve();
    },
  },
}));

jest.mock('expo-location', () => ({
  Accuracy: { Low: 2, Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
}));

const mock = (fn: unknown): jest.Mock => fn as jest.Mock;
const CACHE_KEY = 'qh:prayer-cache:v1';

const CASABLANCA = { latitude: 33.5731, longitude: -7.5898 };
/** About 300 km away: Fes, as far as "near" is concerned, is somewhere else. */
const ELSEWHERE = { latitude: 34.0331, longitude: -5.0003 };

const timings = (fajr: string) => ({
  Fajr: `${fajr} (+01)`,
  Sunrise: '07:40 (+01)',
  Dhuhr: '13:30 (+01)',
  Asr: '16:45 (+01)',
  Maghrib: '19:20 (+01)',
  Isha: '20:40 (+01)',
});
/** What the single-day request answers: today, as the API has always given it. */
const SINGLE = timings('06:28');

/** A month the way the calendar endpoint writes it, Fajr moving a minute a day. */
function calendar(year: number, month: number) {
  const length = new Date(year, month, 0).getDate();
  return {
    code: 200,
    status: 'OK',
    data: Array.from({ length }, (_, i) => {
      const d = String(i + 1).padStart(2, '0');
      return {
        timings: timings(`06:${String(i).padStart(2, '0')}`),
        date: { readable: `${d} ...`, gregorian: { date: `${d}-${String(month).padStart(2, '0')}-${year}` } },
      };
    }),
  };
}

const METHODS = {
  code: 200,
  data: {
    ISNA: { id: 2, name: 'Islamic Society of North America (ISNA)' },
    MOROCCO: { id: 21, name: 'Morocco' },
  },
};

type Route = (url: string) => unknown;
let route: Route;
const defaultRoute: Route = (url) => {
  if (url.startsWith('https://api.aladhan.com/v1/methods')) return METHODS;
  if (url.startsWith('https://api.aladhan.com/v1/timings/')) return { code: 200, data: { timings: SINGLE } };
  const month = /\/v1\/calendar\/(\d{4})\/(\d{1,2})\?/.exec(url);
  if (month !== null) return calendar(Number(month[1]), Number(month[2]));
  throw new Error(`unexpected ${url}`);
};

const fetchMock = jest.fn(async (url: string, _init?: { signal?: AbortSignal }) => {
  const body = route(url);
  return { ok: true, status: 200, json: async () => body };
});
const requested = () => fetchMock.mock.calls.map(([url]) => url);

/** The cache an earlier, successful fetch would have left behind. */
const savedCache = (extra: Record<string, unknown> = {}) => ({
  day: '2026-10-28',
  ...CASABLANCA,
  timings: timings('06:27'),
  fetchedAt: 0,
  countryCode: 'MA',
  country: 'Morocco',
  city: 'Casablanca',
  methodId: 21,
  methodName: 'Morocco',
  ...extra,
});
const save = (cache: object) => mockStore.set(CACHE_KEY, JSON.stringify(cache));
const saved = () => JSON.parse(mockStore.get(CACHE_KEY) ?? 'null');

const NOW = new Date(2026, 9, 28, 21, 30);

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  // Only the clock is fixed; timers stay real unless a test says otherwise.
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
  });
  mockStore.clear();
  route = defaultRoute;
  fetchMock.mockClear();
  mock(Location.getForegroundPermissionsAsync).mockReset().mockResolvedValue({ granted: true });
  mock(Location.requestForegroundPermissionsAsync).mockReset().mockResolvedValue({ granted: true });
  mock(Location.getLastKnownPositionAsync).mockReset().mockResolvedValue({ coords: CASABLANCA });
  mock(Location.getCurrentPositionAsync).mockReset().mockResolvedValue({ coords: CASABLANCA });
  mock(Location.reverseGeocodeAsync)
    .mockReset()
    .mockResolvedValue([{ isoCountryCode: 'MA', country: 'Morocco', city: 'Casablanca' }]);
  mock(Location.hasServicesEnabledAsync).mockReset().mockResolvedValue(true);
});

describe('several days, each with its own times', () => {
  it('saves today and the days after it, so tomorrow can be scheduled tonight', async () => {
    const day = await fetchPrayerTimes();
    expect(day.day).toBe('2026-10-28');
    expect(day.timings).toEqual(SINGLE);

    const cache = saved();
    const dates: string[] = cache.days.map((d: { date: string }) => d.date);
    // the 28th to the end of the following month: four days left in October is
    // fewer than a week, so November was asked for too
    expect(dates[0]).toBe('2026-10-28');
    expect(dates).toContain('2026-10-29');
    expect(dates[dates.length - 1]).toBe('2026-11-30');
    expect(new Set(dates).size).toBe(dates.length);
    // each day under its own date, with its own Fajr
    const fajr = (date: string) => cache.days.find((d: { date: string }) => d.date === date).timings.Fajr;
    expect(fajr('2026-10-29')).toBe('06:28 (+01)');
    expect(fajr('2026-11-02')).toBe('06:01 (+01)');
    // today itself from the single-day request the app has always made
    expect(cache.timings).toEqual(SINGLE);
    expect(fajr('2026-10-28')).toBe(SINGLE.Fajr);

    expect(requested().filter((u) => u.includes('/v1/calendar/'))).toEqual([
      expect.stringContaining('/v1/calendar/2026/10?latitude=33.5731&longitude=-7.5898&method=21'),
      expect.stringContaining('/v1/calendar/2026/11?'),
    ]);
  });

  it('asks for one month when the week ahead fits inside it', async () => {
    jest.setSystemTime(new Date(2026, 9, 4, 10, 0));
    await fetchPrayerTimes();
    expect(requested().filter((u) => u.includes('/v1/calendar/'))).toHaveLength(1);
    expect(saved().days.map((d: { date: string }) => d.date)[0]).toBe('2026-10-04');
  });

  it('still has today when the calendar fails, exactly as before', async () => {
    route = (url) => {
      if (url.includes('/v1/calendar/')) throw new Error('HTTP 500');
      return defaultRoute(url);
    };
    const day = await fetchPrayerTimes();
    expect(day.fromCache).toBe(false);
    expect(day.timings).toEqual(SINGLE);
    expect(saved().days).toEqual([{ date: '2026-10-28', timings: SINGLE }]);
  });

  it("uses the calendar's own today when the single-day request fails", async () => {
    route = (url) => {
      if (url.includes('/v1/timings/')) throw new Error('HTTP 502');
      return defaultRoute(url);
    };
    const day = await fetchPrayerTimes();
    expect(day.fromCache).toBe(false);
    expect(day.timings.Fajr).toBe('06:27 (+01)');
  });

  it("shows today's own saved times when offline, not the day they were fetched", async () => {
    // fetched three days ago, with the week after it
    save(
      savedCache({
        day: '2026-10-25',
        timings: timings('06:24'),
        days: ['25', '26', '27', '28', '29'].map((d, i) => ({ date: `2026-10-${d}`, timings: timings(`06:2${4 + i}`) })),
      }),
    );
    route = () => {
      throw new Error('Network request failed');
    };
    const day = await fetchPrayerTimes();
    expect(day.fromCache).toBe(true);
    expect(day.day).toBe('2026-10-28');
    expect(day.timings.Fajr).toBe('06:27 (+01)');
    expect(day.note).toBe("You're offline — these are today's saved times.");
  });
});

describe('parseCalendar', () => {
  it('files each entry under the date the API wrote on it', () => {
    const days = parseCalendar(calendar(2026, 2));
    expect(days).toHaveLength(28);
    expect(days[0]).toEqual({ date: '2026-02-01', timings: timings('06:00') });
    expect(days[27].date).toBe('2026-02-28');
  });

  it('skips what it cannot place rather than guessing', () => {
    expect(parseCalendar(null)).toEqual([]);
    expect(parseCalendar({ data: 'nope' })).toEqual([]);
    expect(
      parseCalendar({
        data: [
          { timings: timings('06:00') },
          { timings: timings('06:00'), date: { gregorian: { date: '2026-02-01' } } },
          { timings: 'none', date: { gregorian: { date: '01-02-2026' } } },
          { timings: timings('06:01'), date: { gregorian: { date: '02-02-2026' } } },
        ],
      }),
    ).toEqual([{ date: '2026-02-02', timings: timings('06:01') }]);
  });
});

/**
 * A geocoder that answers nothing switched a Moroccan user to the general
 * timetable — Fajr some twenty minutes late — and saved that over the good
 * answer. Near the saved place, the saved country stands.
 */
describe('when the geocoder answers nothing', () => {
  beforeEach(() => {
    mock(Location.reverseGeocodeAsync).mockRejectedValue(new Error('Service not Available'));
  });

  it("keeps the saved country's timetable where the phone was", async () => {
    save(savedCache());
    const day = await fetchPrayerTimes();
    expect(requested().find((u) => u.includes('/v1/timings/'))).toContain('method=21');
    expect(day.resolved?.country).toBe('Morocco');
    expect(day.authorityNote).toBeNull();
    expect(saved().countryCode).toBe('MA');
    expect(saved().methodId).toBe(21);
  });

  it('does not carry the old country to a phone that has moved away', async () => {
    save(savedCache());
    mock(Location.getLastKnownPositionAsync).mockResolvedValue({ coords: ELSEWHERE });
    const day = await fetchPrayerTimes();
    expect(requested().find((u) => u.includes('/v1/timings/'))).toMatch(/&method=2$/);
    expect(day.resolved).toBeNull();
    expect(day.authorityNote).toBe('Could not tell where this phone is, so these use a general calculation.');
  });
});

/**
 * No position, but the permission is there — Location switched off, or no fix
 * indoors. This used to show the last saved day without trying the network,
 * undated, for as long as it lasted.
 */
describe('with permission but no position', () => {
  beforeEach(() => {
    mock(Location.getLastKnownPositionAsync).mockResolvedValue(null);
    mock(Location.getCurrentPositionAsync).mockRejectedValue(
      new Error('Location request failed due to unsatisfied device settings'),
    );
  });

  it("fetches today's times for the saved place, with its saved method", async () => {
    save(savedCache({ day: '2026-10-20' }));
    const day = await fetchPrayerTimes();
    expect(day.fromCache).toBe(false);
    expect(day.day).toBe('2026-10-28');
    expect(day.timings).toEqual(SINGLE);
    expect(day.note).toBe('Location is unavailable right now, so these times are for the place saved last time.');
    expect(requested().find((u) => u.includes('/v1/timings/'))).toContain(
      'latitude=33.5731&longitude=-7.5898&method=21',
    );
    // no reverse geocode: without a fix it can fail, and a failure would swap
    // the country's timetable for the general one
    expect(Location.reverseGeocodeAsync).not.toHaveBeenCalled();
    expect(saved().day).toBe('2026-10-28');
    expect(saved().countryCode).toBe('MA');
  });

  it('says Location is off, rather than sending the reader to a permission they gave', async () => {
    mock(Location.hasServicesEnabledAsync).mockResolvedValue(false);
    const error = await fetchPrayerTimes().catch((e: unknown) => e);
    expect(problemOf(error)).toBe('location-off');
    expect((error as Error).message).toBe('Location is turned off on this phone. Turn it on, then tap Try again.');
  });

  it('says it could not find the phone when Location is on but there is no fix', async () => {
    const error = await fetchPrayerTimes().catch((e: unknown) => e);
    expect(problemOf(error)).toBe('no-fix');
  });
});

describe('without the location permission', () => {
  beforeEach(() => {
    mock(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: false });
    mock(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: false });
  });

  it('asks for the permission, and names it when it is refused', async () => {
    const error = await fetchPrayerTimes().catch((e: unknown) => e);
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
    expect(problemOf(error)).toBe('permission');
  });

  it('shows the saved times, dated, and sends the old coordinates nowhere', async () => {
    save(savedCache({ day: '2026-10-26' }));
    const day = await fetchPrayerTimes();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(day.fromCache).toBe(true);
    expect(day.day).toBe('2026-10-26');
    expect(day.note).toBe('Location is unavailable right now — these are the times saved for 2026-10-26.');
  });

  it("shows today's own saved times without a date when it has them", async () => {
    save(savedCache({ day: '2026-10-26', days: [{ date: '2026-10-28', timings: timings('06:27') }] }));
    const day = await fetchPrayerTimes();
    expect(day.day).toBe('2026-10-28');
    expect(day.note).toBe('Showing your last saved times — location is unavailable right now.');
  });
});

/**
 * The adhan keeps its days topped up from wherever the app is open. That must
 * never put a question in front of the reader: the prayer tab is where the
 * location permission is asked for, in context.
 */
describe('a quiet refresh', () => {
  it('never asks for the permission, and never for a new fix', async () => {
    mock(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: false });
    save(savedCache());
    await fetchPrayerTimes({ quiet: true });
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with the permission, refreshes from the last known position', async () => {
    mock(Location.getLastKnownPositionAsync).mockResolvedValue(null);
    save(savedCache({ day: '2026-10-20' }));
    const day = await fetchPrayerTimes({ quiet: true });
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(day.fromCache).toBe(false);
    expect(saved().day).toBe('2026-10-28');
  });
});

describe('in the Arabic interface', () => {
  const t = (s: string, p?: Record<string, string | number>) => translate('ar', s, p);

  it('names the country in Arabic, live and from the cache', async () => {
    mock(Location.reverseGeocodeAsync).mockResolvedValue([
      { isoCountryCode: 'MA', country: 'المغرب', city: 'الدار البيضاء' },
    ]);
    const live = await fetchPrayerTimes({ t, lang: 'ar' });
    expect(live.source).toBe('الدار البيضاء، المغرب · وزارة الأوقاف والشؤون الإسلامية');

    route = () => {
      throw new Error('Network request failed');
    };
    const offline = await fetchPrayerTimes({ t, lang: 'ar' });
    expect(offline.fromCache).toBe(true);
    expect(offline.source).toBe('الدار البيضاء، المغرب · وزارة الأوقاف والشؤون الإسلامية');
  });
});

/**
 * React Native's Android HTTP client never times out on its own, so a request
 * that connects and then goes quiet used to hang the tab forever, saved times
 * and all.
 */
describe('a request that never answers', () => {
  const hanging = (_url: string, init?: { signal?: AbortSignal }) =>
    new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
    });

  it('is given up on', async () => {
    fetchMock.mockImplementationOnce(hanging);
    await expect(fetchJson('https://api.aladhan.com/v1/methods', 30)).rejects.toThrow('Aborted');
  });

  it('ends in the saved times rather than a blank tab', async () => {
    // Every timer faked this time, so eight seconds pass at once.
    jest.useFakeTimers({ now: NOW });
    save(savedCache());
    fetchMock.mockImplementation(hanging);
    try {
      let settled = false;
      const pending = fetchPrayerTimes().finally(() => {
        settled = true;
      });
      // the methods list, then the day requests, each given up on in turn
      await jest.advanceTimersByTimeAsync(7_999);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(8_001);
      const day = await pending;
      expect(day.fromCache).toBe(true);
      expect(day.note).toBe("You're offline — these are today's saved times.");
    } finally {
      fetchMock.mockImplementation(async (url: string) => {
        const body = route(url);
        return { ok: true, status: 200, json: async () => body };
      });
    }
  });
});
