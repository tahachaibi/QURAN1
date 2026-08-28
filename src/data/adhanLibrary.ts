/**
 * The adhan library: the recordings this phone can call to prayer with.
 *
 * Replaces a toggle and two buttons that each did one thing, with one list that
 * answers the question a person actually has — "which adhan, and what does it
 * sound like?" A recording is a thing you choose between, so it belongs in a list
 * of things, each with a name you recognise and a play button to check it.
 *
 * BUILT-IN entries carry a bundled asset id and no URI. ADDED entries carry a
 * file URI and no asset, which is also what makes them serialisable: an asset id
 * is a number Metro assigns at build time and means nothing in stored settings,
 * so only the user's own entries are ever written to disk.
 */
import { ADHAN_ASSET, TEST_TONE_ASSET } from './adhan';

export interface AdhanEntry {
  id: string;
  /** what to call it — a reciter's name for a built-in, the file's name for an added one */
  name: string;
  /** the audio file itself, shown underneath so the choice is checkable */
  fileName: string;
  /** length or size, whichever is actually known */
  detail: string;
  /** a file on this phone, for entries the user added */
  uri: string | null;
  /** a bundled asset, for entries that ship with the app */
  asset: number | null;
  /** true when it cannot be deleted */
  builtIn: boolean;
}

/**
 * The bundled recitation. Its length is stated because it was measured — 8,156
 * MPEG frames at 44.1 kHz — not estimated.
 */
export const BUNDLED_ADHAN: AdhanEntry = {
  id: 'bundled',
  name: 'Abd Elmajid Essebihi',
  fileName: 'adhan.mp3',
  detail: '3:33 · included with the app',
  uri: null,
  asset: ADHAN_ASSET,
  builtIn: true,
};

/**
 * The generated chime, offered only when there is no real adhan to offer.
 *
 * It is not a call to prayer and must never be mistaken for one, so it appears
 * only as the fallback and says what it is.
 */
export const TEST_CHIME: AdhanEntry = {
  id: 'chime',
  name: 'Test chime',
  fileName: 'test-tone.wav',
  detail: '1.6s · not an adhan, just a sound to check the phone',
  uri: null,
  asset: TEST_TONE_ASSET,
  builtIn: true,
};

/** What ships with this build: the recitation if it is bundled, else the chime. */
export const builtInAdhans = (): AdhanEntry[] => (ADHAN_ASSET === null ? [TEST_CHIME] : [BUNDLED_ADHAN]);

/** An entry the user added, as stored in settings. */
export interface StoredAdhan {
  id: string;
  name: string;
  fileName: string;
  detail: string;
  uri: string;
}

export const storedToEntry = (stored: StoredAdhan): AdhanEntry => ({
  ...stored,
  asset: null,
  builtIn: false,
});

/** Built-ins first, then whatever the user added, in the order they added it. */
export function library(added: readonly StoredAdhan[]): AdhanEntry[] {
  return [...builtInAdhans(), ...added.map(storedToEntry)];
}

/**
 * The entry that should sound, given what is selected.
 *
 * Falls back to the first thing in the library rather than to nothing: a
 * selection pointing at a recording that has been deleted must not silence the
 * adhan, it must fall back to one that exists.
 */
export function selectedAdhan(added: readonly StoredAdhan[], selectedId: string | null): AdhanEntry | null {
  const all = library(added);
  if (all.length === 0) return null;
  return all.find((entry) => entry.id === selectedId) ?? all[0];
}

/** Ids must be unique across built-ins and additions, or selection breaks. */
export function nextAdhanId(added: readonly StoredAdhan[]): string {
  const taken = new Set([...builtInAdhans().map((e) => e.id), ...added.map((e) => e.id)]);
  let n = added.length + 1;
  while (taken.has(`added-${n}`)) n++;
  return `added-${n}`;
}

/** "My Adhan" from "my adhan.mp3" — a name a person would recognise. */
export function nameFromFile(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const cleaned = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : fileName;
}
