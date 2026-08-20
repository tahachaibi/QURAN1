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
 * Pure and clock-free: every entry point takes `now`, so the whole thing is
 * deterministic under test.
 */

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
}

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
  };
}

/** Apply one review to a card. Pure — returns a new card. */
export function review(card: HifzCard, grade: number, now: number): HifzCard {
  const g = Math.max(0, Math.min(5, Math.round(grade)));
  const passed = g >= PASS_GRADE;

  let repetitions: number;
  let intervalDays: number;
  if (passed) {
    repetitions = card.repetitions + 1;
    if (repetitions === 1) intervalDays = 1;
    // SM-2 jumps to 6 days here; for hifz that is too long a gap this early
    else if (repetitions === 2) intervalDays = 3;
    else intervalDays = Math.round(card.intervalDays * card.easiness);
    intervalDays = Math.max(1, Math.min(MAX_INTERVAL_DAYS, intervalDays));
  } else {
    repetitions = 0;
    intervalDays = 1; // relearn tomorrow
  }

  const delta = 0.1 - (5 - g) * (0.08 + (5 - g) * 0.02);
  const easiness = Math.max(MIN_EASINESS, card.easiness + delta);

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
    next[key] = review(card, grade, now);
    graded.push({ ayah: e.ayah, grade });
  }
  return { deck: next, graded };
}

/**
 * Strength of an ayah, 0..1, for the Quran-wide hifz map.
 *
 * Combines how well it was last recalled with how long it has been decaying:
 * an ayah graded 5 a week before its due date is strong; the same ayah two
 * weeks overdue is not.
 */
export function strengthOf(card: HifzCard, now: number): number {
  if (card.reviews === 0) return 0;
  const gradeTerm = card.lastGrade / 5;
  const span = Math.max(1, card.intervalDays) * DAY_MS;
  const overdue = Math.max(0, now - card.dueAt);
  const decay = Math.max(0, 1 - overdue / (span * 2));
  const reliability = Math.min(1, card.repetitions / 4);
  return Math.max(0, Math.min(1, gradeTerm * (0.45 + 0.35 * decay + 0.2 * reliability)));
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
}

export function summarize(deck: HifzDeck, now: number): HifzSummary {
  let tracked = 0;
  let due = 0;
  let weak = 0;
  let solid = 0;
  let total = 0;
  for (const card of Object.values(deck)) {
    if (card.reviews === 0) continue;
    tracked++;
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
