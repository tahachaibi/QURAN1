/**
 * Measures the engine's share of the §5.7 budget ("a spoken word reflected on
 * screen in under 300 ms from the recognizer emitting it"). This is the part
 * that is measurable off-device: normalize + align + localize per partial, over
 * the real 77k-word array. Run with `npm run bench`.
 */
import { align, LOOK_AHEAD_LOCKED, LOOK_AHEAD_SEEKING } from '../src/engine/align';
import { localize } from '../src/engine/localize';
import { normalizeHeard } from '../src/engine/normalize';
import { vocabulary } from '../src/engine/searchIndex';
import { words, surahOf } from '../src/data/quran';

const vocab = vocabulary();

function bench(label: string, fn: () => void, iterations: number): number {
  for (let i = 0; i < 50; i++) fn(); // warm
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const q = (p: number) => samples[Math.min(samples.length - 1, Math.floor(p * samples.length))];
  console.log(
    `${label.padEnd(46)} median ${q(0.5).toFixed(3)}ms  p95 ${q(0.95).toFixed(3)}ms  max ${samples[samples.length - 1].toFixed(3)}ms`,
  );
  return q(0.95);
}

const jumpText = 'ان الذين كفروا سواء عليهم انذرتهم ام لم تنذرهم';
const localHeard = normalizeHeard('اهدنا الصراط المستقيم صراط الذين انعمت عليهم', vocab);
const jumpHeard = normalizeHeard(jumpText, vocab);
const stopwordy = normalizeHeard('من الله في ما لا الذين على', vocab);

console.log(`words in array: ${words.length}\n`);

bench('normalizeHeard (8 words)', () => normalizeHeard(jumpText, vocab), 5000);
bench('align, locked on (lookAhead 3)', () => align({ words, startCursor: 17, heard: localHeard, lookAhead: LOOK_AHEAD_LOCKED }), 5000);
bench('align, seeking (lookAhead 8 + backtrack 24)', () => align({ words, startCursor: 17, heard: localHeard, lookAhead: LOOK_AHEAD_SEEKING }), 5000);
bench('localize, cross-Quran candidate search', () => localize({ words, cursor: 17, livePos: 17, heard: jumpHeard, localScore: 0.1, surahOf, viewSurah: 1 }), 3000);
bench('localize, all-stopword transcript (worst case)', () => localize({ words, cursor: 17, livePos: 17, heard: stopwordy, localScore: 0.1, surahOf }), 3000);

const fullP95 = bench(
  'FULL per-partial path (normalize+align+localize)',
  () => {
    const heard = normalizeHeard(jumpText, vocab);
    const a = align({ words, startCursor: 17, heard, lookAhead: LOOK_AHEAD_SEEKING });
    localize({ words, cursor: 17, livePos: 17, heard, localScore: a.score, surahOf, viewSurah: 1 });
  },
  3000,
);

console.log(`\nengine p95 for one partial: ${fullP95.toFixed(3)} ms out of the 300 ms budget`);
if (fullP95 >= 20) {
  console.error('REGRESSION: engine alone now exceeds 20 ms per partial');
  process.exit(1);
}
