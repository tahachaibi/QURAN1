/**
 * Getting a backup off the phone, and back onto one.
 *
 * src/data/backup.ts is the format and the rules, and it is pure so it can be
 * proved. This is the part that cannot be: the file system, the share sheet and
 * the document picker. Kept apart for exactly that reason — the thinking lives
 * where it is testable, and this file stays thin enough to read in one go.
 *
 * It follows src/data/adhanFile.ts, which solved the same shape of problem for
 * the adhan recording, including the detail that matters most here: the picker
 * hands back a CACHE uri that Android may delete at any moment, so anything
 * needed after the next few seconds has to be read immediately rather than kept
 * as a path.
 */
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { BACKUP_MIME, backupFilename, parseBackup, serialiseBackup, type BackupParse } from './backup';
import { exportAll } from './storage';

const DIR = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface WriteResult {
  ok: boolean;
  /** phrased for a human (§11); empty when there is nothing to say */
  detail: string;
  sizeBytes: number;
}

/**
 * Write the backup and hand it to the share sheet.
 *
 * The share sheet rather than a "save to Downloads" button, because on Android
 * a chooser is the one route that reaches Drive, WhatsApp, a USB copy and the
 * Files app WITHOUT this app holding storage permissions — WRITE_EXTERNAL_STORAGE
 * is deliberately blocked (app.json, docs/decisions.md), and asking for it back
 * to save one file would be a bad trade.
 *
 * Written to the cache directory on purpose: once the user has sent it
 * somewhere, this copy is litter, and the cache is the one directory Android
 * cleans up on its own.
 */
export async function shareBackup(now: number): Promise<WriteResult> {
  let text: string;
  try {
    text = serialiseBackup({
      values: await exportAll(),
      // Recorded so a future reader knows which build wrote the file. 'unknown'
      // rather than a guess when the manifest is absent, which it can be in a
      // bare release build.
      appVersion: Constants.expoConfig?.version ?? 'unknown',
      now,
    });
  } catch (e) {
    return { ok: false, detail: `Your data could not be read: ${message(e)}`, sizeBytes: 0 };
  }

  const sizeBytes = text.length;
  const uri = `${DIR}${backupFilename(now)}`;
  try {
    await FileSystem.writeAsStringAsync(uri, text, { encoding: FileSystem.EncodingType.UTF8 });
  } catch (e) {
    return { ok: false, detail: `The backup could not be written: ${message(e)}`, sizeBytes: 0 };
  }

  if (!(await Sharing.isAvailableAsync())) {
    /**
     * Not a failure. The file exists and the path is real; there is simply no
     * app on this phone willing to receive it. Telling somebody where their
     * backup is beats telling them it did not work.
     */
    return {
      ok: true,
      sizeBytes,
      detail: `Saved to ${uri}. Nothing on this phone offered to share it, so copy it off over a cable.`,
    };
  }

  try {
    await Sharing.shareAsync(uri, {
      mimeType: BACKUP_MIME,
      dialogTitle: 'Save your Quran Habit backup',
      UTI: 'public.json',
    });
  } catch (e) {
    return { ok: true, sizeBytes, detail: `Saved, but the share sheet failed: ${message(e)}` };
  }
  return { ok: true, sizeBytes, detail: '' };
}

export interface ReadResult {
  /** null when the user simply cancelled, which is not an error */
  parse: BackupParse | null;
  detail: string;
}

/**
 * Ask for a backup file and parse it. Writes nothing.
 *
 * Stopping at the parse is deliberate. The caller shows the user what a restore
 * would do and only then applies it — a restore that happens as a side effect
 * of opening a file is not something this app is going to do to somebody's
 * memorisation record.
 */
export async function pickBackupFile(): Promise<ReadResult> {
  let picked: DocumentPicker.DocumentPickerResult;
  try {
    /**
     * Not filtered to application/json. Android's picker is inconsistent about
     * the type it reports for a file that arrived via Drive, WhatsApp or a
     * cable — often application/octet-stream, sometimes nothing — and a filter
     * that hides the user's own backup from them is worse than letting them
     * pick the wrong file, because `parseBackup` refuses anything that is not
     * ours and says why.
     */
    picked = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch (e) {
    return { parse: null, detail: `The file picker could not open: ${message(e)}` };
  }

  if (picked.canceled) return { parse: null, detail: '' };
  const asset = picked.assets[0];
  if (asset === undefined) return { parse: null, detail: 'No file came back from the picker.' };

  let text: string;
  try {
    // Read NOW. This uri points into the cache, and Android is free to delete
    // it the moment we stop looking at it.
    text = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
  } catch (e) {
    return { parse: null, detail: `That file could not be read: ${message(e)}` };
  }

  return { parse: parseBackup(text), detail: '' };
}

/** Bytes, for the "saved 41 KB" line. Not localised; it is a diagnostic. */
export const formatBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
