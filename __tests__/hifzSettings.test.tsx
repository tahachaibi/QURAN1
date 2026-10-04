/**
 * The settings screen's restore flow and recognizer rows, rendered.
 *
 * The restore runs against the REAL ThemeProvider and a real (in-memory)
 * AsyncStorage, because the regression is the conversation between them: the
 * provider loads the settings once and saves its whole copy on every change,
 * so a restore that only wrote storage was undone by the very next toggle.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import Settings from '../app/settings';
import { parseBackup, serialiseBackup } from '../src/data/backup';
import { DEFAULT_PREFS, MISTAKE_LOG_CAP, today } from '../src/data/storage';
import { ThemeProvider } from '../src/theme/ThemeProvider';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/** what the picker hands back next; set per test */
let mockPick: { parse: unknown; detail: string } = { parse: null, detail: '' };

jest.mock('../src/data/backupFile', () => ({
  pickBackupFile: () => Promise.resolve(mockPick),
  shareBackup: () => Promise.resolve({ ok: true, detail: '', sizeBytes: 0 }),
  formatBytes: (n: number) => `${n} B`,
}));

const mockRecognizer = {
  strategy: 'RELAY' as string | null,
  capabilities: {
    sdkInt: 34,
    recognitionAvailable: true,
    onDeviceAvailable: true,
    segmentedAvailable: false,
    strategy: 'RELAY',
    segmentedProven: false,
  } as Record<string, unknown> | null,
  languageStatus: { supported: true, localeInstalled: true } as Record<string, unknown> | null,
  lastError: null,
  requestLanguagePack: () => Promise.resolve(),
};

jest.mock('../src/context/RecitationProvider', () => ({
  useRecitation: () => ({ recognizer: mockRecognizer }),
}));

jest.mock('../src/billing/BillingProvider', () => ({
  useBilling: () => ({ monetisationEnabled: false, state: { active: false } }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: () => undefined }) }));

const PREFS = 'qh:prefs:v1';
const MADE = Date.UTC(2026, 2, 14, 9, 30, 0);

/** a file as the picker would hand it back, made from `values` the way the app makes one */
const fileOf = (values: Record<string, string>): unknown =>
  parseBackup(serialiseBackup({ values, appVersion: '1.0.0', now: MADE }));

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function renderSettings(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ThemeProvider>
        <Settings />
      </ThemeProvider>,
    );
  });
  await flush();
  return tree;
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

