/**
 * Asserts the Play Store field limits on the listing files, so a copy edit can
 * never silently produce a title Play will refuse.
 *
 * The listings are Markdown, not a machine format, because a human rewrites
 * them. So this reads the fenced code blocks that follow each `## <field>`
 * heading: the first fenced block under a heading is the primary value, and the
 * rest are alternatives, all held to the same limit.
 *
 *   node store/check-lengths.mjs
 *
 * Counts characters the way Play does: UTF-16 code units are what web forms
 * count, and every string here is BMP-only, so String.length is correct for
 * both English and Arabic. Combining marks DO count — that matters for Arabic
 * with tashkeel, which is why nothing here is stripped before counting.
 */
import { readFileSync } from 'node:fs';

const LIMITS = [
  { match: /^##\s.*\(30 max\)/i, limit: 30, label: 'title' },
  { match: /^##\s.*\(80 max\)/i, limit: 80, label: 'short description' },
  { match: /^##\s.*\(4000 max\)/i, limit: 4000, label: 'full description' },
];

const FILES = ['store/listing/en-US.md', 'store/listing/ar.md'];

let failed = 0;

for (const file of FILES) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let active = null;
  let fence = null;
  let buffer = [];

  const finish = () => {
    if (active === null) return;
    const value = buffer.join('\n').trim();
    const n = [...value].length; // code points, for the human-readable number
    const units = value.length; // what a form counts
    const ok = units <= active.limit;
    if (!ok) failed += 1;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'}  ${file}  ${active.label.padEnd(17)} ` +
        `${String(units).padStart(4)}/${active.limit}` +
        (units === n ? '' : ` (${n} code points)`),
    );
  };

  for (const line of lines) {
    if (fence !== null) {
      if (line.startsWith(fence)) {
        finish();
        fence = null;
        buffer = [];
      } else {
        buffer.push(line);
      }
      continue;
    }
    if (line.startsWith('## ')) {
      active = LIMITS.find((l) => l.match.test(line)) ?? null;
      continue;
    }
    // Only ``` fences hold listing values; tables and prose are skipped.
    if (active !== null && /^```/.test(line)) {
      fence = '```';
      buffer = [];
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} field(s) over the Play limit.`);
  process.exit(1);
}
console.log('\nAll listing fields are within Play limits.');
