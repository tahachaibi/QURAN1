/**
 * The app's icon and store art, drawn from arithmetic.
 *
 * There is no image editor, no ImageMagick and no SVG rasteriser in this
 * toolchain, and there is no designer either — so the mark is computed rather
 * than drawn, in the same spirit as scripts/gen-test-tone.mjs, which synthesises
 * a WAV from a sine wave. The whole pipeline is Node plus zlib: a PNG is a
 * header, a deflated block of scanlines and a footer, and that is all this
 * needs.
 *
 * Computing it buys three things a hand-drawn file would not. It regenerates
 * byte-identically, so CI can assert the committed PNGs are the ones this
 * script produces and nobody can quietly swap in something else. It takes its
 * colours from src/theme/theme.ts, so the icon cannot drift away from the app.
 * And every size comes from one definition instead of six exports that fall out
 * of sync.
 *
 * THE MARK is the eight-pointed khātim — two squares, one rotated 45°, unioned —
 * inside a thin ring. It is chosen for reasons, not taste:
 *   - it is non-figurative, which is what this subject asks for;
 *   - it survives being 48 pixels wide in a launcher, which detailed
 *     calligraphy does not;
 *   - it is the single most recognisable form in Islamic geometry, so it reads
 *     as what the app is before anybody has read the name.
 *
 * WHAT THIS IS NOT: a substitute for a designer. It is a correct, coherent,
 * legible mark that makes the app publishable today, and a real one should
 * replace it when there is someone to draw it. The store screenshots are a
 * different matter entirely and are NOT generated here — those have to show the
 * actual app, and inventing them would misrepresent it.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Straight from src/theme/theme.ts — lightPalette.primary and .accent.
const GREEN = [0x1b, 0x43, 0x32];
const GOLD = [0xc9, 0xa2, 0x27];
const WHITE = [0xff, 0xff, 0xff];

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA pixel buffer -> a PNG file. Colour type 6, 8 bits, no interlacing. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Every scanline is prefixed with filter type 0 (none). Filtering would
  // compress better; these files are small and reproducibility is worth more
  // than the kilobytes.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const at = y * (width * 4 + 1);
    raw[at] = 0;
    rgba.copy(raw, at + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    // Level 9 explicitly: zlib's default could change between Node versions and
    // the committed bytes would stop matching for no reason anyone could see.
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// The mark
// ---------------------------------------------------------------------------

/**
 * Coverage of one pixel by the mark, 0..1, by supersampling.
 *
 * Anti-aliasing is not decoration here: an eight-pointed star is all diagonals,
 * and aliased diagonals at launcher size look like a mistake. SAMPLES² points
 * per pixel is brute force and takes milliseconds at these dimensions.
 */
const SAMPLES = 4;

/** Inside the union of two squares of half-size `h`, one rotated 45°? */
function inStar(x, y, h) {
  if (Math.abs(x) <= h && Math.abs(y) <= h) return true;
  const r = Math.SQRT1_2; // cos 45° = sin 45°
  const rx = (x + y) * r;
  const ry = (y - x) * r;
  return Math.abs(rx) <= h && Math.abs(ry) <= h;
}

/**
 * Draw the mark into an RGBA buffer.
 *
 * `scale` is the mark's outer radius as a fraction of the shorter side. The
 * adaptive-icon foreground needs a small one — Android crops a 108dp canvas to
 * a 72dp circle and only guarantees the inner 66dp, so anything past ~0.33 of
 * the width risks being masked off on a round launcher.
 */
function drawMark(width, height, { background, ink, scale, ring = true }) {
  const rgba = Buffer.alloc(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const R = Math.min(width, height) * scale;
  const h = R * Math.SQRT1_2; // corners of both squares land exactly on R
  const ringOuter = R * 1.34;
  const ringInner = R * 1.24;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) / SAMPLES - cx;
          const y = py + (sy + 0.5) / SAMPLES - cy;
          if (inStar(x, y, h)) {
            hits++;
            continue;
          }
          if (ring) {
            const d = Math.hypot(x, y);
            if (d >= ringInner && d <= ringOuter) hits++;
          }
        }
      }
      const cover = hits / (SAMPLES * SAMPLES);
      const at = (py * width + px) * 4;
      if (background === null) {
        // Transparent plate: the mark carries the alpha itself, which is what
        // an adaptive foreground and a notification icon both need.
        rgba[at] = ink[0];
        rgba[at + 1] = ink[1];
        rgba[at + 2] = ink[2];
        rgba[at + 3] = Math.round(cover * 255);
      } else {
        for (let c = 0; c < 3; c++) {
          rgba[at + c] = Math.round(background[c] * (1 - cover) + ink[c] * cover);
        }
        rgba[at + 3] = 255;
      }
    }
  }
  return rgba;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * Decode one of OUR PNGs back to pixels.
 *
 * Not a general decoder and does not pretend to be: it only handles what
 * `encodePng` writes — 8-bit RGBA, no interlacing, filter 0 on every scanline.
 * It exists for --check below.
 */
