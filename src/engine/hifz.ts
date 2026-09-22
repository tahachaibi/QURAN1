/**
 * Hifz strength and review scheduling.
 *
 * This is the piece Tarteel does not have. Its memorization mode is a drill you
 * choose; nothing watches which ayahs YOU are actually weak on and decides what
 * you should revise today. We already have the evidence — every session yields,
 * per ayah, which words were recited, which were missed, and which needed a
 * hint — so the scheduler is a small function over data the app is collecting
 * anyway.
 *
 * The unit of scheduling is the AYAH, because that is how people memorize. The
 * unit of evidence is the WORD, because that is what the recognizer gives us.
 *
 * ...except when it gives us nothing. `applyEvidence` used to be the ONLY door
 * into the deck, and it is only ever reached after a session produced matches,
 * so the deck stayed permanently empty for anyone whose phone has no Arabic
 * speech pack (on-device recognition wants API 33; minSdk here is 26), anyone
 * reading silently, anyone on a bus or in a masjid who will not recite into a
 * phone, and everybody at all before their first successful session. For those
 * people the entire coach layer was a blank screen. `applySelfReport` is the
 * second door, and it goes through the same scheduler — but it is labelled all
 * the way down, because a tap is not a recitation and the one thing the coach
 * report is worth anything for is that it reflects what actually happened.
 *
 * Pure and clock-free: every entry point takes `now`, so the whole thing is
 * deterministic under test.
 */

/**
 * What kind of evidence moved a card.
 *
 * `recited` means the recognizer matched words against the expected text.
 * `self-report` means the reciter told us, by tapping "I read this" — real
 * evidence of attention, no evidence at all of recall. The distinction is
 * recorded per card and per review rather than derived later, because once the
 * two are mixed there is no way back: a report that cannot say which ayahs were
 * actually heard is a report of what somebody intended to do.
 */
export type EvidenceSource = 'recited' | 'self-report';

/** SM-2 style record for one ayah, keyed by global ayah index (0..6235). */
export interface HifzCard {
  /** global ayah index */
  ayah: number;
  /** SM-2 easiness factor; 1.3 is "very hard", 2.5 is the starting default */
  easiness: number;
  /** consecutive successful reviews */
  repetitions: number;
  /** current interval in days */
  intervalDays: number;
  /** epoch ms when this ayah is next due */
  dueAt: number;
  /** epoch ms of the last review */
  lastReviewedAt: number;
  /** last grade, 0..5 */
  lastGrade: number;
  /** how many times this ayah has ever been reviewed */
  reviews: number;
  /** how many of those were failures (grade < 3) */
  lapses: number;
  /**
   * What kind of evidence the LAST review was.
   *
   * Optional because decks written before the self-report path existed have no
   * such field, and `loadHifzDeck` hands those straight back. Read it through
   * `sourceOf`, never directly.
   */
  lastSource?: EvidenceSource;
  /**
   * How many of `reviews` were verified recitation.
   *
   * Also optional, and `recitedReviewsOf` resolves an absent value to
   * `reviews` — not to zero. Every review a pre-existing card holds came from
   * the recognizer, because nothing else could write one. Getting that default
   * backwards would relabel every existing user's whole deck as unverified.
   */
  recitedReviews?: number;
}

/** What kind of evidence last moved this card; an old card can only be voice. */
export const sourceOf = (card: HifzCard): EvidenceSource => card.lastSource ?? 'recited';

/** How many of this card's reviews were verified recitation. See `recitedReviews`. */
export const recitedReviewsOf = (card: HifzCard): number =>
  typeof card.recitedReviews === 'number' ? card.recitedReviews : card.reviews;

/** Has a recogniser ever confirmed this ayah, as opposed to the reciter saying so? */
export const isVerified = (card: HifzCard): boolean => recitedReviewsOf(card) > 0;

export type HifzDeck = Record<string, HifzCard>;

/** Evidence gathered for one ayah during one session. */
export interface AyahEvidence {
  /** global ayah index */
  ayah: number;
  /** how many words the ayah has */
  totalWords: number;
  /** words matched during the session */
  recitedWords: number;
  /** words flagged as missed */
  missedWords: number;
  /** words that needed a hint of any level */
  hintedWords: number;
  /** words revealed outright (hint level 2) — a heavier signal than a nudge */
  revealedWords: number;
}

export const DEFAULT_EASINESS = 2.5;
export const MIN_EASINESS = 1.3;
/**
 * Hifz decays differently from vocabulary: an ayah left for a year is gone, so
 * the interval is capped well below where plain SM-2 would take it.
 */
export const MAX_INTERVAL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A grade of 3 or more counts as recall; below that the ayah relearns. */
export const PASS_GRADE = 3;

