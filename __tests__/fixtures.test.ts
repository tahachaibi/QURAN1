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

/**
 * Ten sessions recorded on one phone on 2026-09-26, read in order from 1:1 to
 * 2:48, with the recognizer's own misspellings intact ("دائم" for "تبع هداي",
 * "وعوفوا بعه" for "وأوفوا بعهدي"). Each is pinned to where it ends and to a
 * ceiling on how many words it blames, so an engine change that loses the
 * reciter, or starts blaming words they said, shows up as a named session.
 *
 * The ceilings are today's counts. Lowering one is an improvement to be made
 * on purpose; raising one needs a reason.
 */
const DEVICE_RUN: Record<string, { end: number; maxMistakes: number }> = {
  '01': { end: 30, maxMistakes: 0 },
  '02': { end: 88, maxMistakes: 0 },
  '03': { end: 173, maxMistakes: 2 },
  '04': { end: 259, maxMistakes: 5 },
  '05': { end: 360, maxMistakes: 2 },
  '06': { end: 460, maxMistakes: 0 },
  '07': { end: 528, maxMistakes: 0 },
  '08': { end: 589, maxMistakes: 1 },
  '09': { end: 647, maxMistakes: 0 },
  '10': { end: 699, maxMistakes: 0 },
};
for (const [id, { end, maxMistakes }] of Object.entries(DEVICE_RUN)) {
  EXPECTATIONS[`device-2026-09-26-${id}`] = (out) => {
    expect(out.final.cursor).toBe(end);
    expect(out.mistakes.length).toBeLessThanOrEqual(maxMistakes);
  };
}

/**
 * Session 09 is the one where the reciter went back. What the transcript shows:
 * after 2:39 they began 2:40, "يا بني إسرائيل اذكروا نعمتي التي أنعمت عليكم", and
 * finished it with 2:47's ending, "أني فضلتكم على العالمين" — the two verses open
 * with the same eight words. They carried on into 2:48, stopped, and went back
 * to recite 2:40 properly, then 2:41 and 2:42.
 *
 * The engine relocated three times — into 2:48, to 2:47 on the repeated
 * opening (the words cannot tell the two apart), and to 2:41 on "وآمنوا بما
 * أنزلت مصدقا" — and ended following 2:42. Every backward move is one of those.
 *
 * NOT asserted, deliberately: that the slip into 2:47 was flagged. It was not;
 * the engine followed the reciter to 2:47 instead of telling them they had left
 * 2:40. Pinning mistakes = [] here would make that gap look intended.
 */
/**
 * What the review sheet says was said in each flagged word's place, on the
 * phone's own sessions. Before this was pinned, the skipped اهبطوا (2:36) read
 * "heard: يا" (from "يا آدم", two ayahs back) and the skipped أندادا (2:22) read
 * "heard: وا" (a segment's leftover tail). A reciter shown a word they never
 * said in that place cannot tell what they did wrong. '' means "skipped".
 */
const HEARD_IN_PLACE: Record<string, [surah: number, ayah: number, offset: number, heard: string][]> = {
  '03': [[2, 8, 10, ''], [2, 13, 8, 'هلومن']],
  '04': [[2, 19, 0, ''], [2, 19, 1, ''], [2, 19, 4, 'في'], [2, 20, 3, '']],
  '05': [[2, 22, 4, 'فيران'], [2, 22, 20, '']],
  '08': [[2, 36, 8, '']],
};
for (const [id, expected] of Object.entries(HEARD_IN_PLACE)) {
  const baseline = EXPECTATIONS[`device-2026-09-26-${id}`];
  EXPECTATIONS[`device-2026-09-26-${id}`] = (out) => {
    baseline(out);
    const said = new Map(out.final.mistakes.map((m) => [m.word, m.heardInstead]));
    for (const [surah, ayah, offset, heard] of expected) {
      expect([surah, ayah, offset, said.get(wordIndexOf(surah, ayah) + offset)]).toEqual([surah, ayah, offset, heard]);
    }
  };
}

const baseline09 = EXPECTATIONS['device-2026-09-26-09'];
EXPECTATIONS['device-2026-09-26-09'] = (out) => {
  baseline09(out);
  const backward = out.cursorPath.filter((c, i) => i > 0 && c < out.cursorPath[i - 1]);
  expect(backward).toHaveLength(3);
  // never back past where the session began
  expect(Math.min(...out.cursorPath)).toBeGreaterThanOrEqual(589);
  expect(out.frames[out.frames.length - 1].lockedOn).toBe(true);
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

      /**
       * `cursor` is the furthest point reached, so re-reading words already
       * behind it — a transcript restart, a breath taken and a phrase repeated —
       * must never pull it back; that is what `livePos` is for.
       *
       * The one legitimate way back is a RELOCATION: the reciter deliberately
       * goes somewhere else, the engine finds them there and says so with a
       * JUMPED reason. Session 09 from the phone does exactly that, and the user
       * confirmed it was them. Anything else moving the cursor back is the bug.
       */
      it('only moves the cursor backwards by relocating', () => {
        for (let i = 1; i < out.cursorPath.length; i++) {
          if (out.cursorPath[i] < out.cursorPath[i - 1]) {
            expect(out.frames[i].jumpReason).toMatch(/^JUMPED/);
          }
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