function decodeOurPng(buf) {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const idat = [];
  let at = 8;
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(buf.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = y * (width * 4 + 1) + 1;
    raw.copy(rgba, y * width * 4, from, from + width * 4);
  }
  return { width, height, rgba };
}

/**
 * --check compares PIXELS, never the compressed bytes.
 *
 * The obvious check — regenerate and `git diff` — is a trap. zlib's deflate
 * output is not guaranteed stable across Node versions, so the day CI's Node
 * differs from a contributor's, the committed PNG stops matching, CI says "run
 * the generator and commit", they do, and CI fails again on the next push with
 * the same message. An unfixable loop over bytes that describe identical
 * images. Comparing what the file DRAWS has no such failure mode.
 */
const CHECK = process.argv.includes('--check');
let mismatched = 0;

function write(relative, width, height, rgba) {
  const path = join(ROOT, relative);
  if (CHECK) {
    let found;
    try {
      found = decodeOurPng(readFileSync(path));
    } catch (e) {
      console.error(`MISSING  ${relative} — ${e instanceof Error ? e.message : String(e)}`);
      mismatched++;
      return;
    }
    const same = found.width === width && found.height === height && found.rgba.equals(rgba);
    console.log(`${same ? 'ok      ' : 'DIFFERS '} ${relative.padEnd(44)} ${found.width}x${found.height}`);
    if (!same) mismatched++;
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  const png = encodePng(width, height, rgba);
  writeFileSync(path, png);
  console.log(`${relative.padEnd(44)} ${width}x${height}  ${String(png.length).padStart(7)} bytes`);
}

const targets = [
  // Expo's `icon`: full bleed, no transparency. Android and the store both
  // apply their own mask, so the art must not rely on the corners.
  ['src/assets/brand/icon.png', 1024, 1024, { background: GREEN, ink: GOLD, scale: 0.3 }],
  // Adaptive foreground: transparent, and small enough to survive the circle
  // mask. The background colour is set in app.json, not baked in here.
  ['src/assets/brand/adaptive-icon.png', 1024, 1024, { background: null, ink: GOLD, scale: 0.19 }],
  ['src/assets/brand/splash.png', 1024, 1024, { background: null, ink: GOLD, scale: 0.22 }],
  /**
   * Notification icon. Android masks this to a flat silhouette and ignores
   * colour entirely, so anything but white-on-transparent is wasted — and the
   * ring is dropped because at 24dp it closes up into a blob.
   */
  ['src/assets/brand/notification-icon.png', 96, 96, { background: null, ink: WHITE, scale: 0.34, ring: false }],
  // Play's store icon: 512x512, 32-bit PNG, no transparency.
  ['store/assets/play-icon-512.png', 512, 512, { background: GREEN, ink: GOLD, scale: 0.3 }],
];

for (const [path, w, h, opts] of targets) write(path, w, h, drawMark(w, h, opts));

/**
 * The feature graphic, 1024x500, which Play shows above the listing.
 *
 * Geometry only, and deliberately so: there is no font rasteriser in this
 * toolchain, so any wordmark would have to be hand-plotted polygons, which
 * would look exactly as bad as that sounds. A purely geometric banner is a
 * legitimate feature graphic; the app name can be set over it later by anyone
 * with a design tool, and until then this is honest rather than amateur.
 */
{
  const W = 1024;
  const H = 500;
  const rgba = Buffer.alloc(W * H * 4);
  const R = H * 0.34;
  const h = R * Math.SQRT1_2;
  // Off-centre to the right, so the left two thirds stay clear for a wordmark.
  const cx = W * 0.78;
  const cy = H / 2;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) / SAMPLES - cx;
          const y = py + (sy + 0.5) / SAMPLES - cy;
          const d = Math.hypot(x, y);
          if (inStar(x, y, h) || (d >= R * 1.24 && d <= R * 1.34)) hits++;
        }
      }
      const cover = hits / (SAMPLES * SAMPLES);
      // A gentle horizontal lift towards the mark, so the banner is not a flat
      // rectangle of one colour.
      const lift = 0.10 * (px / W) ** 2;
      const at = (py * W + px) * 4;
      for (let c = 0; c < 3; c++) {
        const bg = GREEN[c] + (255 - GREEN[c]) * lift * 0.22;
        rgba[at + c] = Math.round(bg * (1 - cover) + GOLD[c] * cover);
      }
      rgba[at + 3] = 255;
    }
  }
  write('store/assets/feature-graphic-1024x500.png', W, H, rgba);
}

if (CHECK) {
  if (mismatched > 0) {
    console.error(`\n${mismatched} committed image(s) are not what this script draws. Run: npm run gen:icons`);
    process.exit(1);
  }
  console.log('\nevery committed image matches the generator, pixel for pixel');
}
