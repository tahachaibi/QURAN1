/**
 * What happens to a session nobody stopped.
 *
 * THE REGRESSION: `applyEvidence` had exactly one call site, inside
 * buildSummary, reached only from stop(). Backgrounding the app pauses the
 * recognizer and deliberately does NOT stop the session (docs/decisions.md —
 * the AppState pause fires only on 'background', and tearing the session down
 * there was rejected), so a session that was backgrounded and then killed from
 * recents contributed nothing at all: no hifz grades, no mistake history, no
 * tracker row. The app watched somebody recite for ten minutes and forgot it.
 *
 * These tests drive the real provider with a stubbed recognizer and a stubbed
 * AppState, and assert on what actually reached storage.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';

import {
  RecitationProvider,
  useRecitation,
  type RecitationContextValue,
} from '../src/context/RecitationProvider';
import type { HifzDeck } from '../src/engine/hifz';

// --- storage: a real in-memory AsyncStorage, so the assertions are on bytes ---
// Every name a jest.mock factory touches has to be `mock`-prefixed; the bodies
// below only dereference these from inside callbacks, which run in the tests.
const mockStore = new Map<string, string>();
const mockRecognizerCalls: string[] = [];
let mockCallbacks: RecognizerCallbacks | null = null;
function mockCapture(options: RecognizerCallbacks): void {
  mockCallbacks = options;
}

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (k: string) => Promise.resolve(mockStore.get(k) ?? null),
    setItem: (k: string, v: string) => {
      mockStore.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k: string) => {
      mockStore.delete(k);
      return Promise.resolve();
    },
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

/** The recognizer is the one thing no test can supply, so it is a stub. */
interface RecognizerCallbacks {
  onPartial: (e: { alternatives: string[]; emittedAt?: number }) => void;
  onFinal: (e: { alternatives: string[]; emittedAt?: number }) => void;
  onEndOfSegment: () => void;
  onSilenceTimeout: () => void;
  onInterrupted: (reason: string) => void;
}

jest.mock('../src/recognition/useRecitationRecognizer', () => {
  const { Animated: RNAnimated } = jest.requireActual('react-native');
  const level = new RNAnimated.Value(0);
  return {
    useRecitationRecognizer: (options: RecognizerCallbacks) => {
      mockCapture(options);
      return {
        level,
        status: 'listening',
        lastError: null,
        heardSomething: true,
        offlineDropped: false,
        languageStatus: null,
        watchdogRestarts: 0,
        start: () => mockRecognizerCalls.push('start'),
        stop: () => mockRecognizerCalls.push('stop'),
        pause: () => mockRecognizerCalls.push('pause'),
        resume: () => mockRecognizerCalls.push('resume'),
        requestLanguagePack: () => Promise.resolve(),
      };
    },
  };
});

/** Al-Fatiha as Android's ar-SA recognizer actually renders it. */
const FATIHA = [
  ['بسم', 'الله', 'الرحمن', 'الرحيم'],
  ['الحمد', 'لله', 'رب', 'العالمين'],
  ['الرحمن', 'الرحيم'],
  ['مالك', 'يوم', 'الدين'],
  ['اياك', 'نعبد', 'واياك', 'نستعين'],
];

let api: RecitationContextValue | null = null;
function Probe(): null {
  api = useRecitation();
  return null;
}

let appStateHandlers: ((state: AppStateStatus) => void)[] = [];

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <RecitationProvider>
        <Probe />
      </RecitationProvider>,
    );
  });
  // let the asynchronous deck load land before anything grades against it
  await act(async () => undefined);
  return tree;
}

async function reciteFatiha(utterances: readonly (readonly string[])[]): Promise<void> {
  for (const utterance of utterances) {
    await act(async () => {
      mockCallbacks?.onFinal({ alternatives: [utterance.join(' ')] });
      mockCallbacks?.onEndOfSegment();
    });
  }
}

const background = async (): Promise<void> => {
  await act(async () => {
    for (const handler of appStateHandlers) handler('background');
  });
  // the flush is a promise chain; give it a turn to settle
  await act(async () => undefined);
};

const deckInStorage = (): HifzDeck => JSON.parse(mockStore.get('qh:hifz:v1') ?? '{}') as HifzDeck;
const sessionsInStorage = (): { id: string; wordsRecited: number }[] =>
  JSON.parse(mockStore.get('qh:sessions:v1') ?? '[]') as { id: string; wordsRecited: number }[];