/**
 * Interval ceiling for a card no recitation has ever verified.
 *
 * A deck filled entirely by taps is a record of reading, which is worth
 * scheduling — that is the whole point of the second door. But it must not drift
 * out to three months on taps alone, because nothing has ever checked that the
 * ayah is in there. Three weeks keeps such a card in circulation until something
 * does. Once one real recitation lands, the normal ceiling applies.
 */
export const UNHEARD_MAX_INTERVAL_DAYS = 21;

/** The two things a person can honestly claim about an ayah without reciting it. */
export type SelfReportKind = 'read' | 'revised';

/**
 * Grades a self-report is allowed to award, and why neither is 5.
 *
 * `read` — eyes on the text, page visible. That is exposure, not recall, so it
 * is the bare pass: enough to enter the schedule and come back, no claim about
 * strength.
 * `revised` — recalled from memory with the text concealed, and the reciter says
 * it went fine. Better evidence, still their own word for it.
 *
 * 5 is reserved for a clean matched recitation and is unreachable from here.
 * `review` additionally refuses to let either of these RAISE easiness, so this
 * table can be argued about without that guarantee depending on the argument.
 */
export const SELF_REPORT_GRADE: Readonly<Record<SelfReportKind, number>> = {
  read: 3,
  revised: 4,
};

/**
 * A self-report cannot move the same card again inside this window.
 *
 * Tapping "I read this page" twice in one sitting is one reading. Without the
 * window each tap walks the card another step up the interval ladder, which is
 * exactly the failure `gradedSessionAt` guards against on the voice path — and
 * it is also what keeps the button from turning into a write per tap.
 */
export const SELF_REPORT_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Ceiling on the strength a card no recitation has verified may report.
 *
 * Strength is what the hifz map colours and what `solid` counts, so leaving it
 * ungated let a "revised" tap paint an ayah as solidly memorised — the exact
 * masquerade the whole source split exists to prevent. Deliberately below the
 * 0.8 `solid` threshold: nothing is called solid on the reciter's own word.
 */
export const UNVERIFIED_STRENGTH_CAP = 0.6;

/**
 * Turn per-word evidence into an SM-2 grade, 0..5.
 *
 * A hint costs more than a slow word and less than a mistake, and an outright
 * reveal costs more than a first-letter nudge — that ladder is the whole reason
 * the hint ladder exists (§6.2), so it has to mean something here.
 */
export function gradeFor(evidence: AyahEvidence): number {
  const total = Math.max(1, evidence.totalWords);
  const coverage = Math.min(1, evidence.recitedWords / total);
  const missed = evidence.missedWords / total;
  const hinted = Math.max(0, evidence.hintedWords - evidence.revealedWords) / total;
  const revealed = evidence.revealedWords / total;

  const score = coverage - 2.0 * missed - 1.0 * hinted - 1.8 * revealed;
  const grade = Math.round(Math.max(0, Math.min(1, score)) * 5);

  // Never award full marks to an ayah that needed help, however short it is.
  if (grade === 5 && (evidence.missedWords > 0 || evidence.hintedWords > 0)) return 4;
  // An ayah barely touched is not evidence of recall.
  if (coverage < 0.5) return Math.min(grade, 1);
  return grade;
}

export function newCard(ayah: number, now: number): HifzCard {
  return {
    ayah,
    easiness: DEFAULT_EASINESS,
    repetitions: 0,
    intervalDays: 0,
    dueAt: now,
    lastReviewedAt: 0,
    lastGrade: 0,
    reviews: 0,
    lapses: 0,
    recitedReviews: 0,
  };
}

/**
 * Apply one review to a card. Pure — returns a new card.
 *
 * `source` defaults to `recited` rather than being required, because every call
 * site that predates the second door is voice evidence and relabelling them all
 * would have been the dangerous edit. Self-reports never arrive here directly:
 * `applySelfReport` is the only way in for them and it always names its source.
 */
