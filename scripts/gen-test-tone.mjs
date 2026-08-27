/**
 * Generate src/assets/audio/test-tone.wav — a short, deliberately audible sound.
 *
 * WHY: three rounds of debugging went into a silent adhan, looking for a fault in
 * the player, the asset pipeline, the APK and the audio focus, when the file
 * itself was 100% zero bytes. Every layer was working and reporting success.
 * There was no way, from inside the app, to tell "our audio path is broken" from
 * "the recording has nothing in it".
 *
 * This file is that way. It is generated here, from arithmetic, so its contents
 * are known: if the phone plays this and not the adhan, the adhan is the problem.
 * If it plays neither, the app is.
 *
 * PCM WAV rather than MP3 because it needs no encoder and cannot be
 * accidentally silent — the samples are computed right here.
 *
 * Run: npm run gen:tone
 */
import { writeFileSync } from 'node:fs';

const RATE = 22050;
const SECONDS = 1.6;
const total = Math.floor(RATE * SECONDS);

/** Two tones a fifth apart, so it reads as a deliberate chime rather than a fault. */
const A = 660;
const B = 990;

const samples = Buffer.alloc(total * 2);
for (let i = 0; i < total; i++) {
  const t = i / RATE;
  // 8ms fade at each end: a square-edged start clicks and sounds broken
  const fade = Math.min(1, t / 0.008, (SECONDS - t) / 0.008);
  // a gentle envelope per note so it rings twice
  const note = t < SECONDS / 2 ? A : B;
  const swell = Math.sin((Math.PI * (t % (SECONDS / 2))) / (SECONDS / 2));
  const value = Math.sin(2 * Math.PI * note * t) * swell * fade * 0.6;
  samples.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), i * 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + samples.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16); // PCM chunk size
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write('data', 36);
header.writeUInt32LE(samples.length, 40);

const out = new URL('../src/assets/audio/test-tone.wav', import.meta.url);
writeFileSync(out, Buffer.concat([header, samples]));

// Prove what was just written is not silence, here, at the source.
let peak = 0;
let nonZero = 0;
for (let i = 0; i < total; i++) {
  const v = Math.abs(samples.readInt16LE(i * 2));
  if (v > 0) nonZero++;
  if (v > peak) peak = v;
}
if (peak < 8000 || nonZero < total * 0.5) {
  throw new Error(`generated tone is too quiet: peak ${peak}, ${nonZero}/${total} non-zero`);
}
console.log(
  `test-tone.wav: ${SECONDS}s, ${RATE} Hz mono, peak ${peak}/32767, ` +
    `${((nonZero / total) * 100).toFixed(1)}% non-zero samples`,
);
