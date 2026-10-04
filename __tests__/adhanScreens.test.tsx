/**
 * The adhan banner and the adhan library screen.
 *
 * The banner must not offer to stop a sound that is not playing; the library
 * screen must not leave a preview playing behind it, and must say — once a
 * recording of the reader's own is chosen — that a closed app cannot play it.
 */
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import AdhanScreen from '../app/adhan';
import { AdhanBanner } from '../src/components/AdhanBanner';
import { DEFAULT_PREFS, type Prefs } from '../src/data/storage';
import type { AdhanContextValue } from '../src/context/AdhanProvider';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve(), removeItem: () => Promise.resolve() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/data/adhanFile', () => ({
  forgetChosenAdhan: () => Promise.resolve(),
  formatSize: () => '',
  pickAdhanFile: () => Promise.resolve({ ok: false, chosen: null, detail: '' }),
}));

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

const stopPreview = jest.fn();
const NOTE = 'Plays when Tasmee Hifz is open. With the app closed, the notification uses the built-in adhan.';

beforeEach(() => {
  mockPrefs = { ...DEFAULT_PREFS, language: 'en' };
  mockAdhan = {
    prayer: null,
    sounding: false,
    dismiss: () => undefined,
    previewEntry: () => undefined,
    previewingId: null,
    stopPreview,
    scheduleError: null,
    refresh: () => Promise.resolve(),
  };
  stopPreview.mockClear();
});

const render = (node: ReactElement): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(node);
  });
  return tree;
};
const texts = (tree: ReactTestRenderer): string[] =>
  tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const button = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => node.props.accessibilityRole === 'button' && node.props.onPress)[0];

describe('the adhan banner', () => {
  it('offers to stop the adhan while it is sounding', () => {
    mockAdhan = { ...mockAdhan, prayer: 'Maghrib', sounding: true };
    const tree = render(<AdhanBanner />);
    expect(button(tree).props.accessibilityLabel).toBe('Stop the adhan');
    expect(texts(tree)).toContain('Stop adhan');
  });

  it('does not offer to stop a silence: bell off, microphone live, or a recording that would not play', () => {
    mockAdhan = { ...mockAdhan, prayer: 'Maghrib', sounding: false };
    const tree = render(<AdhanBanner />);
    expect(button(tree).props.accessibilityLabel).toBe('Dismiss');
    expect(texts(tree)).not.toContain('Stop adhan');
  });
});

describe('the adhan library screen', () => {
  it('stops a preview when it is left', () => {
    mockAdhan = { ...mockAdhan, previewingId: 'bundled' };
    const tree = render(<AdhanScreen />);
    act(() => tree.unmount());
    expect(stopPreview).toHaveBeenCalledTimes(1);
  });

  it('leaves alone what is not its preview — a prayer-time adhan that took over', () => {
    const tree = render(<AdhanScreen />);
    act(() => tree.unmount());
    expect(stopPreview).not.toHaveBeenCalled();
  });

  it('says a recording of the reader’s own plays only while the app is open, once one is chosen', () => {
    const builtIn = render(<AdhanScreen />);
    expect(texts(builtIn)).not.toContain(NOTE);
    act(() => builtIn.unmount());

    mockPrefs = {
      ...mockPrefs,
      addedAdhans: [{ id: 'added-1', name: 'Mosque', fileName: 'mosque.mp3', detail: '', uri: 'file:///a.mp3' }],
      adhanSelectedId: 'added-1',
    };
    const own = render(<AdhanScreen />);
    expect(texts(own)).toContain(NOTE);
  });
});
