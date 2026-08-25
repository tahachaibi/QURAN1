/**
 * The adhan sound.
 *
 * Two separate mechanisms need it, and they fail in different ways, so both are
 * described here:
 *
 *   1. IN-APP PLAYBACK (what you actually hear, with a stop button). The app
 *      plays the file itself, in full, through the media output, and shows a
 *      banner with a Stop button. This only works while the app is running —
 *      JavaScript timers do not fire in a killed app.
 *
 *   2. THE NOTIFICATION, which is the fallback for a phone whose app is closed.
 *      Its sound is the file too, but Android truncates a notification sound and
 *      gives it no stop button, so it is a nudge to open the app rather than a
 *      full adhan. When the app IS open the notification is muted, so you never
 *      hear the two at once.
 *
 * The five-minute warning carries the DEFAULT notification sound and never the
 * adhan: a call to prayer five minutes early is not a reminder, it is wrong.
 *
 * TO ADD THE RECORDING (four steps, all of them):
 *   1. put the file at src/assets/audio/adhan.wav — WAV, not MP3: Android
 *      notification channels are unreliable with MP3, and a channel that cannot
 *      play its sound falls back to silence rather than to the default
 *   2. in THIS file, swap the two ADHAN_ASSET lines below: comment out the null
 *      one, uncomment the require one. Metro resolves require() when the bundle
 *      is built, not when the code runs, so a require of a file that is not
 *      there breaks the build even inside an `if (false)` — which is why this is
 *      an edit rather than a runtime check
 *   3. add "src/assets/audio/adhan.wav" to the expo-notifications plugin's
 *      "sounds" array in app.json. That is what copies it to
 *      android/app/src/main/res/raw at prebuild; without it the build succeeds
 *      and the notification is silent
 *   4. UNINSTALL and reinstall the app. An Android notification channel keeps
 *      the sound it was created with forever, so updating over the top leaves
 *      the old silent channel in place no matter what the code says. (Step 4 is
 *      only about the notification — in-app playback works on a plain update.)
 */

/** File name without extension, which is how Android names a raw resource. */
export const ADHAN_SOUND = 'adhan';

/**
 * The bundled recording, or null when this build has none.
 *
 * Annotated `number | null` on purpose: without the annotation TypeScript narrows
 * it to the literal `null` and every branch that plays it becomes dead code, so
 * the code that matters would stop being type-checked.
 */
export const ADHAN_ASSET: number | null = null;
// Step 2: swap the line above for this one.
// export const ADHAN_ASSET: number | null = require('../assets/audio/adhan.wav');

/** True once a recording is bundled. Drives what the UI promises. */
export const hasAdhanSound = ADHAN_ASSET !== null;