export function review(
  card: HifzCard,
  grade: number,
  now: number,
  source: EvidenceSource = 'recited',
): HifzCard {
  const g = Math.max(0, Math.min(5, Math.round(grade)));
  const passed = g >= PASS_GRADE;
  const recitedReviews = recitedReviewsOf(card) + (source === 'recited' ? 1 : 0);

  let repetitions: number;
  let intervalDays: number;
  if (passed) {
    repetitions = card.repetitions + 1;
    if (repetitions === 1) intervalDays = 1;
    // SM-2 jumps to 6 days here; for hifz that is too long a gap this early
    else if (repetitions === 2) intervalDays = 3;
    else intervalDays = Math.round(card.intervalDays * card.easiness);
    const ceiling = recitedReviews > 0 ? MAX_INTERVAL_DAYS : UNHEARD_MAX_INTERVAL_DAYS;
    intervalDays = Math.max(1, Math.min(ceiling, intervalDays));
  } else {
    repetitions = 0;
    intervalDays = 1; // relearn tomorrow
  }

  const delta = 0.1 - (5 - g) * (0.08 + (5 - g) * 0.02);
  /**
   * A self-report may make an ayah HARDER but never easier.
   *
   * Easiness is the multiplier that decides how fast an ayah leaves your life,
   * so raising it on somebody's own say-so is the one move that lets a tap
   * imitate a recitation in the only place the difference is felt. Believing a
   * report that an ayah went badly costs nothing and is probably true;
   * believing one that it went well costs the whole schedule.
   */
  const applied = source === 'recited' ? delta : Math.min(0, delta);
  const easiness = Math.max(MIN_EASINESS, card.easiness + applied);

  return {
    ayah: card.ayah,
    easiness,
    repetitions,
    intervalDays,
    dueAt: now + intervalDays * DAY_MS,
    lastReviewedAt: now,
    lastGrade: g,
    reviews: card.reviews + 1,
    lapses: card.lapses + (passed ? 0 : 1),
    lastSource: source,
    recitedReviews,
  };
}

/** Fold a session's worth of evidence into the deck. Returns a new deck. */
export function applyEvidence(
  deck: HifzDeck,
  evidence: readonly AyahEvidence[],
  now: number,
): { deck: HifzDeck; graded: { ayah: number; grade: number }[] } {
  if (evidence.length === 0) return { deck, graded: [] };
  const next: HifzDeck = { ...deck };
  const graded: { ayah: number; grade: number }[] = [];
  for (const e of evidence) {
    const key = String(e.ayah);
    const card = next[key] ?? newCard(e.ayah, now);
    const grade = gradeFor(e);
    next[key] = review(card, grade, now, 'recited');
    graded.push({ ayah: e.ayah, grade });
  }
  return { deck: next, graded };
}

/**
 * The second door: fold a deliberate "I read this" / "I revised this" into the
 * deck, through the same SM-2 scheduler the voice path uses.
 *
 * Same signature and same return shape as `applyEvidence` on purpose, so the
 * caller does not need to know which door a card came through — but the cards
 * themselves always do (`lastSource`, `recitedReviews`).
 *
 * Ayahs already reviewed inside `SELF_REPORT_COOLDOWN_MS` are skipped and left
 * out of `graded`, so a second tap in the same sitting is a no-op rather than a
 * free step up the ladder. The caller can therefore treat an empty `graded` as
 * "nothing to save" and not write at all.
 */
export function applySelfReport(
  deck: HifzDeck,
  ayahs: readonly number[],
  kind: SelfReportKind,
  now: number,
): { deck: HifzDeck; graded: { ayah: number; grade: number }[] } {
  if (ayahs.length === 0) return { deck, graded: [] };
  const grade = SELF_REPORT_GRADE[kind];
  const graded: { ayah: number; grade: number }[] = [];
  let next: HifzDeck | null = null;
  // A page's ayah list can repeat an ayah across two calls; dedupe within the
  // commit so one tap is one review however the range was assembled.
  for (const ayah of new Set(ayahs)) {
    const key = String(ayah);
    const existing = (next ?? deck)[key];
    // `since >= 0` matters: a stored timestamp in the future (a clock the user
    // moved, or a corrupt value) would otherwise put the card inside its
    // cooldown indefinitely and silently disable the whole button. Degrading
    // towards accepting the commit is the safe direction.
    const since = existing === undefined ? Infinity : now - existing.lastReviewedAt;
    if (existing !== undefined && existing.reviews > 0 && since >= 0 && since < SELF_REPORT_COOLDOWN_MS) {
      continue;
    }
    if (next === null) next = { ...deck };
    next[key] = review(existing ?? newCard(ayah, now), grade, now, 'self-report');
    graded.push({ ayah, grade });
  }
  return next === null ? { deck, graded: [] } : { deck: next, graded };
}

/**
 * Which ayahs a word range is honest evidence for.
 *
 * Data-agnostic like `collectEvidence`: it takes the two accessors it needs
 * rather than importing the bundled Quran, so it stays testable without loading
 * 77k words.
 *
 * The coverage gate is the point. A Madani page begins and ends mid-ayah far
 * more often than not, so "I read page 3" credits ayahs that page shows a few
 * words of unless something stops it — and crediting 2:282 for its last four
 * words is exactly the kind of quiet lie that makes the deck worthless. Same
 * threshold as `DEFAULT_MIN_COVERAGE` in evidence.ts, for the same reason.
 */
