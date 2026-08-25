/**
 * The adhan sound.
 *
 * Android freezes a notification channel's sound at creation, so the file has to
 * exist in the build for the adhan to be heard when the app is closed — it cannot
 * be downloaded later and swapped in. That means an audio file has to be bundled,
 * and I do not have one: the environment this was built in cannot reach an audio
 * host, and an adhan recording is someone's performance, so it needs to be chosen
 * deliberately rather than grabbed.
 *
 * Until one is added, the adhan notification fires on time with the device's
 * default notification sound, and the UI says so instead of implying an adhan
 * that will not play.
 *
 * TO ADD ONE:
 *   1. put the file at src/assets/audio/adhan.wav  (WAV, not MP3 — Android
 *      notification channels are unreliable with MP3)
 *   2. set hasAdhanSound to true below
 *   3. add an expo-notifications config-plugin "sounds" entry in app.json so the
 *      file is copied into android/app/src/main/res/raw at prebuild
 *   4. uninstall and reinstall: an existing channel keeps its old sound forever
 */

/** File name without extension, which is how Android refers to a raw resource. */
export const ADHAN_SOUND = 'adhan';

/** Flip to true once the file above is actually bundled. */
export const hasAdhanSound = false;
