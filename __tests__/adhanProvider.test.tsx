/**
 * The adhan provider, driven for real with the device stood in for: the saved
 * times in an in-memory AsyncStorage, expo-notifications as a queue, the player
 * as a stub, and the clock under the test's control.
 *
 * What it pins is what the reader lives with: tonight already holds tomorrow's
 * Fajr; the prayer tab's fresh times are scheduled at once; a problem names its
 * own kind; the adhan the system is playing is taken down when the app plays
 * its own; and a banner with nothing sounding neither says "Stop adhan" nor
 * stays forever.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import * as Notifications from 'expo-notifications';

import { AdhanProvider, useAdhan, type AdhanContextValue } from '../src/context/AdhanProvider';
import { fetchPrayerTimes } from '../src/data/prayer';
import { playAdhan } from '../src/data/adhanPlayer';
import { DEFAULT_PREFS, type Prefs } from '../src/data/storage';

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

let mockPrefs: Prefs;
jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({ prefs: mockPrefs }),
}));
jest.mock('../src/context/RecitationProvider', () => ({
  useRecitation: () => ({ session: { status: 'idle' } }),
}));
jest.mock('../src/data/adhanPlayer', () => ({
  playAdhan: jest.fn(),
  stopAdhan: jest.fn(() => Promise.resolve()),
}));
jest.mock('../src/data/prayer', () => ({ fetchPrayerTimes: jest.fn() }));

type Request = { content: { data: Record<string, unknown> }; trigger: { date: Date } };
const mockScheduled = new Map<string, Request & { identifier: string }>();
let mockNextId = 0;
let mockNotificationsAllowed = true;
let mockPresented: unknown[] = [];
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  addNotificationReceivedListener: jest.fn(() => ({ remove: () => undefined })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: () => undefined })),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: mockNotificationsAllowed })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: mockNotificationsAllowed })),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([...mockScheduled.values()])),
  cancelScheduledNotificationAsync: jest.fn((id: string) => {
    mockScheduled.delete(id);
    return Promise.resolve();
  }),
  scheduleNotificationAsync: jest.fn((request: Request) => {
    const identifier = `n${(mockNextId += 1)}`;
    mockScheduled.set(identifier, { ...request, identifier });
    return Promise.resolve(identifier);
  }),
  getPresentedNotificationsAsync: jest.fn(() => Promise.resolve(mockPresented)),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
}));

const CACHE_KEY = 'qh:prayer-cache:v1';
const TIMINGS = { Fajr: '05:14', Sunrise: '06:40', Dhuhr: '12:30', Asr: '15:45', Maghrib: '18:20', Isha: '19:50' };
const TOMORROW = { ...TIMINGS, Fajr: '05:13' };
const PLAYED = { ok: true, detail: '', durationMs: 213_000, opened: null, testTone: false, output: null };

const saveCache = (day: string, days: { date: string; timings: Record<string, string> }[]) =>
  mockStore.set(
    CACHE_KEY,
    JSON.stringify({ day, latitude: 33.57, longitude: -7.59, timings: days[0]?.timings ?? TIMINGS, days, fetchedAt: 0 }),
  );
const scheduledAdhans = () =>
  [...mockScheduled.values()]
    .filter((n) => n.content.data.kind === 'adhan')
    .map((n) => `${String(n.content.data.prayer)}@${n.trigger.date.getDate()} ${n.trigger.date.getHours()}:${String(n.trigger.date.getMinutes()).padStart(2, '0')}`);

let api: AdhanContextValue | null = null;
function Probe(): null {
  api = useAdhan();
  return null;
}
const current = (): AdhanContextValue => api as AdhanContextValue;

/** Let every pending promise run, and any timer already due. */
const settle = () =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

let tree: ReactTestRenderer | null = null;
async function mount(): Promise<void> {
  await act(async () => {
    tree = create(
      <AdhanProvider>
        <Probe />
      </AdhanProvider>,
    );
  });
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 3, 20, 21, 30) });
  mockStore.clear();
  mockScheduled.clear();
  mockNotificationsAllowed = true;
  mockPresented = [];
  mockPrefs = { ...DEFAULT_PREFS, language: 'en' };
  api = null;
  jest.mocked(playAdhan).mockReset().mockResolvedValue(PLAYED);
  jest.mocked(fetchPrayerTimes).mockReset().mockRejectedValue(new Error('offline'));
  jest.mocked(Notifications.dismissNotificationAsync).mockClear();
});

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = null;
  jest.useRealTimers();
});

