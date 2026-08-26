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
 * THE BUNDLED RECORDING is src/assets/audio/adhan.mp3: Abd Elmajid Essebihi,
 * 4:01, 128 kbps, 44.1 kHz, 3.7 MB. It arrived named .wav but is an MP3 (an
 * `ff fb` MPEG-1 Layer III frame header, no RIFF chunk anywhere), so it is stored
 * under its true extension — Android's res/raw resolves a resource by file name
 * and the media stack sniffs content, and a file whose extension lies about its
 * contents is the kind of thing that works on one phone and not the next.
 *
 * TO REPLACE IT (three steps, all of them):
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
export const ADHAN_ASSET: number | null = require('../assets/audio/adhan.mp3');

/** True once a recording is bundled. Drives what the UI promises. */
export const hasAdhanSound = ADHAN_ASSET !== null;
