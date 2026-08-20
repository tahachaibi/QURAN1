/**
 * Alignment behaviour against the real bundled Quran (spec §5.3–§5.5, §9).
 *
 * These are the engine-level equivalents of acceptance tests 3, 4, 5 and 6.
 * They cannot prove anything about microphone behaviour on a device, but they
 * do prove the cursor arithmetic those tests depend on.
 */
import { align, lookAheadFor, LOOK_AHEAD_SEEKING, LOOK_AHEAD_LOCKED } from '../src/engine/align';
import { localize } from '../src/engine/localize';
import { words, wordIndexOf, surahOf, TOTAL_WORDS } from '../src/data/quran';
import { normalizeHeard } from '../src/engine/normalize';

/** Words as a reciter would say them, from the canonical array. */
const say = (from: number, count: number): string[] => words.slice(from, from + count);

const FATIHA_START = 0;
const AYAH_2_6 = wordIndexOf(2, 6);
const SURAH_2_START = wordIndexOf(2, 1);

describe('the global cursor is a single index into the whole Quran (§2)', () => {
  it('addresses Al-Fatiha at 0 and stays inside the array', () => {
    expect(FATIHA_START).toBe(0);
    expect(words.length).toBe(TOTAL_WORDS);
    expect(surahOf(0)).toBe(1);
    expect(surahOf(SURAH_2_START)).toBe(2);
    expect(surahOf(TOTAL_WORDS - 1)).toBe(114);
  });

  it('crosses a surah boundary by plain increment, with no special case', () => {
    const lastOfFatiha = SURAH_2_START - 1;
    expect(surahOf(lastOfFatiha)).toBe(1);
    expect(surahOf(lastOfFatiha + 1)).toBe(2);
  });
});

describe('align() is idempotent over growing partials (§5.4)', () => {
  const heard = say(4, 8); // الحمد لله رب العلمين الرحمن الرحيم ملك يوم

  it('gives byte-identical results for identical input', () => {
    const a = align({ words, startCursor: 4, heard, lookAhead: LOOK_AHEAD_LOCKED });
    const b = align({ words, startCursor: 4, heard, lookAhead: LOOK_AHEAD_LOCKED });
    expect(a).toEqual(b);
  });

  it('never regresses the cursor as a partial grows from the same startCursor', () => {
    let prev = 4;
    for (let n = 1; n <= heard.length; n++) {
      const r = align({ words, startCursor: 4, heard: heard.slice(0, n), lookAhead: LOOK_AHEAD_LOCKED });
      expect(r.cursor).toBeGreaterThanOrEqual(prev);
      prev = r.cursor;
    }
    expect(prev).toBe(4 + heard.length);
  });

  it('accumulates no state: replaying the full partial sequence lands identically', () => {
    const once = align({ words, startCursor: 4, heard, lookAhead: LOOK_AHEAD_LOCKED });
    for (let n = 1; n <= heard.length; n++) {
      align({ words, startCursor: 4, heard: heard.slice(0, n), lookAhead: LOOK_AHEAD_LOCKED });
    }
    const again = align({ words, startCursor: 4, heard, lookAhead: LOOK_AHEAD_LOCKED });
    expect(again).toEqual(once);
  });
});

describe('straight recitation of Al-Fatiha (acceptance test 1, engine level)', () => {
  it('advances one word per word with zero skips', () => {
    const heard = say(0, 29);
    const r = align({ words, startCursor: 0, heard, lookAhead: LOOK_AHEAD_LOCKED });
    expect(r.progress).toBe(29);
    expect(r.skipped).toEqual([]);
    expect(r.unmatchedHeard).toEqual([]);
    expect(r.cursor).toBe(29);
  });

  it('survives realistic recognizer output for Al-Fatiha with no skipped words', () => {
    // plene madd, ص/س, ق/ك and detached-article artefacts, all real ASR habits
    const transcript =
      'بسم الله الرحمن الرحيم الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين ' +
      'اياك نعبد واياك نستعين اهدنا الصراط المستكيم صراط الذين انعمت عليهم ' +
      'غير المغضوب عليهم ولا الضالين';
    const heard = normalizeHeard(transcript);
    const r = align({ words, startCursor: 0, heard, lookAhead: LOOK_AHEAD_LOCKED });
    expect(r.skipped).toEqual([]);
    expect(r.unmatchedHeard).toEqual([]);
    expect(r.cursor).toBe(29);
  });

  it('does not confuse الرحمن with الرحيم when they are adjacent (1:1, 1:3)', () => {
    // 8=الرحمن 9=الرحيم; feeding only الرحيم from cursor 8 must land on 9
    const r = align({ words, startCursor: 8, heard: ['الرحيم'], lookAhead: LOOK_AHEAD_LOCKED });
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].word).toBe(9);
    expect(r.skipped).toEqual([8]);
  });
});