describe('the schedule', () => {
  it('holds tomorrow’s Fajr tonight, at tomorrow’s own time', async () => {
    saveCache('2026-04-20', [
      { date: '2026-04-20', timings: TIMINGS },
      { date: '2026-04-21', timings: TOMORROW },
    ]);
    await mount();
    // 21:30, after Isha: only today's times used to be passed, so nothing was
    // left to schedule and the tab showed a red "all passed" card every night
    expect(scheduledAdhans()).toEqual(['Fajr@21 5:13', 'Dhuhr@21 12:30', 'Asr@21 15:45', 'Maghrib@21 18:20', 'Isha@21 19:50']);
    expect(current().scheduleError).toBeNull();
  });

  it('says the saved times have run out — not that notifications are off — when none is still to come', async () => {
    saveCache('2026-04-17', [{ date: '2026-04-17', timings: TIMINGS }]);
    await mount();
    expect(scheduledAdhans()).toEqual([]);
    expect(current().scheduleError?.kind).toBe('stale');
  });

  it('says notifications are off only when they are', async () => {
    mockNotificationsAllowed = false;
    saveCache('2026-04-20', [{ date: '2026-04-21', timings: TOMORROW }]);
    await mount();
    expect(current().scheduleError?.kind).toBe('permission');
  });

  it('schedules the prayer tab’s fresh times as soon as it says so', async () => {
    await mount();
    expect(scheduledAdhans()).toEqual([]);
    expect(current().scheduleError).toBeNull();
    // the prayer tab's first fetch saves the times, then calls refresh
    saveCache('2026-04-20', [
      { date: '2026-04-20', timings: TIMINGS },
      { date: '2026-04-21', timings: TOMORROW },
    ]);
    await act(async () => {
      await current().refresh();
    });
    await settle();
    expect(scheduledAdhans()).toContain('Fajr@21 5:13');
  });
});

describe('keeping the saved days topped up', () => {
  it('fetches quietly when the saved times were not fetched today', async () => {
    saveCache('2026-04-19', [
      { date: '2026-04-19', timings: TIMINGS },
      { date: '2026-04-20', timings: TIMINGS },
    ]);
    await mount();
    expect(fetchPrayerTimes).toHaveBeenCalledTimes(1);
    expect(fetchPrayerTimes).toHaveBeenCalledWith(expect.objectContaining({ quiet: true }));
  });

  it('leaves it alone when they were', async () => {
    saveCache('2026-04-20', [{ date: '2026-04-20', timings: TIMINGS }]);
    await mount();
    expect(fetchPrayerTimes).not.toHaveBeenCalled();
  });

  it('leaves it alone before the prayer tab has ever fetched, where the questions are asked', async () => {
    await mount();
    expect(fetchPrayerTimes).not.toHaveBeenCalled();
  });
});

describe('at prayer time', () => {
  const posted = {
    request: {
      identifier: 'posted',
      content: { data: { kind: 'adhan', prayer: 'Maghrib', at: new Date(2026, 3, 20, 18, 20).toISOString() } },
    },
  };

  beforeEach(() => {
    jest.setSystemTime(new Date(2026, 3, 20, 18, 19, 30));
    saveCache('2026-04-20', [{ date: '2026-04-20', timings: TIMINGS }]);
    mockPresented = [posted];
  });

  it('takes down the adhan the system is already playing before playing its own', async () => {
    await mount();
    await advance(31_000);
    expect(current().prayer).toBe('Maghrib');
    expect(playAdhan).toHaveBeenCalledTimes(1);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('posted');
    expect(current().sounding).toBe(true);
  });

  it('and Stop takes it down too', async () => {
    await mount();
    await advance(31_000);
    jest.mocked(Notifications.dismissNotificationAsync).mockClear();
    await act(async () => {
      current().dismiss();
    });
    await settle();
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('posted');
    expect(current().prayer).toBeNull();
  });

  it('with the bell off: silent, takes the system’s down, and the notice goes by itself', async () => {
    mockPrefs = { ...mockPrefs, bells: { ...mockPrefs.bells, Maghrib: false } };
    await mount();
    await advance(31_000);
    expect(current().prayer).toBe('Maghrib');
    expect(current().sounding).toBe(false);
    expect(playAdhan).not.toHaveBeenCalled();
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('posted');
    // it used to stay over the header, on every screen, until tapped
    await advance(10 * 60_000);
    expect(current().prayer).toBeNull();
  });

  it('says nothing is sounding when the recording would not play', async () => {
    jest.mocked(playAdhan).mockResolvedValue({ ...PLAYED, ok: false });
    await mount();
    await advance(31_000);
    expect(current().prayer).toBe('Maghrib');
    expect(current().sounding).toBe(false);
  });

  it('takes over from a preview, so leaving the adhan screen cannot silence it', async () => {
    await mount();
    await act(async () => {
      current().previewEntry({
        id: 'bundled',
        name: 'Abd Elmajid Essebihi',
        fileName: 'adhan.mp3',
        detail: '',
        uri: null,
        asset: 1,
        builtIn: true,
      });
    });
    expect(current().previewingId).toBe('bundled');
    await advance(31_000);
    expect(current().prayer).toBe('Maghrib');
    expect(current().previewingId).toBeNull();
  });
});

describe('the in-app timer', () => {
  it('follows the calendar past midnight with the next day’s own times', async () => {
    jest.setSystemTime(new Date(2026, 3, 20, 23, 59));
    saveCache('2026-04-20', [
      { date: '2026-04-20', timings: TIMINGS },
      { date: '2026-04-21', timings: TOMORROW },
    ]);
    await mount();
    // to 05:13:30 the next morning: tomorrow's Fajr is 05:13, a minute before
    // today's 05:14 would have put it
    await advance((5 * 60 + 14) * 60_000 + 30_000);
    expect(current().prayer).toBe('Fajr');
    expect(playAdhan).toHaveBeenCalledTimes(1);
  });
});
