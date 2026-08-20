/**
 * Session-level behaviour through the replay harness (spec §9).
 *
 * These are the engine-level stand-ins for acceptance tests 1, 3, 4, 5, 6 and 8.
 * They assert cursor paths and mistake sets, which is exactly what those tests
 * check on a device — minus the microphone, which no CI can supply.
 */
import { replay, syntheticFixture, type ReplayFixture } from '../src/engine/replay';
import { initialSession, sessionReducer, type SessionConfig } from '../src/engine/session';
import { words, wordIndexOf, surahOf } from '../src/data/quran';
import { vocabulary } from '../src/engine/searchIndex';

const config: SessionConfig = {
  words,
  surahOf,
  vocabulary: vocabulary(),
  floor: 0,
  limit: words.length,
  viewSurah: 1,
};

const AYAH_2_6 = wordIndexOf(2, 6);
const SURAH_2 = wordIndexOf(2, 1);

/** Al-Fatiha as Android's ar-SA recognizer actually renders it. */
const FATIHA_UTTERANCES = [
  ['بسم', 'الله', 'الرحمن', 'الرحيم'],
  ['الحمد', 'لله', 'رب', 'العالمين'],
  ['الرحمن', 'الرحيم'],
  ['مالك', 'يوم', 'الدين'],
  ['اياك', 'نعبد', 'واياك', 'نستعين'],
  ['اهدنا', 'الصراط', 'المستقيم'],
  ['صراط', 'الذين', 'انعمت', 'عليهم'],
  ['غير', 'المغضوب', 'عليهم', 'ولا', 'الضالين'],
];

describe('Al-Fatiha end to end (acceptance test 1, engine level)', () => {
  const fixture = syntheticFixture('fatiha-follow', 0, FATIHA_UTTERANCES);

  it('reaches the end of the surah with zero mistakes', () => {
    const out = replay(fixture, config);
    expect(out.final.cursor).toBe(29);
    expect(out.mistakes).toEqual([]);
    expect(out.final.matched.size).toBe(29);
  });

  it('never moves the cursor backwards', () => {
    const out = replay(fixture, config);
    for (let i = 1; i < out.cursorPath.length; i++) {
      expect(out.cursorPath[i]).toBeGreaterThanOrEqual(out.cursorPath[i - 1]);
    }
  });

  it('locks on after three words of forward progress', () => {
    const out = replay(fixture, config);
    const firstLocked = out.frames.findIndex((f) => f.lockedOn);
    expect(firstLocked).toBeGreaterThanOrEqual(2);
    expect(out.frames[firstLocked].cursor).toBeGreaterThanOrEqual(3);
  });

  it('records the longest clean run', () => {
    const out = replay(fixture, config);
    expect(out.final.longestCleanRun).toBe(29);
  });
});

describe('breath restart mid-verse (acceptance test 3)', () => {
  it('follows livePos back without un-revealing anything or logging a mistake', () => {
    const fixture: ReplayFixture = {
      name: 'breath-restart',
      startCursor: 0,
      synthetic: true,
      events: [
        // ... اياك نعبد واياك نستعين اهدنا
        { kind: 'partial', alternatives: ['اياك نعبد واياك'] },
        { kind: 'final', alternatives: ['اياك نعبد واياك نستعين اهدنا'] },
        { kind: 'segment' },
        // breath, then resume from a few words earlier
        { kind: 'partial', alternatives: ['واياك نستعين'], dt: 2200 },
        { kind: 'partial', alternatives: ['واياك نستعين اهدنا'] },
        { kind: 'final', alternatives: ['واياك نستعين اهدنا الصراط المستقيم'] },
      ],
    };
    const out = replay(fixture, config);
    const afterFirst = out.frames[1];
    const duringRestart = out.frames[3];

    expect(afterFirst.cursor).toBe(18); // through اهدنا
    // livePos followed the voice backwards ...
    expect(duringRestart.livePos).toBeLessThan(afterFirst.cursor);
    // ... while the cursor held its ground: nothing gets un-revealed
    expect(duringRestart.cursor).toBe(afterFirst.cursor);
    // and replaying earlier words is not a mistake
    expect(out.mistakes).toEqual([]);
    expect(out.final.cursor).toBe(20);
  });
});

