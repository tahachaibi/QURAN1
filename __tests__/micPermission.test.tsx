/**
 * Asking for the microphone at the moment somebody reaches for it.
 *
 * THE REGRESSION: the permission was requested exactly once, on the last card
 * of onboarding (app/onboarding.tsx), and `setOnboarded()` ran whether or not
 * it was granted. `start()` then called `recognizer.start()` unconditionally.
 * So anybody who tapped "Don't allow" — or who revoked it later, or whose
 * permission Android auto-revoked for an unused app, which it does by default —
 * arrived at the mushaf with a microphone button that opened the recogniser,
 * failed inside the Kotlin, and reported "Could not create a SpeechRecognizer".
 * True, and useless: the one thing that would fix it is a settings screen the
 * app never offered to open.
 *
 * These drive the real provider with a stubbed OS permission and assert what it
 * does about it.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  RecitationProvider,
  useRecitation,
  type RecitationContextValue,
} from '../src/context/RecitationProvider';

const mockRecognizer: string[] = [];
let mockGranted = true;
let mockCanAskAgain = true;
let mockAsked = 0;
let mockOpenedSettings = 0;

jest.mock('expo-av', () => ({
  Audio: {
    getPermissionsAsync: () =>
      Promise.resolve({ granted: mockGranted, canAskAgain: mockCanAskAgain }),
    requestPermissionsAsync: () => {
      mockAsked++;
      return Promise.resolve({ granted: mockGranted, canAskAgain: mockCanAskAgain });
    },
  },
}));

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openSettings: () => {
    mockOpenedSettings++;
    return Promise.resolve();
  },
  addEventListener: () => ({ remove: () => undefined }),
  getInitialURL: () => Promise.resolve(null),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Warning: 'warning' },
}));
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: () => Promise.resolve(),
  deactivateKeepAwake: () => undefined,
}));
jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    prefs: jest.requireActual('../src/data/storage').DEFAULT_PREFS,
    palette: jest.requireActual('../src/theme/theme').lightPalette,
    fontStep: 1,
    reduceMotion: true,
  }),
}));

let mockError: { code: number; name: string; transient: boolean; message: string } | null = null;

jest.mock('../src/recognition/useRecitationRecognizer', () => {
  const { Animated: RNAnimated } = jest.requireActual('react-native');
  const level = new RNAnimated.Value(0);
  return {
    useRecitationRecognizer: () => ({
      level,
      status: 'idle',
      lastError: mockError,
      heardSomething: false,
      offlineDropped: false,
      languageStatus: null,
      capabilities: null,
      watchdogRestarts: 0,
      start: () => mockRecognizer.push('start'),
      stop: () => mockRecognizer.push('stop'),
      pause: () => undefined,
      resume: () => undefined,
      requestLanguagePack: () => Promise.resolve(),
    }),
  };
});

let api: RecitationContextValue | null = null;
function Probe(): null {
  api = useRecitation();
  return null;
}

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <RecitationProvider>
        <Probe />
      </RecitationProvider>,
    );
  });
  await act(async () => undefined);
  return tree;
}

beforeEach(() => {
  mockRecognizer.length = 0;
  mockGranted = true;
  mockCanAskAgain = true;
  mockAsked = 0;
  mockOpenedSettings = 0;
  mockError = null;
  api = null;
});

describe('the microphone is asked for when it is reached for', () => {
  it('opens the recogniser once permission is granted', async () => {
    const tree = await mount();
    await act(async () => {
      api?.start(0);
    });
    await act(async () => undefined);
    expect(mockRecognizer).toContain('start');
    expect(api?.micPermission).toBe('granted');
    tree.unmount();
  });

  it('does NOT open the recogniser when permission is refused', async () => {
    mockGranted = false;
    const tree = await mount();
    await act(async () => {
      api?.start(0);
    });
    await act(async () => undefined);
    // the old code called start() regardless and let the Kotlin fail
    expect(mockRecognizer).not.toContain('start');
    expect(api?.micPermission).toBe('denied');
    tree.unmount();
  });

  it('reports blocked, and does not ask, when Android has stopped showing the dialog', async () => {
    mockGranted = false;
    mockCanAskAgain = false;
    const tree = await mount();
    await act(async () => {
      api?.start(0);
    });
    await act(async () => undefined);
    // Asking again would resolve instantly as denied and look like the button
    // did nothing, so it must not be asked at all.
    expect(mockAsked).toBe(0);
    expect(api?.micPermission).toBe('blocked');
    tree.unmount();
  });

  it('offers the one route out of blocked', async () => {
    const tree = await mount();
    act(() => api?.openAppSettings());
    expect(mockOpenedSettings).toBe(1);
    tree.unmount();
  });

  it('asks only once while it stays granted', async () => {
    const tree = await mount();
    for (const at of [0, 10, 20]) {
      await act(async () => {
        api?.start(at);
      });
      await act(async () => undefined);
    }
    // A permission round trip before every session would put a tick between
    // tapping the mic and the mic opening, which is what §5.7 is about.
    expect(mockAsked).toBeLessThanOrEqual(1);
    expect(mockRecognizer.filter((c) => c === 'start')).toHaveLength(3);
    tree.unmount();
  });

  it('recovers when Android revokes the microphone behind the app', async () => {
    const tree = await mount();
    await act(async () => {
      api?.start(0);
    });
    await act(async () => undefined);
    expect(api?.micPermission).toBe('granted');

    // Android revokes it — the user in settings, or the system itself for an
    // app that has not been opened in a while, which is the default.
    mockGranted = false;
    mockCanAskAgain = false;
    mockError = {
      code: -1,
      name: 'create-failed',
      transient: false,
      message: 'Could not create a SpeechRecognizer. Is RECORD_AUDIO granted?',
    };
    await act(async () => {
      tree.update(
        <RecitationProvider>
          <Probe />
        </RecitationProvider>,
      );
    });
    await act(async () => undefined);

    // Without this the cached "granted" would stand forever and every later
    // tap would fail the same silent way.
    expect(api?.micPermission).toBe('blocked');
    tree.unmount();
  });
});
