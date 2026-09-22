/**
 * The second door into the hifz deck, and the wall beside it.
 *
 * THE REGRESSION THESE PIN: `applyEvidence` had exactly one call site in the
 * whole app, reached only after a recitation session produced matches, so the
 * deck stayed permanently empty for anyone whose phone has no Arabic speech
 * pack, anyone reading silently, anyone who will not recite aloud in a masjid
 * or on a bus, and everybody before their first successful session.
 * `applySelfReport` is the way in for them.
 *
 * The other half of these tests is the wall. A self-report is a person's word,
 * not evidence, and the only thing the coach layer is worth anything for is
 * that it reports what actually happened — so a tap must never be able to come
 * out the far end looking like a matched recitation. Every route by which it
 * could (the grade, the easiness multiplier, the interval ceiling, the strength
 * the map colours, the summary's counts) gets its own test, because each one
 * individually would look like a rounding detail to a future change.
 */
import {
  applyEvidence,
  applySelfReport,
  ayahsInWordRange,
  DEFAULT_EASINESS,
  isVerified,
  MAX_INTERVAL_DAYS,
  newCard,
  recitedReviewsOf,
  review,
  SELF_REPORT_COOLDOWN_MS,
  SELF_REPORT_GRADE,
  sourceOf,
  strengthOf,
  summarize,
  UNHEARD_MAX_INTERVAL_DAYS,
  UNVERIFIED_STRENGTH_CAP,
  type AyahEvidence,
  type HifzCard,
  type HifzDeck,
} from '../src/engine/hifz';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000; // fixed clock: scheduling must be deterministic

const cleanRecitation = (ayah: number): AyahEvidence => ({
  ayah,
  totalWords: 10,
  recitedWords: 10,
  missedWords: 0,
  hintedWords: 0,
  revealedWords: 0,
});

/** Walk a card forward by repeated self-reports, respecting the cooldown. */
function tapRepeatedly(kind: 'read' | 'revised', times: number, start = T0): HifzCard {
  let deck: HifzDeck = {};
  let now = start;
  for (let i = 0; i < times; i++) {
    deck = applySelfReport(deck, [1], kind, now).deck;
    // next review, but never inside the cooldown
    now = Math.max(deck['1'].dueAt, now + SELF_REPORT_COOLDOWN_MS + 1);
  }
  return deck['1'];
}

describe('a deck that can fill without speech recognition', () => {
  it('creates a card for an ayah nothing has ever been heard reciting', () => {
    const { deck, graded } = applySelfReport({}, [5, 6], 'read', T0);
    expect(Object.keys(deck).sort()).toEqual(['5', '6']);
    expect(graded).toEqual([
      { ayah: 5, grade: SELF_REPORT_GRADE.read },
      { ayah: 6, grade: SELF_REPORT_GRADE.read },
    ]);
    // ...and it is a real schedule, not a placeholder: it comes back.
    expect(deck['5'].dueAt).toBeGreaterThan(T0);
    expect(deck['5'].reviews).toBe(1);
  });

  it('goes through the same SM-2 scheduler the voice path uses', () => {
    const byHand = applySelfReport({}, [1], 'revised', T0).deck['1'];
    const byVoice = review(newCard(1, T0), SELF_REPORT_GRADE.revised, T0, 'recited');
    // same grade in, same interval and repetition ladder out; the difference is
    // the labelling and the ceilings, not a parallel implementation
    expect(byHand.intervalDays).toBe(byVoice.intervalDays);
    expect(byHand.repetitions).toBe(byVoice.repetitions);
  });

  it('carries a self-reported ayah into the due queue like any other', () => {
    const deck = applySelfReport({}, [42], 'read', T0).deck;
    expect(summarize(deck, T0).tracked).toBe(1);
    expect(summarize(deck, T0 + 10 * DAY).due).toBe(1);
  });

  it('returns the deck untouched when there is nothing to commit', () => {
    const deck: HifzDeck = {};
    expect(applySelfReport(deck, [], 'read', T0).deck).toBe(deck);
  });
});

