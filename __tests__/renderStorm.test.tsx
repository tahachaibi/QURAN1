/**
 * The shared recitation context must not change with time alone.
 *
 * THE REGRESSION, reported from a real phone as "the app becomes a lot slow
 * when I recite several times": a 500 ms interval inside RecitationProvider set
 * `elapsedMs`, and `elapsedMs` was part of the one context every screen reads.
 * So twice a second, for as long as anybody recited, the context value changed
 * and EVERY consumer re-rendered — the mushaf, the tracker with its 126-cell
 * grid and session list, settings, the Quran tab, and the adhan provider, which
 * wraps the whole navigator and then handed out a fresh object of its own. All
 * of it to move one number that exactly one component displays.
 *
 * It worsened with use because screens stay mounted once visited, so every
 * screen opened joined the storm. Replaying the user's ten real sessions
 * through the engine ruled the engine out — 0.24 to 0.84 ms per event — which
 * is what pointed here.
 *
 * The clock now ticks inside StatsColumn. This asserts the provider itself is
 * silent while nothing is happening, which is the property that was broken.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  RecitationProvider,
  useRecitation,
  type RecitationContextValue,
} from '../src/context/RecitationProvider';

jest.mock('expo-av', () => ({
  Audio: {
    getPermissionsAsync: () => Promise.resolve({ granted: true, canAskAgain: true }),
    requestPermissionsAsync: () => Promise.resolve({ granted: true, canAskAgain: true }),
  },
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

// A stable handle, like the real hook's: a new object per render would make
// every consumer look busy for a reason unrelated to the provider.
jest.mock('../src/recognition/useRecitationRecognizer', () => {
  const { Animated: RNAnimated } = jest.requireActual('react-native');
  const handle = {
    level: new RNAnimated.Value(0),
    status: 'listening',
    lastError: null,
    heardSomething: true,
    offlineDropped: false,
    languageStatus: null,
    capabilities: null,
    watchdogRestarts: 0,
    start: () => undefined,
    stop: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    requestLanguagePack: () => Promise.resolve(),
  };
  return { useRecitationRecognizer: () => handle };
});

let api: RecitationContextValue | null = null;
let renders = 0;

/** Any screen that reads the session. It re-renders when the context changes. */
function Consumer(): null {
  api = useRecitation();
  renders++;
  return null;
}

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <RecitationProvider>
        <Consumer />
      </RecitationProvider>,
    );
  });
  await act(async () => undefined);
  return tree;
}

beforeEach(() => {
  jest.useFakeTimers();
  api = null;
  renders = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the shared recitation context', () => {
  it('does not re-render consumers while a live session is merely silent', async () => {
    const tree = await mount();
    await act(async () => {
      api?.start(0);
    });
    await act(async () => undefined);
    expect(api?.session.status).toBe('listening');

    const before = renders;
    /**
     * Five seconds of a live session in which the reciter pauses for breath:
     * no partials, no finals, nothing to show.
     *
     * Advanced in ten separate half-second steps, each in its own act(), on
     * purpose. Advancing 5000 ms in ONE act() fires all ten ticks inside a
     * single batch and React renders once — which reports the old clock as
     * costing one render when on a phone, where each tick arrives in its own
     * turn of the event loop, it cost ten. A test that understates the bug by
     * an order of magnitude is not measuring the bug.
     */
    for (let step = 0; step < 10; step++) {
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
    }
    const during = renders - before;

    expect(during).toBe(0);
    tree.unmount();
  });

  it('carries no clock and no debug reading in the shared value', async () => {
    // A structural guard, because the failure is so easy to reintroduce: add
    // one more ticking number to the context "because it is convenient", and
    // every screen in the app pays for it at the tick rate.
    const tree = await mount();
    const keys = Object.keys(api as object);
    expect(keys).not.toContain('elapsedMs');
    expect(keys).not.toContain('partialGapMs');
    tree.unmount();
  });
});
