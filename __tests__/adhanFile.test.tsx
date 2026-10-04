/**
 * Copying a chosen recording into the app's own storage.
 *
 * Every recording used to be copied to the same name, from when the app kept a
 * single chosen adhan: a second MP3 overwrote the first, both rows then played
 * the second, and removing either deleted the file the other pointed at.
 *
 * In the app project, with the other device-facing modules.
 */
import * as DocumentPicker from 'expo-document-picker';

import { forgetChosenAdhan, pickAdhanFile } from '../src/data/adhanFile';

const mockFiles = new Map<string, string>();

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
// Virtual: the path-based API moved to /legacy in SDK 54, and these stand-ins
// are all the test needs of it, whichever SDK is installed.
jest.mock(
  'expo-file-system/legacy',
  () => ({
    documentDirectory: 'file:///data/user/0/app/files/',
    cacheDirectory: 'file:///data/user/0/app/cache/',
    copyAsync: jest.fn(({ from, to }: { from: string; to: string }) => {
      mockFiles.set(to, mockFiles.get(from) ?? '');
      return Promise.resolve();
    }),
    deleteAsync: jest.fn((uri: string) => {
      mockFiles.delete(uri);
      return Promise.resolve();
    }),
    getInfoAsync: jest.fn((uri: string) =>
      Promise.resolve(mockFiles.has(uri) ? { exists: true, size: (mockFiles.get(uri) ?? '').length } : { exists: false }),
    ),
  }),
  { virtual: true },
);

const picks = (name: string, contents: string) => {
  const uri = `file:///data/user/0/app/cache/DocumentPicker/${name}`;
  mockFiles.set(uri, contents);
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri, name, size: contents.length, mimeType: 'audio/mpeg', lastModified: 0 }],
  } as never);
};

beforeEach(() => mockFiles.clear());

describe('pickAdhanFile', () => {
  it('copies each recording to a file of its own', async () => {
    picks('mosque.mp3', 'AAAA');
    const first = await pickAdhanFile();
    picks('makkah.mp3', 'BBBBBB');
    const second = await pickAdhanFile();

    expect(first.ok && second.ok).toBe(true);
    const a = first.chosen?.uri as string;
    const b = second.chosen?.uri as string;
    expect(a).not.toBe(b);
    expect(a.endsWith('.mp3') && b.endsWith('.mp3')).toBe(true);
    // the first is still the first recording
    expect(mockFiles.get(a)).toBe('AAAA');
    expect(mockFiles.get(b)).toBe('BBBBBB');
  });

  it('removing one leaves the other playable', async () => {
    picks('mosque.mp3', 'AAAA');
    const first = await pickAdhanFile();
    picks('makkah.mp3', 'BBBBBB');
    const second = await pickAdhanFile();

    await forgetChosenAdhan(first.chosen?.uri ?? null);
    expect(mockFiles.has(first.chosen?.uri as string)).toBe(false);
    expect(mockFiles.get(second.chosen?.uri as string)).toBe('BBBBBB');
  });
});
