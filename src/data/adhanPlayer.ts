/**
 * Playing the adhan through the phone, with a stop button.
 *
 * A notification sound is not this: Android truncates it, mixes it with whatever
 * else is playing and offers no way to stop it short of swiping the notification
 * away. The call to prayer deserves the media output, its full length, and one
 * obvious way to silence it.
 *
 * TWO THINGS THIS FILE LEARNED THE HARD WAY.
 *
 * 1. A `require`d asset is not always openable by the media player. In a release
 *    APK the file lives inside the archive, and passing the module id straight to
 *    expo-av can load "successfully" and produce no sound at all. So the asset is
 *    first EXTRACTED to a real file:// URI with expo-asset, and only the module id
 *    is used as a fallback. Silence with no error is the worst failure mode there
 *    is, and this is the one known cause of it here.
 *
 * 2. Started is not the same as audible. So playback is watched: a second and a
 *    half in, if the position has not advanced, the app says so instead of
 *    presenting silence as success.
 *
 * Every started playback takes a generation number. A stop bumps the generation,
 * so a load that was already in flight when the user pressed Stop unloads itself
 * instead of starting to play a second later — the bug where the adhan begins
 * *after* you silenced it.
 */
import { Audio, InterruptionModeAndroid, type AVPlaybackSource } from 'expo-av';
import { Asset } from 'expo-asset';

import { ADHAN_ASSET, TEST_TONE_ASSET } from './adhan';
import { chosenStillThere } from './adhanFile';
import { TEST_CHIME, type AdhanEntry } from './adhanLibrary';
import { ArabicSpeech, isArabicSpeechLinked } from '../../modules/expo-arabic-speech';

export interface AdhanPlaybackResult {
  /** true when the recording loaded and playback started */
  ok: boolean;
  /**
   * What happened, phrased for a human (§11) — on failure the reason, on success
   * empty. "It isn't working" is not a diagnosable report, and the only fix for
   * that is for the app to say what it did.
   */
  detail: string;
  /**
   * The recording's length once loaded. A real duration means the file decoded,
   * so a remaining silence is downstream of this code: media volume, silent mode,
   * or audio routed to a Bluetooth device.
   */
  durationMs: number | null;
  /** how the file was opened — the extracted path, or the bundled module */
  opened: string | null;
  /** true when what played was the generated chime, not an adhan */
  testTone: boolean;
  /**
   * What the operating system says about output: volume, mode and route.
   *
   * "Playing" and "audible" are different claims, and a media player can only
   * make the first. This is the second, read from AudioManager.
   */
  output: string | null;
}

let sound: Audio.Sound | null = null;
let generation = 0;

/**
 * Get a source the media player can actually open.
 *
 * `Asset.fromModule(...).downloadAsync()` unpacks the bundled file into the cache
 * directory and hands back a file:// URI. For a local asset it is not a download
 * and needs no network — it is an extraction, and it is what makes the difference
 * between a release build that plays and one that is silently mute.
 */
async function resolveSource(module: number): Promise<{ source: AVPlaybackSource; opened: string }> {
  try {
    const asset = Asset.fromModule(module);
    if (asset.localUri === null || asset.localUri === undefined) await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    if (typeof uri === 'string' && uri.length > 0) return { source: { uri }, opened: uri };
  } catch {
    // fall through to the module id
  }
  return { source: module, opened: 'bundled module' };
}

/**
 * Start the adhan.
 *
 * `onFinished` fires when the recording ends on its own, so the banner can take
 * itself away rather than lingering over silence. `onStalled` fires when playback
 * was accepted but is not advancing — the case that looks exactly like a working
 * adhan with the volume down.
 */
/**
 * Play one entry from the adhan library.
 *
 * A missing file falls back rather than failing silently: a recording the user
 * deleted from their phone must not be the reason a prayer goes unannounced.
 */
export async function playAdhan(
  entry: AdhanEntry | null,
  onFinished: () => void,
  onStalled?: (detail: string) => void,
): Promise<AdhanPlaybackResult> {
  const isChime = entry !== null && entry.id === TEST_CHIME.id;
  if (entry !== null && entry.uri !== null && (await chosenStillThere(entry.uri))) {
    return play({ uri: entry.uri }, false, onFinished, onStalled);
  }
  if (entry !== null && entry.asset !== null) {
    return play(entry.asset, isChime, onFinished, onStalled);
  }
  return play(ADHAN_ASSET ?? TEST_TONE_ASSET, ADHAN_ASSET === null, onFinished, onStalled);
}

/**
 * Play the generated chime on purpose.
 *
 * Its contents are known — arithmetic made them — so hearing it proves the app's
 * whole audio path works on this phone, and NOT hearing it proves the fault is
 * not in whatever recording happens to be bundled.
 */
export const playTestTone = (
  onFinished: () => void,
  onStalled?: (detail: string) => void,
): Promise<AdhanPlaybackResult> => play(TEST_TONE_ASSET, true, onFinished, onStalled);