beforeEach(() => {
  mockStore.clear();
  mockCallbacks = null;
  mockRecognizerCalls.length = 0;
  appStateHandlers = [];
  api = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    handler: (state: AppStateStatus) => void,
  ) => {
    appStateHandlers.push(handler);
    return { remove: () => undefined };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a session that is abandoned rather than stopped', () => {
  it('still reaches the hifz deck', async () => {
    const tree = await mount();
    act(() => api?.start(0));
    await reciteFatiha(FATIHA);

    // this is the state the old code lost entirely
    expect(deckInStorage()).toEqual({});
    await background();

    const deck = deckInStorage();
    const graded = Object.keys(deck);
    expect(graded.length).toBeGreaterThan(0);
    // ayahs the voice has finished with, graded as recitation
    expect(deck[graded[0]].recitedReviews).toBe(1);
    expect(deck[graded[0]].lastSource).toBe('recited');
    tree.unmount();
  });

  it('still reaches the tracker, once', async () => {
    const tree = await mount();
    act(() => api?.start(0));
    await reciteFatiha(FATIHA);
    await background();

    const rows = sessionsInStorage();
    expect(rows).toHaveLength(1);
    expect(rows[0].wordsRecited).toBeGreaterThanOrEqual(5);

    // a second background event must not log the same session again
    await background();
    expect(sessionsInStorage()).toHaveLength(1);
    tree.unmount();
  });

  it('flushes WITHOUT tearing the session down', async () => {
    // docs/decisions.md: backgrounding must not run the full stop() path. The
    // session is still there, paused, when the reciter comes back — no summary
    // card, no recognizer teardown from this provider.
    const tree = await mount();
    act(() => api?.start(0));
    await reciteFatiha(FATIHA);
    await background();

    expect(mockRecognizerCalls).toEqual(['start']);
    expect(api?.summary).toBeNull();
    expect(api?.session.status).not.toBe('idle');
    tree.unmount();
  });

  it('does not grade the same ayah twice, however many times it flushes', async () => {
    const tree = await mount();
    act(() => api?.start(0));
    await reciteFatiha(FATIHA);
    await background();
    const first = deckInStorage();

    await background();
    await background();
    const after = deckInStorage();

    for (const key of Object.keys(first)) {
      expect(after[key].reviews).toBe(first[key].reviews);
      expect(after[key].dueAt).toBe(first[key].dueAt);
    }
    tree.unmount();
  });

  /**
   * THE REGRESSION: the fold bookkeeping used to be keyed on
   * `session.startedAt`, which the reducer RESETS on every 'resume' because it
   * is the start of the current listening stretch, not of the session. So the
   * ordinary path — background (the recognizer calls `onInterrupted`, which
   * dispatches 'pause'), come back, resume, finish — looked like a second
   * session: every ayah was graded again (reviews 1 -> 2, interval 1 -> 3 days
   * on ONE recitation of Al-Fatiha), every mistake was logged again, and the
   * tracker got a second row under a different id, which is exactly the
   * double-count the session-stable id exists to prevent.
   */
  it('survives a pause and resume without grading the same ayah twice', async () => {
    const tree = await mount();
    act(() => api?.start(0));
    await reciteFatiha(FATIHA);
    await background();
    const first = deckInStorage();
    expect(Object.keys(first).length).toBeGreaterThan(0);
    expect(sessionsInStorage()).toHaveLength(1);

    // this is what backgrounding actually does to the session, then returning
    act(() => api?.pauseSession());
    await act(async () => undefined);
    act(() => api?.resumeSession());
    await act(async () => undefined);
    await background();

    const after = deckInStorage();
    for (const key of Object.keys(first)) {
      expect(after[key].reviews).toBe(first[key].reviews);
      expect(after[key].intervalDays).toBe(first[key].intervalDays);
      expect(after[key].dueAt).toBe(first[key].dueAt);
    }
    // and one session is still one row, with the id it was first written under
    const rows = sessionsInStorage();
    expect(rows.map((r) => r.id)).toEqual([rows[0].id]);
    tree.unmount();
  });

  it('writes nothing for a session nobody actually recited into', async () => {
    const tree = await mount();
    act(() => api?.start(0));
    await background();

    expect(sessionsInStorage()).toEqual([]);
    expect(deckInStorage()).toEqual({});
    tree.unmount();
  });
});

describe('the reading position', () => {
  it('is written on the flush, not once per recited word', async () => {
    const tree = await mount();
    act(() => api?.start(0));
    await reciteFatiha(FATIHA);

    // Twenty-odd words have been matched; the old code had written the whole
    // progress map that many times by now.
    expect(mockStore.has('qh:progress:v1')).toBe(false);

    await background();
    expect(mockStore.has('qh:progress:v1')).toBe(true);
    tree.unmount();
  });
});

describe('filling the deck without reciting at all', () => {
  it('writes cards for the page, labelled as read rather than heard', async () => {
    const tree = await mount();
    let added = 0;
    await act(async () => {
      // Al-Fatiha is words 0..28: seven ayahs, no microphone involved
      added = (await api?.commitSelfReport('read', 0, 28)) ?? 0;
    });
    expect(added).toBe(7);

    const deck = deckInStorage();
    expect(Object.keys(deck)).toHaveLength(7);
    for (const card of Object.values(deck)) {
      expect(card.lastSource).toBe('self-report');
      expect(card.recitedReviews).toBe(0);
      expect(card.dueAt).toBeGreaterThan(0);
    }
    tree.unmount();
  });

  it('does not touch the recitation streak, because nobody recited', async () => {
    const tree = await mount();
    await act(async () => {
      await api?.commitSelfReport('revised', 0, 28);
    });
    expect(sessionsInStorage()).toEqual([]);
    tree.unmount();
  });

  it('is a no-op the second time inside the same sitting, and writes nothing', async () => {
    const tree = await mount();
    await act(async () => {
      await api?.commitSelfReport('read', 0, 28);
    });
    const first = mockStore.get('qh:hifz:v1');
    let again = -1;
    await act(async () => {
      again = (await api?.commitSelfReport('read', 0, 28)) ?? -1;
    });
    expect(again).toBe(0);
    expect(mockStore.get('qh:hifz:v1')).toBe(first);
    tree.unmount();
  });
});
