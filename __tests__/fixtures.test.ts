/**
 * The replay harness running against fixture FILES (spec §9).
 *
 * Every fixture in __tests__/fixtures/ is loaded and replayed, so a transcript
 * captured on a device via the debug overlay's "Export replay fixture" button
 * becomes a regression test by being dropped into this directory — no code
 * change required. The expectations below are per-fixture, keyed by name.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { replay, type ReplayFixture, type ReplayOutcome } from '../src/engine/replay';
import type { SessionConfig } from '../src/engine/session';
import { surahOf, wordIndexOf, words } from '../src/data/quran';
import { vocabulary } from '../src/engine/searchIndex';

const DIR = join(__dirname, 'fixtures');

const config: SessionConfig = {
  words,
  surahOf,
  vocabulary: vocabulary(),
  floor: 0,
  limit: words.length,
  viewSurah: 1,
};

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

const AYAH_2_6 = wordIndexOf(2, 6);
const SURAH_2 = wordIndexOf(2, 1);

/** Per-fixture assertions. A fixture with no entry only has to not crash. */
const EXPECTATIONS: Record<string, (out: ReplayOutcome) => void> = {
  'fatiha-clean': (out) => {
    expect(out.final.cursor).toBe(29);
    expect(out.mistakes).toEqual([]);
    expect(out.final.matched.size).toBe(29);
    expect(out.final.longestCleanRun).toBe(29);
  },
  'fatiha-into-baqarah': (out) => {
    expect(out.final.cursor).toBe(SURAH_2 + 8);
    expect(out.mistakes).toEqual([]);
    expect(out.frames.some((f) => f.jumpReason.startsWith('JUMPED'))).toBe(false);
  },
  'jump-to-2-6-no-basmala': (out) => {
    expect(out.final.cursor).toBe(AYAH_2_6 + 11);
    expect(out.mistakes).toEqual([]);
    const jumped = out.frames.findIndex((f) => f.jumpReason.startsWith('JUMPED'));
    expect(jumped).toBeGreaterThanOrEqual(0);
    expect(jumped).toBeLessThanOrEqual(5);
  },
  'breath-restart': (out) => {
    expect(out.frames[1].cursor).toBe(18);
    expect(out.frames[3].livePos).toBeLessThan(out.frames[1].cursor);
    expect(out.frames[3].cursor).toBe(out.frames[1].cursor);
    expect(out.mistakes).toEqual([]);
  },
  /**
   * The first fixture captured from a real phone rather than written by me.
   * Al-Fatiha straight through, and the assertions below are the three things a
   * real recognizer did that a hand-written fixture would not have thought of.
   */
  'device-fatiha-full': (out) => {
    // followed to the last word of 1:7, with nothing skipped and nothing blamed
    expect(out.final.cursor).toBe(29);
    expect(out.mistakes).toEqual([]);
    expect(out.final.matched.size).toBe(29);
    expect(out.final.longestCleanRun).toBe(29);

    /**
     * The recognizer restarted its transcript twice mid-surah. Segment 2 opens
     * with "الرحمن الرحيم", which also sits at 1:1 four words behind the cursor,
     * and segment 3 opens by repeating "الدين", already consumed. Neither may
     * move the cursor backwards — the whole point of the two-position model.
     */
    for (let i = 1; i < out.cursorPath.length; i++) {
      expect(out.cursorPath[i]).toBeGreaterThanOrEqual(out.cursorPath[i - 1]);
    }
    // and neither may be resolved by teleporting somewhere else in the Quran
    expect(out.frames.some((f) => f.jumpReason.startsWith('JUMPED'))).toBe(false);

    /**
     * The repeated "الدين" run: six consecutive frames where the reciter's own
     * word came back a second time. The cursor has to sit still through all of
     * them rather than re-consuming or re-blaming.
     */
    const stalled = out.frames.filter((f) => f.cursor === 13);
    expect(stalled.length).toBeGreaterThanOrEqual(6);
    for (const frame of stalled) expect(frame.mistakes).toEqual([]);
  },
  'one-misread-word': (out) => {
    expect(out.mistakes).toEqual([7]);
    // and never before the reciter was clear of it
    const firstFlag = out.frames.findIndex((f) => f.mistakes.length > 0);
    expect(out.frames[firstFlag].cursor - 7).toBeGreaterThan(3);
  },
};

describe('replay fixtures', () => {
  it('finds fixtures to run', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  /**
   * A guard on the test suite itself. Fixtures I write cannot tell me the
   * recognizer emits "مالك" without the alif, or that it restarts its transcript
   * from empty mid-surah — I only know those because a real capture showed them.
   * If this ever fails, the suite has quietly gone back to testing my
   * assumptions instead of a phone's behaviour.
   */
  it('includes at least one capture from a real device', () => {
    const captured = files
      .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as ReplayFixture)
      .filter((f) => f.synthetic !== true);
    expect(captured.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as ReplayFixture;

    describe(fixture.name, () => {
      const out = replay(fixture, config);

      it('replays deterministically', () => {
        const again = replay(fixture, config);
        expect(again.cursorPath).toEqual(out.cursorPath);
        expect(again.mistakes).toEqual(out.mistakes);
      });

      it('never moves the cursor backwards', () => {
        for (let i = 1; i < out.cursorPath.length; i++) {
          expect(out.cursorPath[i]).toBeGreaterThanOrEqual(out.cursorPath[i - 1]);
        }
      });

      it('stays inside the Quran', () => {
        expect(out.final.cursor).toBeGreaterThanOrEqual(0);
        expect(out.final.cursor).toBeLessThanOrEqual(words.length);
      });

      const expectation = EXPECTATIONS[fixture.name];
      if (expectation !== undefined) {
        it('matches its recorded expectation', () => expectation(out));
      }
    });
  }
});
