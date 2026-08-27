/**
 * Assert the bundled adhan actually contains sound.
 *
 * WHY THIS EXISTS: the first recording bundled in this app was a structurally
 * perfect MP3 — 9,200 frames, constant 128 kbps, 44.1 kHz, 4:01 long, every
 * frame header valid — containing nothing but digital silence. The whole 3.8 MB
 * file held exactly four distinct byte values: 0x00 for 99.28% of it, plus the
 * three bytes of a frame header repeated 9,200 times.
 *
 * Everything downstream behaved correctly and reported success. The bundler
 * packaged it, Gradle copied it into res/raw, expo-asset extracted it, the media
 * player decoded it, read its true duration and played it at full volume through
 * the speaker. The app said "Playing 3:59 of adhan" and it was telling the truth.
 * Nobody heard anything, because there was nothing to hear.
 *
 * I checked that file when it arrived and pronounced it valid. I had checked the
 * CONTAINER — frame headers, bitrate, sample rate, duration — and never once
 * checked whether it carried a signal. Three rounds of debugging went into the
 * player, the asset pipeline, the APK and the audio focus, all of them looking
 * for a fault in code that was working. That is what this script is for.
 *
 * Run: npm run gen:verify-audio
 */
import { existsSync, readFileSync } from 'node:fs';

const FILE = new URL('../src/assets/audio/adhan.mp3', import.meta.url);
const TONE = new URL('../src/assets/audio/test-tone.wav', import.meta.url);

/** MPEG-1 Layer III bitrates, kbps, indexed by the header's 4-bit field. */
const BITRATES = [null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const RATES = [44100, 48000, 32000];

/** Above this fraction of zero bytes in the audio payload, it is silence. */
const SILENCE_ZEROS = 0.95;
/** Real audio uses most of the byte range; silence uses almost none of it. */
const MIN_DISTINCT_BYTES = 32;

// The generated chime first: if THAT is silent the generator is broken, and the
// app loses its only way to distinguish a bad recording from a bad audio path.
const tone = readFileSync(TONE);
{
  const samples = tone.subarray(44);
  let peak = 0;
  for (let i = 0; i + 1 < samples.length; i += 2) {
    const v = Math.abs(samples.readInt16LE(i));
    if (v > peak) peak = v;
  }
  if (tone.subarray(0, 4).toString('latin1') !== 'RIFF') {
    console.error('FAIL  test-tone.wav is not a RIFF/WAVE file');
    process.exit(1);
  }
  if (peak < 8000) {
    console.error(`FAIL  test-tone.wav peaks at only ${peak}/32767 — regenerate it`);
    process.exit(1);
  }
  console.log(`test tone     ok, peak ${peak}/32767`);
}

if (!existsSync(FILE)) {
  console.log('adhan        none bundled — nothing to verify');
  process.exit(0);
}

const data = readFileSync(FILE);

let offset = 0;
if (data.subarray(0, 3).toString('latin1') === 'ID3') {
  offset = 10 + ((data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]);
  console.log(`ID3 tag: ${offset} bytes`);
}

const frames = [];
let i = offset;
while (i < data.length - 4) {
  if (data[i] === 0xff && (data[i + 1] & 0xe0) === 0xe0) {
    const version = (data[i + 1] >> 3) & 3;
    const layer = (data[i + 1] >> 1) & 3;
    const bitrateIndex = (data[i + 2] >> 4) & 0xf;
    const rateIndex = (data[i + 2] >> 2) & 3;
    const padding = (data[i + 2] >> 1) & 1;
    if (version !== 3 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
      i++;
      continue;
    }
    const bitrate = BITRATES[bitrateIndex] * 1000;
    const rate = RATES[rateIndex];
    const length = Math.floor((144 * bitrate) / rate) + padding;
    frames.push({ at: i, length, bitrate, rate });
    i += Math.max(length, 4);
  } else {
    i++;
  }
}

const fail = (message) => {
  console.error(`\nFAIL  ${message}`);
  process.exit(1);
};

if (frames.length === 0) fail('no MPEG audio frames at all — this is not a playable MP3');

const seconds = frames.reduce((total, f) => total + 1152 / f.rate, 0);
const minutes = Math.floor(seconds / 60);
console.log(`frames        ${frames.length}`);
console.log(`duration      ${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`);
console.log(`bitrate       ${[...new Set(frames.map((f) => f.bitrate / 1000))].join(', ')} kbps`);
console.log(`sample rate   ${[...new Set(frames.map((f) => f.rate))].join(', ')} Hz`);

// --- the check the container cannot make: is there a signal? ---
const distinct = new Set();
let zeros = 0;
let payload = 0;
for (const frame of frames) {
  // skip the 4-byte header; everything after it is side info + main data
  const body = data.subarray(frame.at + 4, frame.at + frame.length);
  for (const byte of body) {
    if (byte === 0) zeros++;
    distinct.add(byte);
  }
  payload += body.length;
}

const zeroFraction = zeros / payload;
console.log(`payload       ${payload} bytes`);
console.log(`zero bytes    ${(zeroFraction * 100).toFixed(2)}%`);
console.log(`distinct byte values in the payload: ${distinct.size} of 256`);

if (zeroFraction > SILENCE_ZEROS) {
  fail(
    `the audio payload is ${(zeroFraction * 100).toFixed(2)}% zero bytes — this file is SILENT.\n` +
      '      It is a valid MP3 and it will play, for its full length, making no sound.\n' +
      '      Replace src/assets/audio/adhan.mp3 with a recording that has audio in it.',
  );
}
if (distinct.size < MIN_DISTINCT_BYTES) {
  fail(
    `the payload uses only ${distinct.size} distinct byte values — real audio uses most of the range.\n` +
      '      This is almost certainly silence or a corrupt encode.',
  );
}

console.log('\nok   the file contains audio, not silence');
