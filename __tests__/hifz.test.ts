/**
 * Hifz scheduling and the confusion profile.
 *
 * These are the two features that go beyond the brief, so they get held to the
 * same standard as the engine: pure functions, fixed clock, no guessing.
 */
import {
  applyEvidence,
  contiguousRuns,
  DEFAULT_EASINESS,
  dueQueue,
  gradeFor,
  MAX_INTERVAL_DAYS,
  MIN_EASINESS,
  newCard,
  review,
  strengthOf,
  summarize,
  type AyahEvidence,
  type HifzDeck,
} from '../src/engine/hifz';
import { collectEvidence } from '../src/engine/evidence';
import {
  analyseMistake,
  buildProfile,
  actionablePatterns,
  MIN_PATTERN_COUNT,
  type MistakeRecord,
} from '../src/engine/confusion';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000; // fixed clock: scheduling must be deterministic

const evidence = (over: Partial<AyahEvidence> = {}): AyahEvidence => ({
  ayah: 10,
  totalWords: 10,
  recitedWords: 10,
  missedWords: 0,
  hintedWords: 0,
  revealedWords: 0,
  ...over,
});

describe('grading from per-word evidence', () => {
  it('gives a clean ayah full marks', () => {
    expect(gradeFor(evidence())).toBe(5);
  });

  it('never gives full marks to an ayah that needed help', () => {
    expect(gradeFor(evidence({ hintedWords: 1 }))).toBeLessThan(5);
    expect(gradeFor(evidence({ missedWords: 1 }))).toBeLessThan(5);
  });

  it('penalises a reveal more than a nudge, and a mistake most of all', () => {
    const nudge = gradeFor(evidence({ totalWords: 20, hintedWords: 3, revealedWords: 0 }));
    const reveal = gradeFor(evidence({ totalWords: 20, hintedWords: 3, revealedWords: 3 }));
    const mistake = gradeFor(evidence({ totalWords: 20, missedWords: 3 }));
    expect(reveal).toBeLessThanOrEqual(nudge);
    expect(mistake).toBeLessThanOrEqual(reveal);
  });

  it('refuses to call a barely-touched ayah recall', () => {
    expect(gradeFor(evidence({ recitedWords: 3 }))).toBeLessThanOrEqual(1);
  });

  it('stays inside 0..5 for absurd input', () => {
    for (const e of [
      evidence({ totalWords: 1, recitedWords: 99 }),
      evidence({ missedWords: 99 }),
      evidence({ totalWords: 0, recitedWords: 0 }),
      evidence({ hintedWords: 99, revealedWords: 99 }),
    ]) {
      const g = gradeFor(e);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(5);
    }
  });
});

describe('SM-2 review scheduling', () => {
  it('walks a well-known ayah out to longer and longer intervals', () => {
    let card = newCard(1, T0);
    const intervals: number[] = [];
    let now = T0;
    for (let i = 0; i < 6; i++) {
      card = review(card, 5, now);
      intervals.push(card.intervalDays);
      now = card.dueAt;
    }
    expect(intervals[0]).toBe(1);
    expect(intervals[1]).toBe(3);
    for (let i = 2; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    }
    expect(card.easiness).toBeGreaterThan(DEFAULT_EASINESS);
  });

  it('caps the interval, because an ayah left for a year is gone', () => {
    let card = newCard(1, T0);
    let now = T0;
    for (let i = 0; i < 30; i++) {
      card = review(card, 5, now);
      now = card.dueAt;
    }
    expect(card.intervalDays).toBe(MAX_INTERVAL_DAYS);
  });

  it('sends a failed ayah back to tomorrow and resets the streak', () => {
    let card = newCard(1, T0);
    card = review(card, 5, T0);
    card = review(card, 5, T0 + DAY);
    expect(card.repetitions).toBe(2);
    const failed = review(card, 1, T0 + 4 * DAY);
    expect(failed.repetitions).toBe(0);
    expect(failed.intervalDays).toBe(1);
    expect(failed.lapses).toBe(1);
    expect(failed.easiness).toBeLessThan(card.easiness);
  });

  it('never lets easiness fall below the floor', () => {
    let card = newCard(1, T0);
    let now = T0;
    for (let i = 0; i < 40; i++) {
      card = review(card, 0, now);
      now += DAY;
    }
    expect(card.easiness).toBe(MIN_EASINESS);
  });

  it('is deterministic: the same grades from the same clock give the same card', () => {
    const run = (): ReturnType<typeof review> => {
      let c = newCard(7, T0);
      let now = T0;
      for (const g of [5, 3, 4, 2, 5, 5]) {
        c = review(c, g, now);
        now = c.dueAt;
      }
      return c;
    };
    expect(run()).toEqual(run());
  });
});