export function ayahsInWordRange(input: {
  /** first word, inclusive */
  fromWord: number;
  /** last word, INCLUSIVE — a page's [from, to) needs its end decremented */
  toWord: number;
  globalAyahOf: (word: number) => number;
  /** global ayah index -> its word range, [from, to) */
  ayahWordRange: (globalAyah: number) => readonly [number, number];
  minCoverage?: number;
}): number[] {
  const { fromWord, toWord, globalAyahOf, ayahWordRange } = input;
  if (toWord < fromWord) return [];
  const minCoverage = input.minCoverage ?? 0.5;
  const out: number[] = [];
  const last = globalAyahOf(toWord);
  for (let ayah = globalAyahOf(fromWord); ayah <= last; ayah++) {
    const [start, end] = ayahWordRange(ayah);
    const total = Math.max(1, end - start);
    const inside = Math.min(end - 1, toWord) - Math.max(start, fromWord) + 1;
    if (inside / total >= minCoverage) out.push(ayah);
  }
  return out;
}

/**
 * Strength of an ayah, 0..1, for the Quran-wide hifz map.
 *
 * Combines how well it was last recalled with how long it has been decaying:
 * an ayah graded 5 a week before its due date is strong; the same ayah two
 * weeks overdue is not.
 *
 * Capped for a card nothing has ever heard — see `UNVERIFIED_STRENGTH_CAP`.
 */
export function strengthOf(card: HifzCard, now: number): number {
  if (card.reviews === 0) return 0;
  const gradeTerm = card.lastGrade / 5;
  const span = Math.max(1, card.intervalDays) * DAY_MS;
  const overdue = Math.max(0, now - card.dueAt);
  const decay = Math.max(0, 1 - overdue / (span * 2));
  const reliability = Math.min(1, card.repetitions / 4);
  const ceiling = isVerified(card) ? 1 : UNVERIFIED_STRENGTH_CAP;
  return Math.max(0, Math.min(ceiling, gradeTerm * (0.45 + 0.35 * decay + 0.2 * reliability)));
}

export interface DueAyah {
  ayah: number;
  card: HifzCard;
  /** days overdue; negative means not due yet */
  overdueDays: number;
  strength: number;
}

/**
 * What to revise now, weakest and most overdue first.
 *
 * Ayahs never reviewed are NOT included: "everything you have never recited" is
 * not a review queue, it is the rest of the Quran.
 */
export function dueQueue(deck: HifzDeck, now: number, limit = 20): DueAyah[] {
  const out: DueAyah[] = [];
  for (const card of Object.values(deck)) {
    if (card.reviews === 0) continue;
    if (card.dueAt > now) continue;
    out.push({
      ayah: card.ayah,
      card,
      overdueDays: (now - card.dueAt) / DAY_MS,
      strength: strengthOf(card, now),
    });
  }
  out.sort((a, b) => a.strength - b.strength || b.overdueDays - a.overdueDays || a.ayah - b.ayah);
  return out.slice(0, limit);
}

export interface HifzSummary {
  /** ayahs with at least one review */
  tracked: number;
  /** ayahs due now */
  due: number;
  /** ayahs whose strength is below 0.5 */
  weak: number;
  /** ayahs whose strength is at least 0.8 */
  solid: number;
  /** mean strength across tracked ayahs, 0..1 */
  averageStrength: number;
  /**
   * Tracked ayahs a recogniser has actually confirmed at least once.
   *
   * Reported separately, and never folded into `tracked`, so the coach can say
   * out loud how much of its own schedule rests on the reciter's word. A paid
   * report that cannot make that distinction is not worth paying for.
   */
  verified: number;
}

export function summarize(deck: HifzDeck, now: number): HifzSummary {
  let tracked = 0;
  let due = 0;
  let weak = 0;
  let solid = 0;
  let total = 0;
  let verified = 0;
  for (const card of Object.values(deck)) {
    if (card.reviews === 0) continue;
    tracked++;
    if (isVerified(card)) verified++;
    const s = strengthOf(card, now);
    total += s;
    if (card.dueAt <= now) due++;
    if (s < 0.5) weak++;
    if (s >= 0.8) solid++;
  }
  return {
    tracked,
    due,
    weak,
    solid,
    averageStrength: tracked === 0 ? 0 : total / tracked,
    verified,
  };
}

/**
 * Group a due queue into contiguous ayah runs, so a practice session is a
 * continuous passage rather than a shuffle. Reciting 2:6, 2:7, 2:8 as one run
 * is how the passage actually lives in memory; drilling them out of order is
 * not the same exercise.
 */
export function contiguousRuns(due: readonly DueAyah[], maxGap = 1): { from: number; to: number }[] {
  if (due.length === 0) return [];
  const sorted = [...due].map((d) => d.ayah).sort((a, b) => a - b);
  const runs: { from: number; to: number }[] = [];
  let from = sorted[0];
  let to = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - to <= maxGap) {
      to = sorted[i];
      continue;
    }
    runs.push({ from, to });
    from = sorted[i];
    to = sorted[i];
  }
  runs.push({ from, to });
  return runs;
}
