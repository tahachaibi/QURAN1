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
 * TO ADD ONE (all four steps matter):
 *   1. put the file at src/assets/audio/adhan.wav — WAV, not MP3: Android
 *      notification channels are unreliable with MP3, and a channel that cannot
 *      play its sound falls back to silence rather than to the default
 *   2. set hasAdhanSound to true below
 *   3. add the file to the expo-notifications plugin's "sounds" array in
 *      app.json, which is what copies it to android/app/src/main/res/raw at
 *      prebuild — without this the build succeeds and the sound is missing
 *   4. UNINSTALL and reinstall the app. An Android notification channel keeps
 *      the sound it was created with forever; updating over the top leaves the
 *      old channel, and the adhan will not play no matter what the code says
 *
 * Keep it under about 30 seconds. Android truncates long notification sounds,
 * and a cut-off adhan is worse than a short one.
 */

/** File name without extension, which is how Android refers to a raw resource. */
export const ADHAN_SOUND = 'adhan';

/** Flip to true once the file above is actually bundled. */
export const hasAdhanSound = false;
