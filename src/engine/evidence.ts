/**
 * Turning a finished session into per-ayah evidence for the hifz scheduler.
 *
 * Kept data-agnostic on purpose: it takes the two accessors it needs rather
 * than importing the bundled Quran, so it stays a pure function over sets and
 * is testable without loading 77k words.
 */
import type { AyahEvidence } from './hifz';

export interface EvidenceInput {
  /** words matched during the session */
  matched: ReadonlySet<number>;
  /** words flagged as missed */
  missed: readonly number[];
  /** words that needed any hint */
  hinted: ReadonlySet<number>;
  /** words revealed outright (hint level 2) */
  revealed: ReadonlySet<number>;
  /** global word index -> global ayah index */
  globalAyahOf: (wordIndex: number) => number;
  /** global ayah index -> how many words the ayah has */
  ayahWordCount: (globalAyah: number) => number;
  /**
   * Minimum share of an ayah that must have been touched before it counts as
   * evidence at all. Reciting two words of an ayah on the way past should not
   * schedule it, and definitely should not grade it as a failure.
   */
  minCoverage?: number;
}

export const DEFAULT_MIN_COVERAGE = 0.5;

export function collectEvidence(input: EvidenceInput): AyahEvidence[] {
  const minCoverage = input.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const byAyah = new Map<number, { recited: number; missed: number; hinted: number; revealed: number }>();

  const bucket = (ayah: number) => {
    let b = byAyah.get(ayah);
    if (b === undefined) {
      b = { recited: 0, missed: 0, hinted: 0, revealed: 0 };
      byAyah.set(ayah, b);
    }
    return b;
  };

  for (const word of input.matched) bucket(input.globalAyahOf(word)).recited++;
  for (const word of input.missed) bucket(input.globalAyahOf(word)).missed++;
  for (const word of input.hinted) bucket(input.globalAyahOf(word)).hinted++;
  for (const word of input.revealed) bucket(input.globalAyahOf(word)).revealed++;

  const out: AyahEvidence[] = [];
  for (const [ayah, b] of byAyah) {
    const totalWords = Math.max(1, input.ayahWordCount(ayah));
    const touched = b.recited + b.missed;
    if (touched / totalWords < minCoverage) continue;
    out.push({
      ayah,
      totalWords,
      recitedWords: Math.min(b.recited, totalWords),
      missedWords: Math.min(b.missed, totalWords),
      hintedWords: Math.min(b.hinted, totalWords),
      revealedWords: Math.min(b.revealed, totalWords),
    });
  }
  out.sort((a, b) => a.ayah - b.ayah);
  return out;
}