describe('breath restart: two positions, never one (§5.3, acceptance test 3)', () => {
  it('follows livePos backwards while cursor holds its ground', () => {
    // reciter reached word 20 (المستقيم), pauses, resumes from word 13 (اياك)
    const heard = say(13, 6); // اياك نعبد واياك نستعين اهدنا الصرط
    const r = align({ words, startCursor: 20, heard, lookAhead: LOOK_AHEAD_LOCKED });
    expect(r.anchor).toBe(13);
    expect(r.livePos).toBe(19);
    expect(r.livePos).toBeLessThan(20);
    // cursor is furthest progress and NEVER decreases
    expect(r.cursor).toBe(20);
  });

  it('does not re-anchor further back than the backtrack window', () => {
    const heard = say(2, 4);
    const r = align({ words, startCursor: 60, heard, lookAhead: LOOK_AHEAD_LOCKED, backtrack: 24 });
    expect(r.anchor).toBeGreaterThanOrEqual(36);
  });

  it('re-anchors only on a word of length >= 3', () => {
    // 'لا' (length 2) appears constantly; it must not drag the anchor backwards
    const r = align({ words, startCursor: 100, heard: ['لا'], lookAhead: LOOK_AHEAD_LOCKED });
    expect(r.anchor).toBe(100);
  });
});

describe('junk anchor rejection (§5.4)', () => {
  it('a one-word fuzzy hit makes no forward progress worth locking on', () => {
    const r = align({ words, startCursor: 0, heard: ['رب'], lookAhead: LOOK_AHEAD_SEEKING });
    expect(r.progress).toBeLessThan(3);
  });

  it('look-ahead widens only while not locked on', () => {
    expect(lookAheadFor(true)).toBe(LOOK_AHEAD_LOCKED);
    expect(lookAheadFor(false)).toBe(LOOK_AHEAD_SEEKING);
    // a word 6 ahead is reachable while seeking, not while locked on
    const seeking = align({ words, startCursor: 0, heard: [words[6]], lookAhead: LOOK_AHEAD_SEEKING });
    const locked = align({ words, startCursor: 0, heard: [words[6]], lookAhead: LOOK_AHEAD_LOCKED });
    expect(seeking.progress).toBe(1);
    expect(locked.progress).toBe(0);
  });
});

describe('continuous recitation across a surah boundary (acceptance test 6)', () => {
  it('runs from the end of Al-Fatiha into Al-Baqarah with no interruption', () => {
    const heard = say(SURAH_2_START - 4, 10); // last 4 of 1:7 + first 6 of 2:1-2
    const r = align({ words, startCursor: SURAH_2_START - 4, heard, lookAhead: LOOK_AHEAD_LOCKED });
    expect(r.progress).toBe(10);
    expect(r.skipped).toEqual([]);
    expect(surahOf(r.cursor - 1)).toBe(2);
  });
});

describe('continuous global localization (§5.5, acceptance tests 4 and 5)', () => {
  const localScoreOf = (cursor: number, heard: string[]): number =>
    align({ words, startCursor: cursor, heard, lookAhead: LOOK_AHEAD_LOCKED }).score;

  it('lands on 2:6 recited WITHOUT basmala from an Al-Fatiha cursor', () => {
    const heard = normalizeHeard('ان الذين كفروا سواء عليهم انذرتهم');
    const r = localize({
      words,
      cursor: 4,
      livePos: 4,
      heard,
      localScore: localScoreOf(4, heard),
      surahOf,
      viewSurah: 1,
    });
    expect(r.target).toBe(AYAH_2_6);
  });

  it('lands on 2:6 recited WITH basmala, and the basmala anchors nothing', () => {
    const heard = normalizeHeard('بسم الله الرحمن الرحيم ان الذين كفروا سواء عليهم انذرتهم');
    const r = localize({
      words,
      cursor: 4,
      livePos: 4,
      heard,
      localScore: localScoreOf(4, heard),
      surahOf,
      viewSurah: 1,
    });
    expect(r.target).toBe(AYAH_2_6);
  });

  it('credits what was already recited when arriving mid-verse', () => {
    // arrive at 2:6 already four words in, from "سواء عليهم انذرتهم ام لم تنذرهم"
    const heard = normalizeHeard('سواء عليهم انذرتهم ام لم تنذرهم');
    const r = localize({
      words,
      cursor: 4,
      livePos: 4,
      heard,
      localScore: localScoreOf(4, heard),
      surahOf,
      viewSurah: 1,
    });
    expect(r.target).toBe(AYAH_2_6 + 3); // lands on سوا, not on ان
    // and the cursor is advanced PAST the words it just heard
    expect(r.creditedCursor).toBe(AYAH_2_6 + 9);
  });

  it('ignores candidate jumps of <= 6 words', () => {
    const heard = say(4, 5);
    const r = localize({ words, cursor: 0, livePos: 0, heard, localScore: localScoreOf(0, heard), surahOf });
    expect(r.target).toBeNull();
  });

  it('does not jump while the local alignment is doing fine', () => {
    const heard = say(4, 6);
    const local = localScoreOf(4, heard);
    const r = localize({ words, cursor: 4, livePos: 4, heard, localScore: local, surahOf });
    expect(r.target).toBeNull();
  });

  it('refuses to anchor a 3-word phrase that is not unique in the Quran', () => {
    // "وما ادراك ما" style repeats; use a phrase that certainly repeats
    const heard = normalizeHeard('فبأي آلاء ربكما');
    const r = localize({ words, cursor: 0, livePos: 0, heard, localScore: 0, surahOf, tailSize: 3 });
    expect(r.target).toBeNull();
    expect(r.reason).toMatch(/not unique/);
  });

  it('prefers the surah in view when two candidates tie', () => {
    const heard = normalizeHeard('قل هو الله احد');
    const r = localize({ words, cursor: 0, livePos: 0, heard, localScore: 0, surahOf, viewSurah: 112 });
    expect(r.target).not.toBeNull();
    expect(surahOf(r.target as number)).toBe(112);
  });
});