describe('deck, queue and strength', () => {
  it('folds a session into the deck and grades every ayah touched', () => {
    const { deck, graded } = applyEvidence(
      {},
      [evidence({ ayah: 5 }), evidence({ ayah: 6, missedWords: 2 })],
      T0,
    );
    expect(Object.keys(deck)).toHaveLength(2);
    expect(graded.find((g) => g.ayah === 5)?.grade).toBe(5);
    expect(graded.find((g) => g.ayah === 6)?.grade).toBeLessThan(5);
  });

  it('returns the same deck when there is nothing to apply', () => {
    const deck: HifzDeck = {};
    expect(applyEvidence(deck, [], T0).deck).toBe(deck);
  });

  it('queues the weakest and most overdue first, and never queues the unseen', () => {
    let deck: HifzDeck = {};
    deck = applyEvidence(deck, [evidence({ ayah: 1 })], T0).deck; // strong
    deck = applyEvidence(deck, [evidence({ ayah: 2, missedWords: 5 })], T0).deck; // weak
    deck = applyEvidence(deck, [evidence({ ayah: 3, missedWords: 2 })], T0).deck; // middling
    deck['99'] = newCard(99, T0); // never reviewed

    const queue = dueQueue(deck, T0 + 40 * DAY);
    expect(queue.map((q) => q.ayah)).not.toContain(99);
    expect(queue[0].ayah).toBe(2);
    for (let i = 1; i < queue.length; i++) {
      expect(queue[i].strength).toBeGreaterThanOrEqual(queue[i - 1].strength);
    }
  });

  it('does not queue an ayah before it is due', () => {
    const deck = applyEvidence({}, [evidence({ ayah: 4 })], T0).deck;
    expect(dueQueue(deck, T0)).toEqual([]);
    expect(dueQueue(deck, T0 + 2 * DAY).map((q) => q.ayah)).toEqual([4]);
  });

  it('decays strength as an ayah goes overdue', () => {
    const deck = applyEvidence({}, [evidence({ ayah: 8 })], T0).deck;
    const card = deck['8'];
    const fresh = strengthOf(card, T0);
    const overdue = strengthOf(card, T0 + 30 * DAY);
    expect(overdue).toBeLessThan(fresh);
    expect(overdue).toBeGreaterThanOrEqual(0);
  });

  it('scores an unreviewed ayah as zero strength', () => {
    expect(strengthOf(newCard(1, T0), T0)).toBe(0);
  });

  it('summarizes only what has been reviewed', () => {
    let deck: HifzDeck = {};
    deck = applyEvidence(deck, [evidence({ ayah: 1 }), evidence({ ayah: 2, missedWords: 6 })], T0).deck;
    deck['50'] = newCard(50, T0);
    const summary = summarize(deck, T0 + 2 * DAY);
    expect(summary.tracked).toBe(2);
    expect(summary.due).toBeGreaterThanOrEqual(1);
    expect(summary.averageStrength).toBeGreaterThan(0);
    expect(summary.averageStrength).toBeLessThanOrEqual(1);
  });

  it('groups the queue into contiguous passages, not a shuffle', () => {
    const due = [12, 10, 11, 40, 41, 80].map((ayah) => ({
      ayah,
      card: newCard(ayah, T0),
      overdueDays: 1,
      strength: 0.2,
    }));
    expect(contiguousRuns(due)).toEqual([
      { from: 10, to: 12 },
      { from: 40, to: 41 },
      { from: 80, to: 80 },
    ]);
  });
});

