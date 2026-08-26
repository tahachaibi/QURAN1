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

import { ADHAN_ASSET } from './adhan';

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
async function resolveSource(): Promise<{ source: AVPlaybackSource; opened: string }> {
  const module = ADHAN_ASSET as number;
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
export async function playAdhan(
  onFinished: () => void,
  onStalled?: (detail: string) => void,
): Promise<AdhanPlaybackResult> {
  if (ADHAN_ASSET === null) {
    return {
      ok: false,
      detail: 'No adhan recording is bundled in this build, so there is nothing to play.',
      durationMs: null,
      opened: null,
    };
  }

  await stopAdhan();
  const mine = ++generation;

  try {
    // DoNotMix and no ducking: the adhan is not background music.
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    });

    const { source, opened } = await resolveSource();
    if (mine !== generation) return stoppedEarly();

    let created: Awaited<ReturnType<typeof Audio.Sound.createAsync>>;
    let usedSource = opened;
    try {
      created = await Audio.Sound.createAsync(source, { shouldPlay: true, volume: 1 });
    } catch (e) {
      // The extracted path failed. Fall back to the bundled module rather than
      // giving up: which of the two a given device accepts is not predictable
      // from here, and one of them working is what matters.
      if (typeof source === 'number') throw e;
      created = await Audio.Sound.createAsync(ADHAN_ASSET as number, { shouldPlay: true, volume: 1 });
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
      return { ok: false, detail: 'The recording did not load.', durationMs: null, opened: usedSource };
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

    return { ok: true, detail: '', durationMs, opened: usedSource };
  } catch (e) {
    return {
      ok: false,
      detail: `The adhan could not be played: ${e instanceof Error ? e.message : String(e)}`,
      durationMs: null,
      opened: null,
    };
  }
}

const stoppedEarly = (): AdhanPlaybackResult => ({
  ok: false,
  detail: 'Stopped before it started.',
  durationMs: null,
  opened: null,
});

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
