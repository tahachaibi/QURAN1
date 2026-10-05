/**
 * The surah screen's wiring, against a fake recitation context.
 *
 * Everything here is a decision this screen makes on its own — which action
 * the mic button takes, what leaving does, which notice is shown, what the
 * header says, which callbacks the pages are handed — so the provider is
 * replaced by a plain object and the deck by a stub that records its props.
 * The provider has its own tests; the mushaf has MushafPage.test.tsx.
 */
import { Alert, Animated } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import SurahScreen from '../app/surah/[id]';
import { initialSession, type SessionState } from '../src/engine/session';
import {
  ayahWordRange,
  globalAyahOf,
  juzStartPage,
  pageOf,
  pageWordRange,
  wordIndexOf,
} from '../src/data/quran';
import type { SessionSummary } from '../src/context/RecitationProvider';

const mockGoToPage = jest.fn();
let mockDeckProps: Record<string, unknown> = {};
let mockListenProps: Record<string, unknown> | null = null;
let mockParams: Record<string, string | undefined> = { id: '2' };
let mockRecitation: Record<string, unknown> = {};
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => mockRouter,
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));
jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    prefs: jest.requireActual('../src/data/storage').DEFAULT_PREFS,
    setPrefs: () => undefined,
    palette: jest.requireActual('../src/theme/theme').lightPalette,
    fontStep: 1,
    reduceMotion: true,
  }),
}));
jest.mock('../src/context/RecitationProvider', () => ({
  useRecitation: () => mockRecitation,
  useRecitationDebug: () => ({ partialGapMs: 0 }),
}));
jest.mock('../src/engine/exportFixture', () => ({ exportFixture: () => Promise.resolve() }));
jest.mock('../src/components/PageDeck', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    PageDeck: React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({ goToPage: mockGoToPage }));
      mockDeckProps = props;
      return React.createElement(View, { testID: 'deck' });
    }),
  };
});
jest.mock('../src/components/ListenPanel', () => ({
  ListenPanel: (props: Record<string, unknown>) => {
    mockListenProps = props;
    return null;
  },
}));

const level = new Animated.Value(0);

function session(overrides: Partial<SessionState> = {}): SessionState {
  return { ...initialSession(wordIndexOf(2, 1)), ...overrides };
}

function recitation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const s = (overrides.session as SessionState | undefined) ?? session();
  return {
    session: s,
    recognizer: {
      status: 'idle',
      lastError: null,
      heardSomething: true,
      offlineDropped: false,
      languageStatus: null,
      requestLanguagePack: () => Promise.resolve(),
    },
    level,
    mode: 'follow',
    setMode: jest.fn(),
    viewedPage: pageOf(s.livePos),
    setViewedPage: jest.fn(),
    returnToMyPlace: jest.fn(),
    hintLevelOf: () => 0,
    requestHint: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    resumeSession: jest.fn(),
    resetStats: jest.fn(),
    seekTo: jest.fn(),
    dismissMistake: jest.fn(),
    summary: null,
    dismissSummary: jest.fn(),
    logSummaryToTracker: () => Promise.resolve(),
    interruption: null,
    clearInterruption: jest.fn(),
    silenceTimedOut: false,
    captureFixture: jest.fn(),
    micPermission: 'granted',
    openAppSettings: jest.fn(),
    setRange: jest.fn(),
    range: null,
    practiseRange: jest.fn(),
    commitSelfReport: () => Promise.resolve(0),
    registerPlaybackStopper: jest.fn(),
    ...overrides,
  };
}

async function mount(overrides: Record<string, unknown> = {}): Promise<ReactTestRenderer> {
  mockRecitation = recitation(overrides);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<SurahScreen />);
  });
  // let the seed's loadProgress() settle, then forget what it did
  await act(async () => undefined);
  jest.clearAllMocks();
  return tree;
}

async function rerender(tree: ReactTestRenderer, overrides: Record<string, unknown>): Promise<void> {
  mockRecitation = { ...mockRecitation, ...overrides };
  await act(async () => {
    tree.update(<SurahScreen />);
  });
}

/** the Pressables with this label, outermost first */
const byLabel = (tree: ReactTestRenderer, label: string): ReactTestInstance[] =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');

const press = async (node: ReactTestInstance): Promise<void> => {
  await act(async () => {
    node.props.onPress();
  });
};

