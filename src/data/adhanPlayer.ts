/**
 * Playing the adhan through the phone, with a stop button.
 *
 * A notification sound is not this: Android truncates it, mixes it with whatever
 * else is playing and offers no way to stop it short of swiping the notification
 * away. The call to prayer deserves the media output, its full length, and one
 * obvious way to silence it.
 *
 * Every started playback takes a generation number. A stop bumps the generation,
 * so a load that was already in flight when the user pressed Stop unloads itself
 * instead of starting to play a second later — the bug where the adhan begins
 * *after* you silenced it.
 */
import { Audio, InterruptionModeAndroid } from 'expo-av';

import { ADHAN_ASSET } from './adhan';

export interface AdhanPlaybackResult {
  /** true when audio is actually coming out of the phone */
  ok: boolean;
  /** why not, phrased for a human (§11); empty when it played */
  detail: string;
}

let sound: Audio.Sound | null = null;
let generation = 0;

/**
 * Start the adhan. `onFinished` fires when the recording ends on its own, so the
 * banner can take itself away rather than lingering over silence.
 */
export async function playAdhan(onFinished: () => void): Promise<AdhanPlaybackResult> {
  if (ADHAN_ASSET === null) {
    return {
      ok: false,
      detail: 'No adhan recording is bundled in this build, so there is nothing to play.',
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

    const created = await Audio.Sound.createAsync(ADHAN_ASSET, { shouldPlay: true, volume: 1 });
    if (mine !== generation) {
      // Stopped while loading.
      await created.sound.unloadAsync().catch(() => undefined);
      return { ok: false, detail: 'Stopped before it started.' };
    }

    sound = created.sound;
    created.sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        void stopAdhan();
        onFinished();
      }
    });
    return { ok: true, detail: '' };
  } catch (e) {
    return {
      ok: false,
      detail: `The adhan could not be played: ${e instanceof Error ? e.message : String(e)}`,
    };
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
