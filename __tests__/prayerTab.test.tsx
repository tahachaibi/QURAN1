/**
 * The prayer tab, with the fetching and the adhan stood in for.
 *
 * What it pins: the screen tells the adhan when it has new times, loads again
 * when the day changes, never refetches for a minute-correction tap, shows
 * something while it waits, names a problem's own way out, and reads its rows
 * to TalkBack in the interface's language.
 */
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { Text } from 'react-native';

import PrayerScreen from '../app/(tabs)/index';
import { fetchPrayerTimes, type PrayerDay } from '../src/data/prayer';
import { DEFAULT_PREFS, type Prefs } from '../src/data/storage';
import { ThemeContext, type ThemeContextValue } from '../src/theme/themeContext';
import { lightPalette } from '../src/theme/theme';
import type { AdhanContextValue } from '../src/context/AdhanProvider';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve(), removeItem: () => Promise.resolve() },
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: () => undefined }) }));

let mockOpenedSettings = 0;
// Linking is an ES module default export since React Native 0.79, and the
// module itself before that; the stand-in is both, so it fits either.
jest.mock('react-native/Libraries/Linking/Linking', () => {
  const linking = {
    openSettings: () => {
      mockOpenedSettings++;
      return Promise.resolve();
    },
    addEventListener: () => ({ remove: () => undefined }),
    getInitialURL: () => Promise.resolve(null),
  };
  return { __esModule: true, default: linking, ...linking };
});

let mockPrefs: Prefs;
jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    palette: jest.requireActual('../src/theme/theme').lightPalette,
    prefs: mockPrefs,
    setPrefs: () => undefined,
  }),
}));

let mockAdhan: AdhanContextValue;
jest.mock('../src/context/AdhanProvider', () => ({ useAdhan: () => mockAdhan }));

// The arithmetic is real; only the fetch is stood in for.
jest.mock('../src/data/prayer', () => ({
  ...jest.requireActual('../src/data/prayerTimes'),
  fetchPrayerTimes: jest.fn(),
  problemOf: (e: unknown) => (e as { problem?: string } | null)?.problem ?? null,
}));

const TIMINGS = { Fajr: '05:14', Sunrise: '06:40', Dhuhr: '12:30', Asr: '15:45', Maghrib: '18:20', Isha: '19:50' };
const DAY: PrayerDay = {
  timings: TIMINGS,
  source: 'Casablanca, Morocco · وزارة الأوقاف والشؤون الإسلامية',
  resolved: { id: 21, name: 'Morocco', country: 'Morocco', authority: 'وزارة الأوقاف والشؤون الإسلامية' },
  authorityNote: null,
  day: '2026-04-20',
  fromCache: false,
  note: null,
};

const refresh = jest.fn(() => Promise.resolve());

function screen(language: 'en' | 'ar' = 'en') {
  mockPrefs = { ...mockPrefs, language };
  const theme: ThemeContextValue = {
    palette: lightPalette,
    dark: false,
    reduceMotion: true,
    highContrast: false,
    fontStep: 1,
    prefs: mockPrefs,
    setPrefs: () => undefined,
  };
  return (
    <ThemeContext.Provider value={theme}>
      <PrayerScreen />
    </ThemeContext.Provider>
  );
}

let tree: ReactTestRenderer | null = null;
async function mount(language: 'en' | 'ar' = 'en'): Promise<ReactTestRenderer> {
  await act(async () => {
    tree = create(screen(language));
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  return tree as unknown as ReactTestRenderer;
}

const texts = (root: ReactTestRenderer): string[] =>
  root.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const labelled = (root: ReactTestRenderer, label: string): ReactTestInstance[] =>
  root.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.type === 'string');
const press = async (root: ReactTestRenderer, label: string) => {
  const [button] = root.root.findAll((node) => node.props.accessibilityLabel === label && node.props.onPress);
  await act(async () => {
    button.props.onPress();
    await jest.advanceTimersByTimeAsync(0);
  });
};

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 3, 20, 16, 0) });
  mockPrefs = { ...DEFAULT_PREFS, language: 'en' };
  mockAdhan = {
    prayer: null,
    sounding: false,
    dismiss: () => undefined,
    previewEntry: () => undefined,
    previewingId: null,
    stopPreview: () => undefined,
    scheduleError: null,
    refresh,
  };
  mockOpenedSettings = 0;
  refresh.mockClear();
  jest.mocked(fetchPrayerTimes).mockReset().mockResolvedValue(DAY);
});

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = null;
  jest.useRealTimers();
});

