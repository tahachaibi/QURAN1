/**
 * The Tracker tab, rendered against an in-memory AsyncStorage.
 *
 * The tab stays mounted after its first visit, so what matters is what it
 * shows when the reciter comes BACK to it — after a session, after "I said it
 * right", or as somebody who has never recited at all.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import TrackerScreen from '../app/(tabs)/tracker';
import { DEFAULT_PREFS, logSession, today, type LoggedSession } from '../src/data/storage';
import { applyEvidence } from '../src/engine/hifz';
import { ThemeProvider } from '../src/theme/ThemeProvider';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/** every focus effect the screen registered; `focus()` runs them again, as returning to the tab does */
const mockFocusEffects: (() => unknown)[] = [];
const mockNavigate = jest.fn();

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => ({ push: () => undefined, navigate: mockNavigate }),
    useFocusEffect: (effect: () => unknown) => {
      useEffect(() => {
        mockFocusEffects.push(effect);
        effect();
      }, [effect]);
    },
  };
});

jest.mock('../src/context/RecitationProvider', () => ({
  useRecitation: () => ({ practiseRange: () => undefined, commitSelfReport: () => Promise.resolve(0) }),
}));

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function renderTracker(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ThemeProvider>
        <TrackerScreen />
      </ThemeProvider>,
    );
  });
  await flush();
  return tree;
}

async function focus(): Promise<void> {
  await act(async () => {
    for (const effect of mockFocusEffects) effect();
  });
  await flush();
}

const text = (tree: ReactTestRenderer): string => {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) n.forEach(walk);
    else if (n !== null && typeof n === 'object' && 'children' in n) walk((n as { children: unknown }).children);
  };
  walk(tree.toJSON());
  return out.join(' ');
};

const session = (id: string, durationMs: number): LoggedSession => ({
  id,
  day: today(),
  at: Date.now(),
  surah: 1,
  wordsRecited: 29,
  versesCovered: 7,
  accuracy: 1,
  longestCleanRun: 29,
  hintsUsed: 0,
  mistakes: 0,
  durationMs,
  furthestWord: 28,
});

const clean = (ayah: number) => ({
  ayah,
  totalWords: 4,
  recitedWords: 4,
  missedWords: 0,
  hintedWords: 0,
  revealedWords: 0,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('qh:prefs:v1', JSON.stringify({ ...DEFAULT_PREFS, language: 'en' }));
  mockFocusEffects.length = 0;
  mockNavigate.mockClear();
});

describe('the Tracker tab', () => {
  it('shows a session logged elsewhere when you come back to it', async () => {
    // THE REGRESSION: it loaded once, on its first visit, and never again —
    // so a session logged from the summary card looked as if it was lost.
    const tree = await renderTracker();
    expect(text(tree)).toContain('Nothing logged yet');

    await logSession(session('s1', 60_000));
    await focus();
    expect(text(tree)).not.toContain('Nothing logged yet');
    expect(text(tree)).toContain('1 day');
    tree.unmount();
  });

  it('shows the lifetime time in hours once it passes an hour', async () => {
    // mm:ss with minutes that never roll over read as "125:03"
    await logSession(session('s1', 3_600_000));
    await logSession(session('s2', 25 * 60_000 + 3_000));
    await logSession(session('s3', 40 * 60_000));
    const tree = await renderTracker();
    expect(text(tree)).toContain('2:05:03');
    expect(text(tree)).not.toContain('125:03');
    tree.unmount();
  });

  it('leaves the words you said you got right out of what keeps tripping you', async () => {
    await AsyncStorage.setItem('qh:hifz:v1', JSON.stringify(applyEvidence({}, [clean(0)], Date.now()).deck));
    await AsyncStorage.setItem(
      'qh:mistake-log:v1',
      JSON.stringify([
        { word: 28, expected: 'الضالين', heardInstead: 'الظالين' },
        { word: 100, expected: 'يضل', heardInstead: 'يظل' },
        { word: 200, expected: 'الضحى', heardInstead: 'الظحى' },
      ]),
    );
    let tree = await renderTracker();
    expect(text(tree)).toContain('What keeps tripping you');
    tree.unmount();

    // "I said it right" on two of them: the pattern no longer has the three
    // sightings it needs, and must stop being reported
    await AsyncStorage.setItem('qh:dismissed:v1', JSON.stringify([28, 100]));
    tree = await renderTracker();
    expect(text(tree)).not.toContain('What keeps tripping you');
    tree.unmount();
  });

  it('gives somebody who has never recited a way in, not just a paragraph', async () => {
    // A reading position is only saved while a recitation runs, so a silent
    // reader has none, and the panel promised a button it never showed.
    const tree = await renderTracker();
    const button = tree.root.findAll(
      (n) =>
        typeof n.props.onPress === 'function' &&
        n.props.accessibilityLabel === 'Open the Quran and mark a page as read',
    )[0];
    expect(button).toBeDefined();
    await act(async () => {
      button.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/quran');
    tree.unmount();
  });
});
