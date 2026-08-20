/**
 * Writes the synthetic replay fixtures to __tests__/fixtures/ (spec §9).
 *
 * These are HAND-WRITTEN, marked `synthetic: true`, and exist so the harness has
 * something to run before any device transcript is captured. They are not a
 * substitute for real captures: the debug overlay's "Export replay fixture"
 * button produces the real thing, which drops into this same directory and runs
 * through the same loader with no changes.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';

import { syntheticFixture, type ReplayFixture } from '../src/engine/replay';
import { wordIndexOf } from '../src/data/quran';

// resolved from the project root, not __dirname: this file runs from the
// compiled output in tsconfig.bench.json's outDir
const DIR = join(process.cwd(), '__tests__', 'fixtures');

const FATIHA: string[][] = [
  ['بسم', 'الله', 'الرحمن', 'الرحيم'],
  ['الحمد', 'لله', 'رب', 'العالمين'],
  ['الرحمن', 'الرحيم'],
  ['مالك', 'يوم', 'الدين'],
  ['اياك', 'نعبد', 'واياك', 'نستعين'],
  ['اهدنا', 'الصراط', 'المستقيم'],
  ['صراط', 'الذين', 'انعمت', 'عليهم'],
  ['غير', 'المغضوب', 'عليهم', 'ولا', 'الضالين'],
];

const fixtures: ReplayFixture[] = [
  syntheticFixture(
    'fatiha-clean',
    0,
    FATIHA,
    'Al-Fatiha at natural speed with the recognizer spellings Android actually emits ' +
      '(plene madd, مالك, المستقيم). Expected: cursor 29, zero mistakes.',
  ),
  syntheticFixture(
    'fatiha-into-baqarah',
    wordIndexOf(1, 7),
    [
      ['صراط', 'الذين', 'انعمت', 'عليهم'],
      ['غير', 'المغضوب', 'عليهم', 'ولا', 'الضالين'],
      ['بسم', 'الله', 'الرحمن', 'الرحيم'],
      ['الم', 'ذلك', 'الكتاب', 'لا', 'ريب', 'فيه', 'هدى', 'للمتقين'],
    ],
    'Continuous recitation across a surah boundary. Expected: no localization jump, ' +
      'the cursor simply increments into Al-Baqarah.',
  ),
  {
    name: 'jump-to-2-6-no-basmala',
    startCursor: 0,
    synthetic: true,
    notes:
      'Open at Al-Fatiha, recite 2:6 with no basmala. Expected: lands on 2:6 within two ' +
      'partials, credits the whole verse, logs no mistakes.',
    events: [
      { kind: 'partial', alternatives: ['ان الذين'] },
      { kind: 'partial', alternatives: ['ان الذين كفروا'] },
      { kind: 'partial', alternatives: ['ان الذين كفروا سواء'] },
      { kind: 'partial', alternatives: ['ان الذين كفروا سواء عليهم'] },
      { kind: 'partial', alternatives: ['ان الذين كفروا سواء عليهم انذرتهم'] },
      { kind: 'final', alternatives: ['ان الذين كفروا سواء عليهم انذرتهم ام لم تنذرهم'] },
      { kind: 'segment' },
      { kind: 'partial', alternatives: ['لا يؤمنون'] },
      { kind: 'final', alternatives: ['لا يؤمنون'] },
    ],
  },
  {
    name: 'breath-restart',
    startCursor: 0,
    synthetic: true,
    notes:
      'Stop mid-verse, breathe, resume a few words earlier. Expected: livePos follows the ' +
      'voice back, the cursor holds, nothing is un-revealed and nothing is flagged.',
    events: [
      { kind: 'partial', alternatives: ['اياك نعبد واياك'] },
      { kind: 'final', alternatives: ['اياك نعبد واياك نستعين اهدنا'] },
      { kind: 'segment' },
      { kind: 'partial', alternatives: ['واياك نستعين'], dt: 2200 },
      { kind: 'partial', alternatives: ['واياك نستعين اهدنا'] },
      { kind: 'final', alternatives: ['واياك نستعين اهدنا الصراط المستقيم'] },
    ],
  },
  {
    name: 'one-misread-word',
    startCursor: 4,
    synthetic: true,
    notes:
      'العالمين dropped by every alternative. Expected: flagged exactly once, only after ' +
      'the reciter is more than three words clear of it.',
    events: [
      { kind: 'partial', alternatives: ['الحمد لله رب'] },
      {
        kind: 'final',
        alternatives: [
          'الحمد لله رب الرحمن الرحيم',
          'الحمد لله رب الرحمن الرحيم',
          'الحمد لله رب الرحمن الرحيم',
        ],
      },
      { kind: 'segment' },
      { kind: 'partial', alternatives: ['مالك يوم الدين'] },
      { kind: 'final', alternatives: ['مالك يوم الدين'] },
    ],
  },
];

for (const fixture of fixtures) {
  const path = join(DIR, `${fixture.name}.json`);
  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`wrote ${path} (${fixture.events.length} events)`);
}