describe('a self-report can never masquerade as a verified recitation', () => {
  it('labels the card, and keeps the count of what was actually heard at zero', () => {
    const card = applySelfReport({}, [1], 'revised', T0).deck['1'];
    expect(sourceOf(card)).toBe('self-report');
    expect(recitedReviewsOf(card)).toBe(0);
    expect(isVerified(card)).toBe(false);
  });

  it('stays unverified however many times it is tapped', () => {
    const card = tapRepeatedly('revised', 12);
    expect(card.reviews).toBe(12);
    expect(recitedReviewsOf(card)).toBe(0);
    expect(isVerified(card)).toBe(false);
  });

  it('is counted apart in the summary, so the report can say so out loud', () => {
    let deck = applySelfReport({}, [1, 2], 'read', T0).deck;
    deck = applyEvidence(deck, [cleanRecitation(3)], T0).deck;
    const summary = summarize(deck, T0);
    expect(summary.tracked).toBe(3);
    expect(summary.verified).toBe(1);
  });

  it('never awards the grade a clean recitation earns', () => {
    const recited = applyEvidence({}, [cleanRecitation(1)], T0).graded[0].grade;
    expect(recited).toBe(5);
    for (const kind of ['read', 'revised'] as const) {
      expect(SELF_REPORT_GRADE[kind]).toBeLessThan(recited);
    }
    // reading is weaker evidence than revising from memory, and both are weaker
    // than being heard
    expect(SELF_REPORT_GRADE.read).toBeLessThan(SELF_REPORT_GRADE.revised);
  });

  it('may make an ayah harder but never easier', () => {
    // easiness is the multiplier that decides how fast an ayah leaves your life,
    // so this is the one place a tap could imitate a recitation invisibly
    const tapped = tapRepeatedly('revised', 8);
    expect(tapped.easiness).toBeLessThanOrEqual(DEFAULT_EASINESS);

    let recited = newCard(2, T0);
    let now = T0;
    for (let i = 0; i < 8; i++) {
      recited = review(recited, 5, now, 'recited');
      now = recited.dueAt;
    }
    expect(recited.easiness).toBeGreaterThan(DEFAULT_EASINESS);

    // and a report that it went BADLY is believed, because believing that costs
    // nothing and is probably true
    const hard = review(newCard(3, T0), 1, T0, 'self-report');
    expect(hard.easiness).toBeLessThan(DEFAULT_EASINESS);

    // The clamp is on the SOURCE, not on the grade table above it. Pinned
    // separately because SELF_REPORT_GRADE is a judgement somebody will want to
    // argue with, and the guarantee must not depend on the argument: even a
    // perfect grade arriving as a self-report may not raise easiness.
    expect(review(newCard(4, T0), 5, T0, 'self-report').easiness).toBe(DEFAULT_EASINESS);
    expect(review(newCard(4, T0), 5, T0, 'recited').easiness).toBeGreaterThan(DEFAULT_EASINESS);
  });

  it('cannot push an ayah nothing has heard out to the full interval ceiling', () => {
    const tapped = tapRepeatedly('revised', 20);
    expect(tapped.intervalDays).toBeLessThanOrEqual(UNHEARD_MAX_INTERVAL_DAYS);
    expect(UNHEARD_MAX_INTERVAL_DAYS).toBeLessThan(MAX_INTERVAL_DAYS);
  });

  it('cannot colour an ayah as solidly memorised', () => {
    // strength is what the hifz map paints and what `solid` counts
    const tapped = tapRepeatedly('revised', 6);
    const strength = strengthOf(tapped, tapped.lastReviewedAt);
    expect(strength).toBeLessThanOrEqual(UNVERIFIED_STRENGTH_CAP);
    expect(UNVERIFIED_STRENGTH_CAP).toBeLessThan(0.8); // the `solid` threshold
    expect(summarize({ '1': tapped }, tapped.lastReviewedAt).solid).toBe(0);
  });
});

describe('what one real recitation does to a self-reported card', () => {
  it('promotes it, and hands back the full interval ceiling', () => {
    const tapped = applySelfReport({}, [1], 'revised', T0).deck['1'];
    const heard = review(tapped, 5, T0 + DAY, 'recited');
    expect(isVerified(heard)).toBe(true);
    expect(sourceOf(heard)).toBe('recited');
    expect(recitedReviewsOf(heard)).toBe(1);

    let card = heard;
    let now = T0 + DAY;
    for (let i = 0; i < 30; i++) {
      card = review(card, 5, now, 'recited');
      now = card.dueAt;
    }
    expect(card.intervalDays).toBe(MAX_INTERVAL_DAYS);
  });

  it('does not un-verify it when the reciter later only taps', () => {
    let card = review(newCard(1, T0), 5, T0, 'recited');
    card = review(card, SELF_REPORT_GRADE.read, T0 + 5 * DAY, 'self-report');
    expect(sourceOf(card)).toBe('self-report'); // the LAST review was a tap
    expect(isVerified(card)).toBe(true); // but it has been heard, once, ever
    expect(recitedReviewsOf(card)).toBe(1);
  });
});