const textOf = (tree: ReactTestRenderer): string => {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (n !== null && typeof n === 'object' && 'children' in n) walk((n as { children: unknown }).children);
  };
  walk(tree.toJSON());
  return out.join('');
};

beforeEach(() => {
  mockParams = { id: '2' };
  mockListenProps = null;
  mockDeckProps = {};
});

describe('the mic button', () => {
  it('RESUMES a paused session instead of starting a new one over it', async () => {
    const tree = await mount({ session: session({ status: 'paused' }) });
    const [mic] = byLabel(tree, 'Resume reciting');
    expect(mic).toBeDefined();
    await press(mic);
    expect(mockRecitation.resumeSession).toHaveBeenCalledTimes(1);
    expect(mockRecitation.start).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('starts when idle and stops when listening', async () => {
    const tree = await mount();
    await press(byLabel(tree, 'Start reciting')[0]);
    expect(mockRecitation.start).toHaveBeenCalledTimes(1);
    await rerender(tree, { session: session({ status: 'listening' }) });
    await press(byLabel(tree, 'Stop reciting')[0]);
    expect(mockRecitation.stop).toHaveBeenCalledTimes(1);
    tree.unmount();
  });
});

describe('leaving the screen', () => {
  it.each(['listening', 'paused'] as const)('stops a %s session, so the mic does not outlive the screen', async (status) => {
    const tree = await mount({ session: session({ status }) });
    await act(async () => tree.unmount());
    expect(mockRecitation.stop).toHaveBeenCalledTimes(1);
  });

  it('leaves an idle or finished session alone', async () => {
    for (const status of ['idle', 'stopped'] as const) {
      const tree = await mount({ session: session({ status }) });
      await act(async () => tree.unmount());
      expect(mockRecitation.stop).not.toHaveBeenCalled();
    }
  });
});

describe('the Listen screen', () => {
  it('opens the player on the TAPPED surah and offers no microphone', async () => {
    mockParams = { id: '36', ayah: '1', tab: 'listen' };
    // the cursor is still in Al-Fatiha from an earlier session
    const tree = await mount({ session: session({ status: 'stopped', cursor: 0, livePos: 0 }) });
    expect(mockListenProps?.initialSurah).toBe(36);
    expect(mockListenProps?.registerPlaybackStopper).toBe(mockRecitation.registerPlaybackStopper);
    expect(byLabel(tree, 'Start reciting')).toHaveLength(0);
    expect(byLabel(tree, 'Reset session stats')).toHaveLength(0);
    tree.unmount();
  });
});

describe('the header', () => {
  /** the juz a printed mushaf gives a page: the last one that starts on or before it */
  const juzOfPage = (page: number): number => {
    let juz = 1;
    for (let j = 1; j <= 30; j++) if (juzStartPage(j) <= page) juz = j;
    return juz;
  };

  it.each([22, 62, 121, 300])('names the juz of page %i, not the juz of the voice', async (page) => {
    // the voice is in Al-Baqarah 2:1, juz 1
    const tree = await mount({ viewedPage: page });
    expect(textOf(tree)).toContain(`page ${page} · juz ${juzOfPage(page)}`);
    tree.unmount();
  });

  it('keeps its space while hidden, so the page is never re-fitted', async () => {
    jest.useFakeTimers();
    try {
      const tree = await mount({ session: session({ status: 'listening' }) });
      await act(async () => {
        jest.advanceTimersByTime(2500);
      });
      const [back] = byLabel(tree, 'Back');
      expect(back).toBeDefined();
      let header: ReactTestInstance | null = back.parent;
      while (header !== null && header.props.pointerEvents === undefined) header = header.parent;
      expect(header?.props.pointerEvents).toBe('none');
      expect(header?.props.importantForAccessibility).toBe('no-hide-descendants');
      tree.unmount();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the words on the page', () => {
  it('hands the pages callbacks that survive a recognised word', async () => {
    const tree = await mount({ session: session({ status: 'listening' }) });
    const before = { press: mockDeckProps.onWordPress, long: mockDeckProps.onWordLongPress };
    const s = mockRecitation.session as SessionState;
    await rerender(tree, {
      session: { ...s, cursor: s.cursor + 1, livePos: s.livePos + 1, matched: new Set([s.cursor]) },
      start: jest.fn(),
    });
    expect(mockDeckProps.onWordPress).toBe(before.press);
    expect(mockDeckProps.onWordLongPress).toBe(before.long);
    tree.unmount();
  });

  it('in Hidden mode, seeks on a word already shown and hints only a concealed one', async () => {
    const cursor = wordIndexOf(2, 5);
    const tree = await mount({ mode: 'hidden', session: session({ cursor, livePos: cursor }) });
    const onWordPress = mockDeckProps.onWordPress as (i: number) => void;
    await act(async () => onWordPress(cursor - 3));
    expect(mockRecitation.seekTo).toHaveBeenCalledWith(cursor - 3);
    expect(mockRecitation.requestHint).not.toHaveBeenCalled();
    await act(async () => onWordPress(cursor + 2));
    expect(mockRecitation.requestHint).toHaveBeenCalledWith(cursor + 2);
    tree.unmount();
  });

  it('starts a range picked backwards at its FIRST word', async () => {
    const live = wordIndexOf(2, 5);
    const tree = await mount({ session: session({ cursor: live, livePos: live }) });
    await press(byLabel(tree, 'Practice an ayah range')[0]);
    const onWordPress = mockDeckProps.onWordPress as (i: number) => void;
    const earlier = wordIndexOf(2, 2);
    await act(async () => onWordPress(earlier));
    expect(mockRecitation.practiseRange).toHaveBeenCalledWith(earlier, live);
    expect(mockRecitation.setRange).not.toHaveBeenCalled();
    tree.unmount();
  });
});

describe('notices over the page', () => {
  it('does not offer "Return to my place" once the session is over', async () => {
    const tree = await mount({ session: session({ status: 'stopped' }), viewedPage: 40 });
    expect(textOf(tree)).not.toContain('Return to my place');
    await rerender(tree, { session: session({ status: 'listening' }) });
    expect(textOf(tree)).toContain('Return to my place');
    tree.unmount();
  });

  it('shows one notice at a time, the most urgent', async () => {
    const [from] = ayahWordRange(2, 3);
    const tree = await mount({
      range: { from, to: from + 4 },
      recognizer: {
        status: 'idle',
        lastError: null,
        heardSomething: true,
        offlineDropped: true,
        languageStatus: { supported: true, localeInstalled: false },
        requestLanguagePack: () => Promise.resolve(),
      },
    });
    const text = textOf(tree);
    expect(text).toContain('Practicing 2:3');
    expect(text).not.toContain('No offline Arabic');
    expect(text).not.toContain('Install Arabic offline pack');
    tree.unmount();
  });

  it('names both surahs of a range that crosses one', async () => {
    const from = wordIndexOf(1, 7);
    const to = wordIndexOf(2, 3);
    const tree = await mount({ range: { from, to } });
    expect(textOf(tree)).toContain('Practicing 1:7–2:3 · tap to clear');
    tree.unmount();
  });
});

describe('practising from the summary', () => {
  it('turns the deck to the ayah it practises', async () => {
    const weakAyah = globalAyahOf(wordIndexOf(2, 20));
    const summary: SessionSummary = {
      wordsRecited: 40,
      versesCovered: 5,
      accuracy: 0.9,
      longestCleanRun: 12,
      hintedWords: [],
      mistakes: [],
      durationMs: 60_000,
      furthestWord: wordIndexOf(2, 25),
      surah: 2,
      previousFurthest: null,
      graded: [{ ayah: weakAyah, grade: 2 }],
      dueNow: 0,
      autoLogged: false,
    };
    const tree = await mount({ summary, session: session({ status: 'stopped' }) });
    await press(byLabel(tree, 'Practice the weakest ayah from this session')[0]);
    const [from] = ayahWordRange(2, 20);
    expect(mockRecitation.practiseRange).toHaveBeenCalledWith(from, expect.any(Number));
    expect(mockGoToPage).toHaveBeenCalledWith(pageOf(from), false);
    expect(pageWordRange(pageOf(from))[0]).toBeLessThanOrEqual(from);
    tree.unmount();
  });
});

describe('resetting the session', () => {
  it('asks before wiping the figures', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const tree = await mount({ session: session({ status: 'listening' }) });
    await press(byLabel(tree, 'Reset session stats')[0]);
    expect(mockRecitation.resetStats).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    const buttons = alert.mock.calls[0][2] as { text: string; style?: string; onPress?: () => void }[];
    buttons.find((b) => b.style === 'destructive')?.onPress?.();
    expect(mockRecitation.resetStats).toHaveBeenCalledTimes(1);
    alert.mockRestore();
    tree.unmount();
  });
});