describe('arriving in another surah mid-verse (acceptance tests 4 and 5)', () => {
  const tail = [
    { kind: 'partial' as const, alternatives: ['ان الذين'] },
    { kind: 'partial' as const, alternatives: ['ان الذين كفروا'] },
    { kind: 'partial' as const, alternatives: ['ان الذين كفروا سواء'] },
    { kind: 'partial' as const, alternatives: ['ان الذين كفروا سواء عليهم'] },
    { kind: 'partial' as const, alternatives: ['ان الذين كفروا سواء عليهم انذرتهم'] },
    { kind: 'final' as const, alternatives: ['ان الذين كفروا سواء عليهم انذرتهم ام لم تنذرهم'] },
    { kind: 'partial' as const, alternatives: ['لا يؤمنون'] },
    { kind: 'final' as const, alternatives: ['لا يؤمنون'] },
  ];

  it('lands on 2:6 WITHOUT basmala and keeps following through the verse', () => {
    const out = replay({ name: '2:6-no-basmala', startCursor: 0, synthetic: true, events: tail }, config);
    expect(surahOf(out.final.cursor - 1)).toBe(2);
    // the whole of 2:6 is credited, not just the landing word
    expect(out.final.cursor).toBe(AYAH_2_6 + 11);
    expect(out.mistakes).toEqual([]);
    // and it happened while still early in the transcript, not at the end
    const jumped = out.frames.findIndex((f) => f.jumpReason.startsWith('JUMPED'));
    expect(jumped).toBeGreaterThanOrEqual(0);
    expect(jumped).toBeLessThanOrEqual(5);
  });

  it('lands on 2:6 WITH basmala', () => {
    const events = [
      { kind: 'partial' as const, alternatives: ['بسم الله'] },
      { kind: 'partial' as const, alternatives: ['بسم الله الرحمن الرحيم'] },
      { kind: 'final' as const, alternatives: ['بسم الله الرحمن الرحيم'] },
      { kind: 'segment' as const },
      ...tail,
    ];
    const out = replay({ name: '2:6-with-basmala', startCursor: 0, synthetic: true, events }, config);
    expect(surahOf(out.final.cursor - 1)).toBe(2);
    expect(out.final.cursor).toBe(AYAH_2_6 + 11);
  });

  it('credits the words already recited when arriving part-way into the verse', () => {
    const events = [
      { kind: 'partial' as const, alternatives: ['سواء عليهم انذرتهم'] },
      { kind: 'partial' as const, alternatives: ['سواء عليهم انذرتهم ام لم'] },
      { kind: 'final' as const, alternatives: ['سواء عليهم انذرتهم ام لم تنذرهم'] },
    ];
    const out = replay({ name: '2:6-midverse', startCursor: 0, synthetic: true, events }, config);
    // landed at سواء (offset 3), advanced past تنذرهم (offset 8)
    expect(out.final.cursor).toBe(AYAH_2_6 + 9);
    // the three words BEFORE the landing point are not mistakes: never expected
    expect(out.mistakes).toEqual([]);
  });

  it('needs two consecutive partials before it moves', () => {
    const single = replay(
      { name: 'one-partial', startCursor: 0, synthetic: true, events: [tail[2]] },
      config,
    );
    expect(single.final.cursor).toBeLessThan(SURAH_2);
  });
});

describe('crossing a surah boundary while reciting (acceptance test 6)', () => {
  it('continues into the next surah with no interruption and no jump', () => {
    const events = [
      { kind: 'partial' as const, alternatives: ['غير المغضوب عليهم'] },
      { kind: 'final' as const, alternatives: ['غير المغضوب عليهم ولا الضالين'] },
      { kind: 'segment' as const },
      { kind: 'partial' as const, alternatives: ['بسم الله الرحمن الرحيم'] },
      { kind: 'final' as const, alternatives: ['بسم الله الرحمن الرحيم'] },
      { kind: 'segment' as const },
      { kind: 'partial' as const, alternatives: ['الم ذلك الكتاب'] },
      { kind: 'final' as const, alternatives: ['الم ذلك الكتاب لا ريب فيه هدى للمتقين'] },
    ];
    const out = replay({ name: 'fatiha-into-baqarah', startCursor: 24, synthetic: true, events }, config);
    expect(out.final.cursor).toBe(SURAH_2 + 8);
    expect(surahOf(out.final.cursor - 1)).toBe(2);
    expect(out.mistakes).toEqual([]);
    // the boundary is crossed by plain increment, not by a localization jump
    expect(out.frames.every((f) => !f.jumpReason.startsWith('JUMPED'))).toBe(true);
  });
});

