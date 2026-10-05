/**
 * The Listen player: which surah it opens on, and that a sound it loads can
 * always be stopped.
 *
 * expo-av is replaced by sounds whose loading the test finishes by hand, which
 * is the whole point: every bug here lived in the gap between asking for a
 * stream and getting it.
 */
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { ListenPanel } from '../src/components/ListenPanel';
import { BUILTIN_RECITERS, surahAudioUrl } from '../src/data/audio';
import { DEFAULT_PREFS } from '../src/data/storage';
import { surahInfo } from '../src/data/quran';
import { lightPalette } from '../src/theme/theme';
import { ThemeContext } from '../src/theme/themeContext';

interface FakeSound {
  uri: string;
  unloadAsync: jest.Mock;
  playAsync: jest.Mock;
  pauseAsync: jest.Mock;
  stopAsync: jest.Mock;
  setOnPlaybackStatusUpdate: jest.Mock;
  status?: (s: Record<string, unknown>) => void;
}

/** one pending load per createAsync call, finished by the test */
let mockLoads: { sound: FakeSound; finish: () => void }[] = [];

jest.mock('expo-av', () => ({
  InterruptionModeAndroid: { DoNotMix: 1 },
  Audio: {
    setAudioModeAsync: () => Promise.resolve(),
    Sound: {
      createAsync: ({ uri }: { uri: string }) =>
        new Promise((resolve) => {
          const sound: FakeSound = {
            uri,
            unloadAsync: jest.fn(() => Promise.resolve()),
            playAsync: jest.fn(() => Promise.resolve()),
            pauseAsync: jest.fn(() => Promise.resolve()),
            stopAsync: jest.fn(() => Promise.resolve()),
            setOnPlaybackStatusUpdate: jest.fn((cb) => {
              sound.status = cb;
            }),
          };
          mockLoads.push({ sound, finish: () => resolve({ sound }) });
        }),
    },
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
let mockFetch: () => Promise<unknown> = () => Promise.reject(new Error('Network request failed'));
jest.mock('../src/data/audio', () => ({
  ...jest.requireActual('../src/data/audio'),
  fetchReciters: () => mockFetch(),
}));

const reciter = BUILTIN_RECITERS[0];

async function mount(
  props: Partial<Parameters<typeof ListenPanel>[0]> = {},
  language: 'en' | 'ar' = 'en',
): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  const panel = (
    <ListenPanel
      palette={lightPalette}
      reciter={reciter.id}
      onReciterChange={() => undefined}
      onFollowWord={() => undefined}
      initialSurah={36}
      fontStep={1}
      {...props}
    />
  );
  await act(async () => {
    tree = create(
      <ThemeContext.Provider
        value={{
          palette: lightPalette,
          dark: false,
          reduceMotion: true,
          highContrast: false,
          fontStep: 1,
          prefs: { ...DEFAULT_PREFS, language },
          setPrefs: () => undefined,
        }}
      >
        {panel}
      </ThemeContext.Provider>,
    );
  });
  await act(async () => undefined);
  return tree;
}

const byLabel = (tree: ReactTestRenderer, label: string | RegExp): ReactTestInstance =>
  tree.root.find(
    (n) =>
      typeof n.props.onPress === 'function' &&
      typeof n.props.accessibilityLabel === 'string' &&
      (typeof label === 'string' ? n.props.accessibilityLabel === label : label.test(n.props.accessibilityLabel)),
  );

const press = async (node: ReactTestInstance): Promise<void> => {
  await act(async () => {
    node.props.onPress();
  });
};

const finish = async (i: number): Promise<void> => {
  await act(async () => {
    mockLoads[i].finish();
  });
  await act(async () => undefined);
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
  mockLoads = [];
  mockFetch = () => Promise.reject(new Error('Network request failed'));
});

describe('the surah it opens on', () => {
  it('is the surah that was tapped, and Play plays that one', async () => {
    const tree = await mount({ initialSurah: 36 });
    expect(textOf(tree)).toContain(surahInfo(36).name);
    await press(byLabel(tree, `Play ${surahInfo(36).transliteration}`));
    expect(mockLoads).toHaveLength(1);
    expect(mockLoads[0].sound.uri).toBe(surahAudioUrl(36, reciter.path));
    tree.unmount();
  });
});

describe('a sound that is still loading', () => {
  it('never plays once the screen has gone', async () => {
    const tree = await mount();
    await press(byLabel(tree, /^Play /));
    await act(async () => tree.unmount());
    await act(async () => mockLoads[0].finish());
    await act(async () => undefined);
    expect(mockLoads[0].sound.playAsync).not.toHaveBeenCalled();
    expect(mockLoads[0].sound.unloadAsync).toHaveBeenCalled();
  });

  it('is superseded by the next request, so two surahs never play at once', async () => {
    const tree = await mount();
    await press(byLabel(tree, 'Next surah'));
    await press(byLabel(tree, 'Next surah'));
    expect(mockLoads).toHaveLength(2);
    await finish(0);
    await finish(1);
    expect(mockLoads[0].sound.playAsync).not.toHaveBeenCalled();
    expect(mockLoads[0].sound.unloadAsync).toHaveBeenCalled();
    expect(mockLoads[1].sound.playAsync).toHaveBeenCalledTimes(1);
    // and the one playing is the one Pause reaches
    await press(byLabel(tree, 'Pause'));
    expect(mockLoads[1].sound.pauseAsync).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  it('does not start for the old reciter after a new one is picked', async () => {
    const tree = await mount();
    await press(byLabel(tree, /^Play /));
    await press(byLabel(tree, `Reciter: ${reciter.name}. Tap to change`));
    await press(byLabel(tree, BUILTIN_RECITERS[1].name));
    await finish(0);
    expect(mockLoads[0].sound.playAsync).not.toHaveBeenCalled();
    expect(mockLoads[0].sound.unloadAsync).toHaveBeenCalled();
    tree.unmount();
  });
});

describe('the ends of the Quran', () => {
  it('stops cleanly after An-Nas and can play it again', async () => {
    const tree = await mount({ initialSurah: 114 });
    await press(byLabel(tree, /^Play /));
    await finish(0);
    const sound = mockLoads[0].sound;
    await act(async () => sound.status?.({ isLoaded: true, positionMillis: 1, durationMillis: 1, didJustFinish: true }));
    expect(mockLoads).toHaveLength(1);
    expect(sound.stopAsync).toHaveBeenCalledTimes(1);
    // the button says Play again, and pressing it plays the same sound
    await press(byLabel(tree, `Play ${surahInfo(114).transliteration}`));
    expect(sound.playAsync).toHaveBeenCalledTimes(2);
    tree.unmount();
  });

  it('disables Previous on Al-Fatiha and Next on An-Nas', async () => {
    const first = await mount({ initialSurah: 1 });
    expect(byLabel(first, 'Previous surah').props.disabled).toBe(true);
    expect(byLabel(first, 'Next surah').props.disabled).toBe(false);
    first.unmount();
    const last = await mount({ initialSurah: 114 });
    expect(byLabel(last, 'Next surah').props.disabled).toBe(true);
    last.unmount();
  });
});

describe('reciting while a surah plays', () => {
  it('hands the provider a stopper that pauses the player, and takes it back', async () => {
    const register = jest.fn();
    const tree = await mount({ registerPlaybackStopper: register });
    await press(byLabel(tree, /^Play /));
    await finish(0);
    const stopper = register.mock.calls[0][0] as () => void;
    await act(async () => stopper());
    expect(mockLoads[0].sound.pauseAsync).toHaveBeenCalledTimes(1);
    expect(() => byLabel(tree, /^Play /)).not.toThrow();
    await act(async () => tree.unmount());
    expect(register).toHaveBeenLastCalledWith(null);
  });
});

describe('the reciter list in Arabic', () => {
  it('says the list could not load in Arabic, never the exception’s English', async () => {
    const tree = await mount({}, 'ar');
    await press(byLabel(tree, /^القارئ: /));
    const text = textOf(tree);
    expect(text).not.toContain('Network request failed');
    expect(text).toContain('تعذّر تحميل قائمة القرّاء');
    tree.unmount();
  });

  it('shows a reciter’s style in Arabic, and no English style at all', async () => {
    const tree = await mount({}, 'ar');
    await press(byLabel(tree, /^القارئ: /));
    const text = textOf(tree);
    expect(text).toContain('تسجيل استوديو');
    expect(text).toContain('مع الأطفال');
    expect(text).not.toContain('studio');
    expect(text).not.toContain('with children');
    tree.unmount();
  });
});
