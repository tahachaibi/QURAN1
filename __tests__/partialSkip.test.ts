/**
 * Dropping the partials that cannot tell us anything new.
 *
 * Android re-emits its entire transcript on every partial, and on the captured
 * device session 43 of 73 of them — 59% — were byte-identical to the one before.
 * Each repeat re-aligned five growing alternatives and rebuilt the page for a
 * result that could not possibly differ.
 *
 * The risk of an optimisation like this is that it skips something that WOULD
 * have differed, so the conditions are pinned here: same transcript AND same
 * starting cursor, partial only, and the liveness clock still moves.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { initialSession, sessionReducer, type SessionConfig, type SessionState } from '../src/engine/session';
import { replay, type ReplayFixture } from '../src/engine/replay';
import { surahOf, words } from '../src/data/quran';
import { vocabulary } from '../src/engine/searchIndex';

const config: SessionConfig = {
  words,
  surahOf,
  vocabulary: vocabulary(),
  floor: 0,
  limit: words.length,
  viewSurah: 1,
};

const listening = (cursor = 0): SessionState =>
  sessionReducer(initialSession(cursor), { type: 'start', at: 1_000, cursor }, config);

const partial = (state: SessionState, text: string, at: number): SessionState =>
  sessionReducer(state, { type: 'partial', alternatives: [text], at, emittedAt: at }, config);

const FIRST = 'بسم الله الرحمن الرحيم';

describe('repeated partials', () => {
  it('keeps every array and set by reference when the partial repeats', () => {
    const a = partial(listening(), FIRST, 2_000);
    const b = partial(a, FIRST, 2_300);

    expect(b.cursor).toBe(a.cursor);
    expect(b.matched).toBe(a.matched);
    expect(b.utteranceHeard).toBe(a.utteranceHeard);
    expect(b.debug).toBe(a.debug);
    expect(b.pending).toBe(a.pending);
  });

  it('still moves the liveness clock, so the watchdog does not restart the session', () => {
    const a = partial(listening(), FIRST, 2_000);
    const b = partial(a, FIRST, 2_300);
    // A repeat is not new information, but it IS proof the recognizer is alive.
    expect(b.lastResultAt).toBe(2_300);
    expect(a.lastResultAt).toBe(2_000);
  });

  it('processes a partial that grew by even one word', () => {
    const a = partial(listening(), FIRST, 2_000);
    const b = partial(a, `${FIRST} الحمد`, 2_300);
    expect(b.cursor).toBeGreaterThan(a.cursor);
    expect(b.utteranceHeard).not.toBe(a.utteranceHeard);
  });

  it('never skips a final, even when its text repeats the partial', () => {
    const a = partial(listening(), FIRST, 2_000);
    const b = sessionReducer(
      a,
      { type: 'final', alternatives: [FIRST], at: 2_300, emittedAt: 2_300 },
      config,
    );
    // a final commits the utterance: utteranceStart moves to the cursor
    expect(b.utteranceStart).toBe(b.cursor);
    expect(b.utteranceHeard).not.toBe(a.utteranceHeard);
  });

  /**
   * The one way this could change an answer: the same words aligned from a
   * different cursor are a different question, so a seek has to invalidate it.
   */
  it('re-processes the same transcript after the cursor was moved', () => {
    const a = partial(listening(), FIRST, 2_000);
    const moved = sessionReducer(a, { type: 'seek', to: 8, at: 2_100 }, config);
    const b = partial(moved, FIRST, 2_300);
    expect(b.utteranceHeard).not.toBe(moved.utteranceHeard);
  });

  it('does not skip when only one of several alternatives changed', () => {
    const base = listening();
    const a = sessionReducer(
      base,
      { type: 'partial', alternatives: [FIRST, 'بسم الله'], at: 2_000, emittedAt: 2_000 },
      config,
    );
    const b = sessionReducer(
      a,
      { type: 'partial', alternatives: [FIRST, 'بسم الله الرحمن'], at: 2_300, emittedAt: 2_300 },
      config,
    );
    expect(b.debug).not.toBe(a.debug);
  });
});

describe('the real capture, replayed', () => {
  const fixture = JSON.parse(
    readFileSync(join(__dirname, 'fixtures/device-fatiha-full.json'), 'utf8'),
  ) as ReplayFixture;

  it('still follows to the last word of Al-Fatiha', () => {
    const out = replay(fixture, config);
    expect(out.final.cursor).toBe(29);
    expect(out.mistakes).toEqual([]);
  });

  it('is mostly repeats, which is why the skip is worth having', () => {
    let repeats = 0;
    let previous: string | null = null;
    for (const event of fixture.events) {
      const text = (event.alternatives ?? [''])[0];
      if (event.kind === 'partial' && text === previous) repeats++;
      previous = text;
    }
    // 43 of 73 when this was written; assert the property, not the exact count
    expect(repeats).toBeGreaterThan(fixture.events.length / 3);
  });
});
