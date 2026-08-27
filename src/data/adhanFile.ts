/**
 * Letting the user choose their own adhan, from their own phone.
 *
 * This exists because the alternative failed twice. A recording has to reach the
 * app somehow, and sending it to me has meant: once, a file that was four minutes
 * of digital silence, and once, a file too large to send at all. Neither is a
 * problem with the app, and neither should need me in the loop.
 *
 * So: the user downloads whatever adhan they like, taps Choose, and the app copies
 * it into its own storage. No size limit but the phone's, nothing to rebuild, and
 * the file they picked is the file they already heard.
 *
 * WHAT THIS CANNOT DO: it cannot become the notification sound for when the app is
 * closed. Android freezes a notification channel's sound when the channel is
 * created, and that sound must be a resource inside the APK — a file in the app's
 * private storage is not readable by the system process that plays notification
 * sounds. So a chosen file is the in-app adhan, with the Stop button, and the
 * closed-app notification keeps the default sound. Saying that plainly beats
 * discovering it at Fajr.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

/** Where the chosen recording is kept: our own directory, so it survives. */
const DIR = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';

export interface ChosenAdhan {
  uri: string;
  name: string;
  sizeBytes: number;
}

export interface PickResult {
  ok: boolean;
  chosen: ChosenAdhan | null;
  /** phrased for a human (§11) */
  detail: string;
}

/**
 * Ask for a file and copy it in.
 *
 * The copy matters: the picker hands back a cache URI that Android is free to
 * delete, and an adhan that works until the system clears its cache is worse than
 * one that never worked.
 */
export async function pickAdhanFile(): Promise<PickResult> {
  let picked: DocumentPicker.DocumentPickerResult;
  try {
    picked = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch (e) {
    return { ok: false, chosen: null, detail: `The file picker could not open: ${message(e)}` };
  }

  if (picked.canceled) return { ok: false, chosen: null, detail: '' };
  const asset = picked.assets[0];
  if (asset === undefined) return { ok: false, chosen: null, detail: 'No file came back from the picker.' };

  // Keep the extension: Android's media stack sniffs content, but a correct
  // extension is one less thing that can differ between phones.
  const extension = extensionOf(asset.name) ?? extensionOf(asset.uri) ?? 'mp3';
  const target = `${DIR}adhan-chosen.${extension}`;

  try {
    // Replace any previous choice rather than accumulating files.
    await FileSystem.deleteAsync(target, { idempotent: true });
    await FileSystem.copyAsync({ from: asset.uri, to: target });
    const info = await FileSystem.getInfoAsync(target, { size: true });
    if (!info.exists) throw new Error('the copy is not there afterwards');
    const sizeBytes = 'size' in info ? info.size : (asset.size ?? 0);
    return {
      ok: true,
      chosen: { uri: target, name: asset.name, sizeBytes },
      detail: '',
    };
  } catch (e) {
    return { ok: false, chosen: null, detail: `The file could not be saved: ${message(e)}` };
  }
}

/** True when a previously chosen file is still on disk. */
export async function chosenStillThere(uri: string | null): Promise<boolean> {
  if (uri === null || uri.length === 0) return false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
}

export async function forgetChosenAdhan(uri: string | null): Promise<void> {
  if (uri === null || uri.length === 0) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Nothing to do: the preference is cleared by the caller either way.
  }
}

const extensionOf = (value: string): string | null => {
  const match = /\.([A-Za-z0-9]{2,5})(?:\?|$)/.exec(value);
  return match === null ? null : match[1].toLowerCase();
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** "3.4 MB" — shown next to the file name so an odd choice is obvious. */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