describe('loading', () => {
  it('shows that it is working while the times are on their way', async () => {
    jest.mocked(fetchPrayerTimes).mockReturnValue(new Promise(() => undefined));
    const root = await mount();
    expect(labelled(root, 'Loading prayer times')).toHaveLength(1);
  });

  it('tells the adhan as soon as it has the times, so they are scheduled now', async () => {
    await mount();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('loads again when the day changes, without being asked', async () => {
    jest.setSystemTime(new Date(2026, 3, 20, 23, 59, 50));
    await mount();
    expect(fetchPrayerTimes).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchPrayerTimes).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000); // past midnight
    });
    expect(fetchPrayerTimes).toHaveBeenCalledTimes(2);
  });
});

describe('the reader’s minute corrections', () => {
  it('are applied as the screen draws, with no new request', async () => {
    const root = await mount();
    expect(jest.mocked(fetchPrayerTimes).mock.calls[0][0]).not.toHaveProperty('offsets');
    expect(texts(root)).toContain('18:20');

    mockPrefs = { ...mockPrefs, prayerOffsets: { ...mockPrefs.prayerOffsets, Maghrib: 3 } };
    await act(async () => {
      root.update(screen());
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(texts(root)).toContain('18:23');
    expect(fetchPrayerTimes).toHaveBeenCalledTimes(1);
  });
});

describe('the rows, to a screen reader', () => {
  it('are read in Arabic in the Arabic interface', async () => {
    const root = await mount('ar');
    // 16:00: Fajr to Asr have passed, Maghrib is next
    expect(labelled(root, 'صلاة الفجر الساعة 05:14، وقد مضى وقتها')).toHaveLength(1);
    expect(labelled(root, 'صلاة المغرب الساعة 18:20، وهي القادمة')).toHaveLength(1);
    expect(labelled(root, 'صلاة العشاء الساعة 19:50')).toHaveLength(1);
  });

  it('and in English in English', async () => {
    const root = await mount('en');
    expect(labelled(root, 'Fajr at 05:14, passed')).toHaveLength(1);
    expect(labelled(root, 'Maghrib at 18:20, next')).toHaveLength(1);
  });
});

describe('problems', () => {
  it('offers the settings page for a refused location permission, and only then', async () => {
    jest
      .mocked(fetchPrayerTimes)
      .mockRejectedValue(Object.assign(new Error('Prayer times need your location once.'), { problem: 'permission' }));
    const root = await mount();
    await press(root, "Open this app's system settings");
    expect(mockOpenedSettings).toBe(1);

    jest
      .mocked(fetchPrayerTimes)
      .mockRejectedValue(Object.assign(new Error('Location is turned off.'), { problem: 'location-off' }));
    await press(root, 'Try again');
    expect(texts(root)).toContain('Location is turned off.');
    expect(labelled(root, "Open this app's system settings")).toHaveLength(0);
  });

  it('shows a note that came with fresh times, not only an offline one', async () => {
    jest.mocked(fetchPrayerTimes).mockResolvedValue({
      ...DAY,
      note: 'Location is unavailable right now, so these times are for the place saved last time.',
    });
    const root = await mount();
    expect(texts(root)).toContain('Location is unavailable right now, so these times are for the place saved last time.');
  });

  it('for times that have run out: a way to refresh them, and nothing about permission', async () => {
    mockAdhan = { ...mockAdhan, scheduleError: { kind: 'stale', text: 'The saved prayer times have run out.' } };
    const root = await mount();
    expect(texts(root)).toContain('The saved prayer times have run out.');
    expect(labelled(root, "Open this app's system settings")).toHaveLength(0);
    expect(labelled(root, 'Check again for notification permission')).toHaveLength(0);
    await press(root, 'Refresh prayer times');
    expect(fetchPrayerTimes).toHaveBeenCalledTimes(2);
  });

  it('for refused notifications: "Check again" asks the adhan, not the network', async () => {
    mockAdhan = { ...mockAdhan, scheduleError: { kind: 'permission', text: 'Notifications are turned off.' } };
    const root = await mount();
    refresh.mockClear();
    await press(root, 'Check again for notification permission');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchPrayerTimes).toHaveBeenCalledTimes(1);
  });
});