async function play(
  module: number | { uri: string },
  testTone: boolean,
  onFinished: () => void,
  onStalled?: (detail: string) => void,
): Promise<AdhanPlaybackResult> {
  await stopAdhan();
  const mine = ++generation;

  try {
    /**
     * Before anything else: if the phone is stuck in communication mode, media
     * goes to the EARPIECE and the adhan is inaudible from a foot away. That was
     * the actual fault — "Playing 3:33 of adhan · mode in-communication" — and it
     * is repaired here rather than reported, because the reciter cannot do
     * anything about it and the app can.
     */
    const repair = await normaliseMode();

    // DoNotMix and no ducking: the adhan is not background music.
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      // Matching the Listen tab exactly, which is known to produce sound on a
      // real phone. An unexplained difference between two playback paths in one
      // app is a place for a bug to hide.
      playThroughEarpieceAndroid: false,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    });

    // A file URI needs no extraction: it is already a path the player can open.
    const { source, opened } =
      typeof module === 'number' ? await resolveSource(module) : { source: module, opened: module.uri };
    if (mine !== generation) return stoppedEarly();

    let created: Awaited<ReturnType<typeof Audio.Sound.createAsync>>;
    let usedSource = opened;
    try {
      created = await Audio.Sound.createAsync(source, { shouldPlay: true, volume: 1 });
    } catch (e) {
      // The extracted path failed. Fall back to the bundled module rather than
      // giving up: which of the two a given device accepts is not predictable
      // from here, and one of them working is what matters.
      if (typeof source === 'number' || typeof module !== 'number') throw e;
      created = await Audio.Sound.createAsync(module, { shouldPlay: true, volume: 1 });
      usedSource = `bundled module (after ${opened} failed)`;
    }
    if (mine !== generation) {
      await created.sound.unloadAsync().catch(() => undefined);
      return stoppedEarly();
    }

    sound = created.sound;
    created.sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        void stopAdhan();
        onFinished();
      }
    });

    // Belt and braces: some devices honour setVolumeAsync but not the option.
    await created.sound.setVolumeAsync(1).catch(() => undefined);

    if (!created.status.isLoaded) {
      return {
        ok: false,
        detail: 'The recording did not load.',
        durationMs: null,
        opened: usedSource,
        output: joinNotes(repair, await describeOutput()),
        testTone,
      };
    }
    const durationMs = created.status.durationMillis ?? null;

    /**
     * Watch it actually move. Without this, "no sound came out" and "the player
     * accepted the file and did nothing" are indistinguishable from in here.
     */
    if (onStalled !== undefined) {
      const watched = created.sound;
      setTimeout(() => {
        if (mine !== generation) return;
        void watched
          .getStatusAsync()
          .then((status) => {
            if (mine !== generation || !status.isLoaded) return;
            if (!status.isPlaying || status.positionMillis === 0) {
              onStalled(
                `The player accepted the recording but is not advancing (position ${status.positionMillis}ms, ` +
                  `playing ${String(status.isPlaying)}). Opened from ${usedSource}.`,
              );
            }
          })
          .catch(() => undefined);
      }, 1500);
    }

    return {
      ok: true,
      detail: '',
      durationMs,
      opened: usedSource,
      output: joinNotes(repair, await describeOutput()),
      testTone,
    };
  } catch (e) {
    return {
      ok: false,
      detail: `The adhan could not be played: ${e instanceof Error ? e.message : String(e)}`,
      durationMs: null,
      opened: null,
      output: null,
      testTone,
    };
  }
}

const stoppedEarly = (): AdhanPlaybackResult => ({
  ok: false,
  detail: 'Stopped before it started.',
  durationMs: null,
  opened: null,
  output: null,
  testTone: false,
});

/**
 * Ask the native side to leave communication mode. Returns a description when it
 * had to change something, so the banner can say what it did.
 */
async function normaliseMode(): Promise<string | null> {
  if (!isArabicSpeechLinked()) return null;
  try {
    const result = await ArabicSpeech().normaliseAudioMode();
    return result.changed ? `mode ${result.before} → ${result.after}` : null;
  } catch {
    return null;
  }
}

/** Read the output route, or null when the native module is not linked. */
async function describeOutput(): Promise<string | null> {
  if (!isArabicSpeechLinked()) return null;
  try {
    const state = await ArabicSpeech().audioState();
    if (!state.available) return null;
    const parts = [
      `media volume ${state.musicVolume ?? '?'}/${state.musicVolumeMax ?? '?'}`,
      `mode ${state.mode ?? '?'}`,
      `out ${state.route === undefined || state.route.length === 0 ? '?' : state.route}`,
      `ringer ${state.ringerMode ?? '?'}`,
    ];
    return parts.join(' · ');
  } catch {
    return null;
  }
}

/** Silence it now. Safe to call when nothing is playing. */
export async function stopAdhan(): Promise<void> {
  generation++;
  const current = sound;
  sound = null;
  if (current === null) return;
  current.setOnPlaybackStatusUpdate(null);
  await current.stopAsync().catch(() => undefined);
  await current.unloadAsync().catch(() => undefined);
}

/** Put the repair note in front of the route, when there was one. */
const joinNotes = (repair: string | null, output: string | null): string | null => {
  if (repair === null) return output;
  return output === null ? repair : `${repair} · ${output}`;
};