const pressable = (tree: ReactTestRenderer, label: string): ReactTestInstance => {
  const hits = tree.root.findAll(
    (n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === label,
  );
  if (hits.length === 0) throw new Error(`nothing labelled ${label}`);
  return hits[0];
};

/** the Restore button has no label of its own; it is the pressable whose text is "Restore" */
const restoreButton = (tree: ReactTestRenderer): ReactTestInstance =>
  tree.root.findAll(
    (n) =>
      typeof n.props.onPress === 'function' &&
      n.findAll((c) => c.props.children === 'Restore').length > 0 &&
      n.props.accessibilityLabel === undefined,
  )[0];

async function press(node: ReactTestInstance): Promise<void> {
  await act(async () => {
    await node.props.onPress();
  });
  await flush();
}

const storedPrefs = async (): Promise<Record<string, unknown>> =>
  JSON.parse((await AsyncStorage.getItem(PREFS)) ?? '{}') as Record<string, unknown>;

beforeEach(async () => {
  await AsyncStorage.clear();
  // what every phone holds once the language picker has run
  await AsyncStorage.setItem(PREFS, JSON.stringify({ ...DEFAULT_PREFS, language: 'en' }));
  mockPick = { parse: null, detail: '' };
});

describe('restoring a backup', () => {
  it('takes effect at once, and is not undone by the next setting changed', async () => {
    mockPick = { parse: fileOf({ [PREFS]: JSON.stringify({ theme: 'dark', haptics: true }) }), detail: '' };
    const tree = await renderSettings();

    await press(pressable(tree, 'Restore from a backup file'));
    expect(text(tree)).toContain(`Backup made on ${today(new Date(MADE))}.`);
    await press(restoreButton(tree));

    expect(text(tree)).toContain('Backup restored.');
    expect(text(tree)).not.toContain('Close and reopen');
    // the screen shows the restored theme now, not after a restart
    expect(pressable(tree, 'Night mushaf').props.accessibilityState).toEqual({ selected: true });

    // THE REGRESSION: the provider's copy was the pre-restore one, so this
    // toggle saved theme "system" straight back over the restored "dark".
    const haptics = tree.root.findAll(
      (n) => n.props.accessibilityLabel === 'Haptics' && typeof n.props.onValueChange === 'function',
    )[0];
    await act(async () => {
      haptics.props.onValueChange(false);
    });
    await flush();
    expect(await storedPrefs()).toMatchObject({ theme: 'dark', haptics: false, language: 'en' });
    tree.unmount();
  });

  it('says plainly when the file holds nothing new, instead of offering to restore it', async () => {
    // "Restored 0 items. Close and reopen…" was the old ending to this.
    mockPick = { parse: fileOf({ 'qh:dismissed:v1': '[4]' }), detail: '' };
    await AsyncStorage.setItem('qh:dismissed:v1', '[4]');
    const tree = await renderSettings();
    await press(pressable(tree, 'Restore from a backup file'));
    expect(text(tree)).toContain('This backup holds nothing newer than what is already on this phone.');
    expect(restoreButton(tree)).toBeUndefined();
    tree.unmount();
  });

  it('names what will not fit, and admits a file it could not fully read', async () => {
    const mistake = (word: number) => ({ word, expected: 'ٱلْحَمْدُ', heardInstead: '' });
    await AsyncStorage.setItem(
      'qh:mistake-log:v1',
      JSON.stringify(Array.from({ length: MISTAKE_LOG_CAP }, (_, i) => mistake(1000 + i))),
    );
    // a hand-edited file: one entry that is not a stored string
    const damaged = JSON.parse(
      serialiseBackup({
        values: { 'qh:mistake-log:v1': JSON.stringify([mistake(1), mistake(2)]) },
        appVersion: '1.0.0',
        now: MADE,
      }),
    ) as { payload: Record<string, unknown> };
    damaged.payload['qh:dismissed:v1'] = [4];
    mockPick = { parse: parseBackup(JSON.stringify(damaged)), detail: '' };

    const tree = await renderSettings();
    await press(pressable(tree, 'Restore from a backup file'));
    const shown = text(tree);
    expect(shown).toContain('Some things on this phone will change');
    expect(shown).toContain('The 2 oldest mistakes will not be kept: the history is full.');
    expect(shown).toContain('Part of this file could not be read');
    tree.unmount();
  });
});

describe('the recognizer rows', () => {
  it('names the strategy in words rather than printing the enum', async () => {
    mockRecognizer.strategy = 'RELAY';
    const tree = await renderSettings();
    expect(text(tree)).toContain('Standard recognition');
    expect(text(tree)).not.toContain('RELAY');
    tree.unmount();
  });

  it('never prints the native module’s own English about the offline pack', async () => {
    const detail = 'On-device recognition needs Android 13 or newer; this device reports API 31.';
    mockRecognizer.languageStatus = { supported: false, detail };
    mockRecognizer.capabilities = { ...mockRecognizer.capabilities, sdkInt: 31, onDeviceAvailable: false };
    let tree = await renderSettings();
    expect(text(tree)).not.toContain(detail);
    expect(text(tree)).toContain('not available');
    tree.unmount();

    // a capable phone whose probe simply went unanswered
    mockRecognizer.languageStatus = { supported: false, detail: 'checkRecognitionSupport timed out after 4s' };
    mockRecognizer.capabilities = { ...mockRecognizer.capabilities, sdkInt: 34, onDeviceAvailable: true };
    tree = await renderSettings();
    expect(text(tree)).not.toContain('checkRecognitionSupport');
    expect(text(tree)).toContain('unknown');
    tree.unmount();
  });
});

describe('the diagnostics switch', () => {
  const dev = (global as { __DEV__?: boolean }).__DEV__;
  afterEach(() => {
    (global as { __DEV__?: boolean }).__DEV__ = dev;
  });

  it('is not on a release build, where the overlay it turns on cannot render', async () => {
    (global as { __DEV__?: boolean }).__DEV__ = false;
    const tree = await renderSettings();
    expect(text(tree)).not.toContain('Show debug overlay');
    tree.unmount();
  });

  it('is there in a development build', async () => {
    (global as { __DEV__?: boolean }).__DEV__ = true;
    const tree = await renderSettings();
    expect(text(tree)).toContain('Show debug overlay');
    tree.unmount();
  });
});
