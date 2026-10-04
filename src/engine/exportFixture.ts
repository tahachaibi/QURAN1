/**
 * Saving a recorded session as a replay fixture (spec §9).
 *
 * Writes a FILE and shares that, rather than putting the JSON into the share
 * intent's text. A five-minute session is hundreds of KB of events and Android's
 * share extras are size-limited, so the receiving app truncates silently — and a
 * truncated fixture is worse than none, because it still replays, just as
 * something that never happened. The path is returned either way, so a capture
 * survives even when no app can accept the share.
 */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { ReplayFixture } from './replay';

export interface ExportResult {
  ok: boolean;
  /** file name, or the failure reason */
  detail: string;
  events: number;
}

/**
 * `dialogTitle` is the share chooser's title, which Android 8 and 9 (and some
 * vendor share sheets) still show. The summary card's button is translated, so
 * its caller passes t('Save recitation log'); the English default is for the
 * developer overlay.
 */
export async function exportFixture(
  fixture: ReplayFixture,
  dialogTitle = 'Send the recitation log',
): Promise<ExportResult> {
  const events = fixture.events.length;
  try {
    const json = JSON.stringify(fixture, null, 1);
    const name = `tasmee-hifz-fixture-${events}-events.json`;
    const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
    if (dir === null) return { ok: false, detail: 'no writable directory on this device', events };
    const uri = `${dir}${name}`;
    await FileSystem.writeAsStringAsync(uri, json);

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle,
        UTI: 'public.json',
      });
      return { ok: true, detail: `${name} · ${(json.length / 1024).toFixed(0)} KB`, events };
    }
    return { ok: true, detail: `saved to ${uri}`, events };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e), events };
  }
}