describe('confusion profile', () => {
  const rec = (expected: string, heardInstead: string, word = 1): MistakeRecord => ({
    word,
    expected,
    heardInstead,
  });

  it('records nothing heard as an omission', () => {
    const events = analyseMistake(rec('العالمين', ''));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('omission');
  });

  it('refuses to attribute letter blame when the words are unrelated', () => {
    // heardInstead is a heuristic; blaming letters here would invent findings
    const events = analyseMistake(rec('المستقيم', 'الكتاب'));
    expect(events.map((e) => e.kind)).toEqual(['unrelated']);
  });

  it('names a same-class substitution as likely the recognizer, not the reciter', () => {
    const events = analyseMistake(rec('الضالين', 'الظالين'));
    const sub = events.find((e) => e.kind === 'substitution');
    expect(sub).toBeDefined();
    expect(sub?.expected).toBe('ض');
    expect(sub?.heard).toBe('ظ');
    expect(sub?.likelyRecognizer).toBe(true);
  });

  it('treats a lost long vowel as a madd pattern', () => {
    const events = analyseMistake(rec('نستعين', 'نستعن'));
    expect(events.some((e) => e.kind === 'madd' && e.expected === 'ي')).toBe(true);
  });

  it('aggregates repeated patterns and reports the recognizer share', () => {
    const profile = buildProfile([
      rec('الضالين', 'الظالين', 28),
      rec('الضحى', 'الظحى', 100),
      rec('يضل', 'يظل', 200),
      rec('المستقيم', 'الكتاب', 19),
    ]);
    const sub = profile.patterns.find((p) => p.id === 'sub:ض>ظ');
    expect(sub?.count).toBe(3);
    expect(sub?.words).toEqual([28, 100, 200]);
    expect(profile.unattributed).toBe(1);
    expect(profile.recognizerShare).toBeGreaterThan(0.5);
  });

  it('only surfaces a pattern once it has been seen enough times', () => {
    const twice = buildProfile([rec('الضالين', 'الظالين', 1), rec('يضل', 'يظل', 2)]);
    expect(actionablePatterns(twice)).toEqual([]);

    const thrice = buildProfile([
      rec('الضالين', 'الظالين', 1),
      rec('يضل', 'يظل', 2),
      rec('الضحى', 'الظحى', 3),
    ]);
    const surfaced = actionablePatterns(thrice);
    expect(surfaced).toHaveLength(1);
    expect(surfaced[0].pattern.count).toBeGreaterThanOrEqual(MIN_PATTERN_COUNT);
    expect(surfaced[0].advice).toContain('recognizer');
  });

  it('does not blame the recognizer for a cross-class substitution', () => {
    // ر and م are in no shared class, so this is a real articulation signal
    const events = analyseMistake(rec('كرم', 'كمم'));
    const sub = events.find((e) => e.kind === 'substitution');
    expect(sub?.likelyRecognizer).toBe(false);
  });

  it('handles an empty history', () => {
    const profile = buildProfile([]);
    expect(profile.patterns).toEqual([]);
    expect(profile.recognizerShare).toBe(0);
    expect(actionablePatterns(profile)).toEqual([]);
  });
});

describe('collecting evidence from a session', () => {
  // a toy Quran: 3 ayahs of 4 words each
  const globalAyahOf = (w: number): number => Math.floor(w / 4);
  const ayahWordCount = (): number => 4;

  it('groups words by ayah and counts each signal', () => {
    const out = collectEvidence({
      matched: new Set([0, 1, 2, 3, 4, 5]),
      missed: [6],
      hinted: new Set([1, 5]),
      revealed: new Set([5]),
      globalAyahOf,
      ayahWordCount,
    });
    expect(out).toEqual([
      { ayah: 0, totalWords: 4, recitedWords: 4, missedWords: 0, hintedWords: 1, revealedWords: 0 },
      { ayah: 1, totalWords: 4, recitedWords: 2, missedWords: 1, hintedWords: 1, revealedWords: 1 },
    ]);
  });

  it('ignores an ayah only brushed past on the way through', () => {
    // one word of ayah 2 is 25% coverage: not evidence, and must not be graded
    // as a failure just because the reciter stopped there
    const out = collectEvidence({
      matched: new Set([0, 1, 2, 3, 8]),
      missed: [],
      hinted: new Set(),
      revealed: new Set(),
      globalAyahOf,
      ayahWordCount,
    });
    expect(out.map((e) => e.ayah)).toEqual([0]);
  });

  it('never reports more words than the ayah has', () => {
    const out = collectEvidence({
      matched: new Set([0, 1, 2, 3]),
      missed: [0, 1, 2, 3],
      hinted: new Set([0, 1, 2, 3]),
      revealed: new Set([0, 1, 2, 3]),
      globalAyahOf,
      ayahWordCount,
    });
    expect(out[0].missedWords).toBeLessThanOrEqual(4);
    expect(out[0].hintedWords).toBeLessThanOrEqual(4);
  });

  it('returns nothing for an untouched session', () => {
    expect(
      collectEvidence({
        matched: new Set(),
        missed: [],
        hinted: new Set(),
        revealed: new Set(),
        globalAyahOf,
        ayahWordCount,
      }),
    ).toEqual([]);
  });
});