describe('mistake policy (§5.6, acceptance test 8)', () => {
  const misread: ReplayFixture = {
    name: 'skip-one-word',
    startCursor: 4,
    synthetic: true,
    events: [
      // "الحمد لله رب العالمين" with رب (word 6) misread as "ربي" is still a
      // match; to actually skip a word we drop العالمين (word 7) entirely.
      { kind: 'partial', alternatives: ['الحمد لله رب'] },
      {
        kind: 'final',
        alternatives: [
          'الحمد لله رب الرحمن الرحيم',
          'الحمد لله رب الرحمن الرحيم',
          'الحمد لله رب الرحمن الرحيم',
        ],
      },
      { kind: 'segment' },
      { kind: 'partial', alternatives: ['مالك يوم الدين'] },
      { kind: 'final', alternatives: ['مالك يوم الدين'] },
    ],
  };

  it('does not flag a word while the reciter is still on it', () => {
    const events = misread.events.slice(0, 2);
    const out = replay({ ...misread, events }, config);
    expect(out.mistakes).toEqual([]);
  });

  it('flags it exactly once, after the reciter has moved 3 words past', () => {
    const out = replay(misread, config);
    expect(out.mistakes).toEqual([7]); // العالمين
    // and only once, however many events followed
    expect(out.final.mistakes.filter((m) => m.word === 7)).toHaveLength(1);
  });

  it('needs two of the alternatives to agree the word was skipped', () => {
    // only the top alternative gets far enough to skip العالمين; the other two
    // stop short, so the skip has one vote and never becomes a mistake.
    const lonely: ReplayFixture = {
      ...misread,
      events: [
        { kind: 'partial', alternatives: ['الحمد لله رب'] },
        {
          kind: 'final',
          alternatives: ['الحمد لله رب الرحمن الرحيم', 'الحمد لله رب', 'الحمد لله رب'],
        },
        { kind: 'segment' },
        { kind: 'partial', alternatives: ['مالك يوم الدين'] },
        { kind: 'final', alternatives: ['مالك يوم الدين'] },
      ],
    };
    const out = replay(lonely, config);
    expect(out.mistakes).toEqual([]);
  });

  it('does not flag a word that a lower-ranked alternative did hear', () => {
    // §4: lower-ranked alternatives are frequently the correct one, so a word
    // ANY alternative heard is not a mistake.
    const rescued: ReplayFixture = {
      ...misread,
      events: [
        {
          kind: 'final',
          alternatives: [
            'الحمد لله رب الرحمن الرحيم',
            'الحمد لله رب الرحمن الرحيم',
            'الحمد لله رب العالمين الرحمن الرحيم',
          ],
        },
        { kind: 'segment' },
        { kind: 'final', alternatives: ['مالك يوم الدين', 'مالك يوم الدين'] },
      ],
    };
    expect(replay(rescued, config).mistakes).toEqual([]);
  });

  it('heals a late word: the grace pass drops the flag', () => {
    const late: ReplayFixture = {
      ...misread,
      events: [
        {
          kind: 'final',
          alternatives: [
            'الحمد لله رب الرحمن الرحيم',
            'الحمد لله رب الرحمن الرحيم',
            'الحمد لله رب الرحمن الرحيم',
          ],
        },
        // the recognizer delivers العالمين one utterance late
        { kind: 'final', alternatives: ['العالمين مالك يوم الدين', 'العالمين مالك يوم الدين'] },
      ],
    };
    const out = replay(late, config);
    expect(out.mistakes).toEqual([]);
  });

  it('"I said it right" removes it permanently', () => {
    const out = replay(misread, config);
    expect(out.mistakes).toEqual([7]);
    const dismissed = sessionReducer(out.final, { type: 'dismiss', word: 7 }, config);
    expect(dismissed.mistakes).toEqual([]);
    expect(dismissed.dismissed.has(7)).toBe(true);
    // and it can never come back, even if skipped again
    const again = sessionReducer(dismissed, { type: 'final', alternatives: ['غير المغضوب عليهم'], at: 2_000_000 }, config);
    expect(again.mistakes.some((m) => m.word === 7)).toBe(false);
  });

  it('keeps mistake identity stable across events (no flicker or reorder)', () => {
    const out = replay(misread, config);
    const first = out.final.mistakes;
    const next = sessionReducer(out.final, { type: 'tick', at: 2_000_000 }, config);
    expect(next.mistakes).toBe(first); // same array reference
  });
});

describe('object identity discipline (§5.7)', () => {
  it('returns the same state object when an event changes nothing', () => {
    const s = initialSession(0);
    expect(sessionReducer(s, { type: 'tick', at: 1 }, config)).toBe(s);
    expect(sessionReducer(s, { type: 'partial', alternatives: ['xyz'], at: 1 }, config)).toBe(s);
  });

  it('returns the same Set when no new word was matched', () => {
    let s = sessionReducer(initialSession(0), { type: 'start', at: 1, cursor: 0 }, config);
    s = sessionReducer(s, { type: 'final', alternatives: ['بسم الله الرحمن الرحيم'], at: 2 }, config);
    const matched = s.matched;
    const again = sessionReducer(s, { type: 'partial', alternatives: ['بسم الله الرحمن الرحيم'], at: 3 }, config);
    expect(again.matched).toBe(matched);
  });

  it('returns the same Set when a hint is repeated', () => {
    let s = sessionReducer(initialSession(0), { type: 'hint', word: 5 }, config);
    const hinted = s.hinted;
    s = sessionReducer(s, { type: 'hint', word: 5 }, config);
    expect(s.hinted).toBe(hinted);
  });
});
