/**
 * Picking a backup file — the one part of restoring that touches the disk.
 *
 * The picker shows every file on purpose (Android reports a backup that came
 * through Drive or WhatsApp as anything from application/json to nothing), so
 * a mistaken tap on a video is an ordinary event, not an edge case. It used to
 * be decoded whole into a JavaScript string before anything looked at it.
 */
import { MAX_BACKUP_BYTES, pickBackupFile } from '../src/data/backupFile';
import { BACKUP_FORMAT, SCHEMA_VERSION } from '../src/data/backup';

let mockPicked: unknown = { canceled: true, assets: null };
const mockRead = jest.fn<Promise<string>, [string, unknown?]>();
const mockDelete = jest.fn<Promise<void>, [string, unknown?]>(() => Promise.resolve());

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: () => Promise.resolve(mockPicked),
}));

/**
 * Virtual only where the module is missing: SDK 52's expo-file-system has no
 * /legacy entry point and SDK 54's does. Not virtual where it exists, because
 * a virtual mock of a real module is silently bypassed once another test in
 * the same worker has resolved the real one (the settings screen's tests do).
 */
jest.mock(
  'expo-file-system/legacy',
  () => ({
    cacheDirectory: 'file:///cache/',
    documentDirectory: 'file:///documents/',
    EncodingType: { UTF8: 'utf8' },
    readAsStringAsync: (uri: string, options?: unknown) => mockRead(uri, options),
    deleteAsync: (uri: string, options?: unknown) => mockDelete(uri, options),
    writeAsStringAsync: () => Promise.resolve(),
  }),
  {
    virtual: (() => {
      try {
        require.resolve('expo-file-system/legacy');
        return false;
      } catch {
        return true;
      }
    })(),
  },
);

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(false),
  shareAsync: () => Promise.resolve(),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const picked = (size: number | undefined) => ({
  canceled: false,
  assets: [{ uri: 'file:///cache/picked.json', name: 'picked.json', size, mimeType: 'application/json' }],
});

const backupText = JSON.stringify({
  format: BACKUP_FORMAT,
  schema: SCHEMA_VERSION,
  app: 'test',
  createdAt: 1,
  keys: ['qh:dismissed:v1'],
  payload: { 'qh:dismissed:v1': '[1]' },
});

beforeEach(() => {
  mockRead.mockReset();
  mockDelete.mockClear();
});

describe('picking a backup file', () => {
  it('refuses a file far too large to be a backup without reading it', async () => {
    mockPicked = picked(MAX_BACKUP_BYTES + 1);
    const result = await pickBackupFile();
    expect(result.parse).toBeNull();
    expect(result.detail).toBe('That file is far too large to be a Tasmee Hifz backup.');
    expect(mockRead).not.toHaveBeenCalled();
    // ...and does not leave the picker's copy of it sitting in the cache
    expect(mockDelete).toHaveBeenCalledWith('file:///cache/picked.json', { idempotent: true });
  });

  it('reads a real backup, which is a tiny fraction of the limit', async () => {
    mockPicked = picked(backupText.length);
    mockRead.mockResolvedValue(backupText);
    const result = await pickBackupFile();
    expect(result.parse?.ok).toBe(true);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('still reads a file whose size the provider did not report', async () => {
    mockPicked = picked(undefined);
    mockRead.mockResolvedValue(backupText);
    expect((await pickBackupFile()).parse?.ok).toBe(true);
  });

  it('says nothing at all when the picker was cancelled', async () => {
    mockPicked = { canceled: true, assets: null };
    expect(await pickBackupFile()).toEqual({ parse: null, detail: '' });
  });
});
