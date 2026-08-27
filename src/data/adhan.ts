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
 * NO RECORDING IS BUNDLED, and the last one taught an expensive lesson.
 *
 * The file that was here was a structurally perfect MP3 — 9,200 frames, constant
 * 128 kbps, 44.1 kHz, 4:01 long, every frame header valid — that contained
 * nothing but digital silence. The whole 3.8 MB held four distinct byte values:
 * 0x00 for 99.28% of it, plus the three bytes of a frame header repeated 9,200
 * times. Every layer below did its job and said so: the bundler packaged it,
 * Gradle copied it to res/raw, expo-asset extracted it, the player decoded it,
 * read its true duration, and played it at full volume through the speaker. The
 * app reported "Playing 3:59 of adhan" and was telling the truth.
 *
 * Three rounds of debugging went into the player, the asset pipeline, the APK and
 * the audio focus — all of it looking for a fault in code that worked. So:
 * scripts/verify-audio.mjs now refuses a silent file, and a generated test tone
 * (scripts/gen-test-tone.mjs) gives the app a sound whose contents are KNOWN, so
 * "our audio is broken" can be told apart from "the recording is empty".
 *
 * TO ADD A RECORDING (three steps, all of them):
 *   1. drop the new file at src/assets/audio/adhan.<its real extension>
 *   2. point ADHAN_ASSET below at it, and update "sounds" in app.json to match.
 *      Metro resolves require() when the bundle is built, not when the code runs,
 *      so a require of a file that is not there breaks the build even inside an
 *      `if (false)` — which is why this is an edit and not a runtime lookup
 *   3. UNINSTALL and reinstall the app. An Android notification channel keeps
 *      the sound it was created with forever, so updating over the top leaves the
 *      old channel and its old sound in place no matter what the code says.
 *      (Step 3 is only about the notification — in-app playback, which is what
 *      you actually hear, works on a plain update.)
 */

/** File name without extension, which is how Android names a raw resource. */
export const ADHAN_SOUND = 'adhan';

/**
 * The bundled recording, or null when a build has none.
 *
 * Annotated `number | null` on purpose. It keeps the no-recording branches alive
 * for the type-checker rather than narrowing them to dead code, which is what
 * kept them honest while there was nothing to play.
 */
export const ADHAN_ASSET: number | null = null;
// Step 2: swap the line above for this one, with the real extension.
// export const ADHAN_ASSET: number | null = require('../assets/audio/adhan.mp3');

/**
 * A generated chime, guaranteed to contain sound because arithmetic produced it.
 *
 * Its only job is to answer "can this phone play audio from this app at all?"
 * without depending on a file anybody sent.
 */
export const TEST_TONE_ASSET: number = require('../assets/audio/test-tone.wav');

/** True once a recording is bundled. Drives what the UI promises. */
export const hasAdhanSound = ADHAN_ASSET !== null;
