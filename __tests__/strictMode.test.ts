/**
 * Hidden mode's strict following (SessionConfig.strict): a wrong word or a
 * skip holds the cursor on the word the reciter owes, marks it as a mistake,
 * and following resumes the moment that word is said.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { replay, type ReplayEvent, type ReplayFixture } from '../src/engine/replay';
import type { SessionConfig } from '../src/engine/session';
import { surahOf, wordIndexOf, words } from '../src/data/quran';
import { vocabulary } from '../src/engine/searchIndex';

const base: SessionConfig = { words, surahOf, vocabulary: vocabulary(), floor: 0, limit: words.length, viewSurah: 1 };
const strict: SessionConfig = { ...base, strict: true };

const AL_HAMD = wordIndexOf(1, 2); // الحمد لله رب العالمين
const RABB = AL_HAMD + 2;
const ALAMIN = AL_HAMD + 3;

const final = (text: string): ReplayEvent => ({ kind: 'final', alternatives: [text] });
const partial = (text: string): ReplayEvent => ({ kind: 'partial', alternatives: [text] });
const segment: ReplayEvent = { kind: 'segment' };

const run = (config: SessionConfig, events: ReplayEvent[]) =>
  replay({ name: 'strict', startCursor: AL_HAMD, synthetic: true, events }, config);

describe('strict following in Hidden mode', () => {
  it('holds on a wrong word, marks it, and moves on once the right word is said', () => {
    const wrong = run(strict, [final('الحمد لله رب'), segment, final('السماوات')]);
    expect(wrong.final.cursor).toBe(ALAMIN);
    expect(wrong.mistakes).toEqual([ALAMIN]);

    const fixed = run(strict, [final('الحمد لله رب'), segment, final('السماوات'), segment, final('العالمين')]);
    expect(fixed.final.cursor).toBe(ALAMIN + 1);
    // still a mistake: it was said wrong first
    expect(fixed.mistakes).toEqual([ALAMIN]);
    expect(fixed.final.mistakes[0].heardRaw).toBe('السماوات');
  });

  it('does not carry the cursor past a skipped word', () => {
    const out = run(strict, [final('الحمد لله'), segment, final('العالمين')]);
    expect(out.final.cursor).toBe(RABB);
    expect(out.mistakes).toEqual([RABB]);

    const resumed = run(strict, [final('الحمد لله'), segment, final('العالمين'), segment, final('رب العالمين')]);
    expect(resumed.final.cursor).toBe(ALAMIN + 1);
  });

  it('is not fooled by going back to restart the ayah', () => {
    const out = run(strict, [final('الحمد لله رب'), segment, final('الحمد لله رب العالمين')]);
    expect(out.final.cursor).toBe(ALAMIN + 1);
    expect(out.mistakes).toEqual([]);
  });

  it('never calls the words a partial is still recognising wrong', () => {
    const out = run(strict, [final('الحمد لله رب'), segment, partial('السما')]);
    expect(out.final.cursor).toBe(ALAMIN);
    expect(out.mistakes).toEqual([]);
  });

  it('still finds the reciter at the start, anywhere in the Quran', () => {
    const out = replay(
      {
        name: 'strict-start',
        startCursor: 0,
        synthetic: true,
        events: [partial('ان الذين كفروا سواء'), final('ان الذين كفروا سواء عليهم')],
      },
      strict,
    );
    expect(surahOf(out.final.cursor)).toBe(2);
    expect(out.mistakes).toEqual([]);
  });

  it('leaves Seen mode as it was: a skip is followed past', () => {
    const out = run(base, [final('الحمد لله'), segment, final('العالمين الرحمن الرحيم')]);
    expect(out.final.cursor).toBeGreaterThan(ALAMIN);
  });
});

describe('device recordings in Hidden mode', () => {
  it.each([
    ['device-2026-10-10-fatiha-stream.json', wordIndexOf(2, 1)],
    ['device-2026-10-10-baqarah-stream.json', wordIndexOf(2, 8)],
  ])('follows %s to the end and marks nothing that was said right', (file, end) => {
    const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures', file), 'utf8')) as ReplayFixture;
    const out = replay(fx, strict);
    expect(out.final.cursor).toBe(end);
    // «ن آمين» after Al-Fatiha is not a mistake on الم
    expect(out.mistakes).toEqual([]);
  });
});