describe('a deck written before any of this existed', () => {
  /**
   * `loadHifzDeck` hands stored cards straight back, so cards with neither new
   * field are the normal case on every upgrade. Nothing but the recogniser
   * could have written one, so their reviews are all verified — defaulting the
   * other way would relabel every existing user's whole deck as unverified.
   */
  const legacy = (): HifzCard => {
    const card = applyEvidence({}, [cleanRecitation(1)], T0).deck['1'];
    const { lastSource, recitedReviews, ...withoutTheNewFields } = card;
    return withoutTheNewFields as HifzCard;
  };

  it('reads as verified recitation, not as taps', () => {
    const card = legacy();
    expect(card.recitedReviews).toBeUndefined();
    expect(recitedReviewsOf(card)).toBe(card.reviews);
    expect(isVerified(card)).toBe(true);
    expect(sourceOf(card)).toBe('recited');
  });

  it('keeps its strength and its interval ceiling', () => {
    const card = legacy();
    expect(strengthOf(card, T0)).toBeGreaterThan(UNVERIFIED_STRENGTH_CAP);
    expect(summarize({ '1': card }, T0).verified).toBe(1);
  });
});

describe('one tap is one review', () => {
  it('ignores a second commit of the same ayah inside the cooldown', () => {
    const first = applySelfReport({}, [1], 'read', T0);
    const second = applySelfReport(first.deck, [1], 'read', T0 + SELF_REPORT_COOLDOWN_MS - 1);
    expect(second.graded).toEqual([]);
    // the deck is handed back by identity, so the caller can skip the write
    expect(second.deck).toBe(first.deck);
    expect(second.deck['1'].reviews).toBe(1);
  });

  it('accepts it again once the sitting is over', () => {
    const first = applySelfReport({}, [1], 'read', T0);
    const later = applySelfReport(first.deck, [1], 'read', T0 + SELF_REPORT_COOLDOWN_MS + 1);
    expect(later.graded).toHaveLength(1);
    expect(later.deck['1'].reviews).toBe(2);
  });

  it('commits a repeated ayah in one range only once', () => {
    const { deck, graded } = applySelfReport({}, [7, 7, 7], 'read', T0);
    expect(graded).toHaveLength(1);
    expect(deck['7'].reviews).toBe(1);
  });

  it('still commits the ayahs that are outside the cooldown', () => {
    const first = applySelfReport({}, [1], 'read', T0);
    const second = applySelfReport(first.deck, [1, 2], 'read', T0 + 60_000);
    expect(second.graded.map((g) => g.ayah)).toEqual([2]);
  });
});

describe('which ayahs a word range is honest evidence for', () => {
  // toy Quran: ayahs of 4 words each
  const globalAyahOf = (w: number): number => Math.floor(w / 4);
  const ayahWordRange = (a: number): readonly [number, number] => [a * 4, a * 4 + 4];
  const inRange = (fromWord: number, toWord: number): number[] =>
    ayahsInWordRange({ fromWord, toWord, globalAyahOf, ayahWordRange });

  it('credits the ayahs a whole page holds', () => {
    expect(inRange(0, 11)).toEqual([0, 1, 2]);
  });

  it('refuses an ayah the page only shows the tail of', () => {
    // A Madani page begins and ends mid-ayah more often than not. Crediting
    // 2:282 for the four words that happen to fall on the page is exactly the
    // quiet lie that makes a revision schedule worthless.
    expect(inRange(3, 11)).toEqual([1, 2]);
    expect(inRange(0, 8)).toEqual([0, 1]);
  });

  it('treats the last word as inclusive', () => {
    expect(inRange(0, 3)).toEqual([0]);
    expect(inRange(0, 2)).toEqual([0]); // 3 of 4 words is still most of it
  });

  it('returns nothing for an empty or inverted range', () => {
    expect(inRange(8, 7)).toEqual([]);
  });
});
