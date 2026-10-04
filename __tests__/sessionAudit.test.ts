/**
 * Session behaviour found wrong by the engine audit, each pinned by the case
 * that showed it. Every test here failed before its fix.
 */
import { align } from '../src/engine/align';
import { localize } from '../src/engine/localize';
import {
  leadingIstiadhaLength,
  normalizeHeard,
  normalizeHeardSpans,
  trailingClosingLength,
} from '../src/engine/normalize';
import { replay, syntheticFixture, type ReplayEvent, type ReplayFixture } from '../src/engine/replay';
import { initialSession, sessionReducer, type SessionConfig, type SessionState } from '../src/engine/session';
import { pageOf, surahOf, wordIndexOf, words } from '../src/data/quran';
import { vocabulary } from '../src/engine/searchIndex';

const vocab = vocabulary();
const config: SessionConfig = {
  words,
  surahOf,
  vocabulary: vocab,
  floor: 0,
  limit: words.length,
  viewSurah: 1,
};

/** One utterance as a recognizer delivers it: growing partials, then a final. */
function utterance(text: string, alternatives = 1): ReplayEvent[] {
  const tokens = text.split(' ');
  const events: ReplayEvent[] = [];
  for (let n = 1; n <= tokens.length; n++) {
    events.push({ kind: 'partial', alternatives: [tokens.slice(0, n).join(' ')] });
  }
  events.push({ kind: 'final', alternatives: Array.from({ length: alternatives }, () => text) });
  events.push({ kind: 'segment' });
  return events;
}

const run = (startCursor: number, events: ReplayEvent[], cfg: SessionConfig = config) =>
  replay({ name: 'audit', startCursor, synthetic: true, events }, cfg);

const MULK = wordIndexOf(67, 1);
const MULK_2 = wordIndexOf(67, 2);
const AYAH_2_67 = wordIndexOf(2, 67);

describe("the isti'adha before reciting", () => {
  const ISTIADHA = 'أعوذ بالله من الشيطان الرجيم';
  const MULK_1 = 'تبارك الذي بيده الملك وهو على كل شيء قدير';

  it('is recognized only as the formula, never as the Quran’s own أعوذ', () => {
    expect(leadingIstiadhaLength(normalizeHeard(ISTIADHA))).toBe(5);
    expect(leadingIstiadhaLength(normalizeHeard('أعوذ بالله السميع العليم من الشيطان الرجيم'))).toBe(7);
    // 2:67 resumed after a breath, 113:1 and 23:97 are Quran
    expect(leadingIstiadhaLength(normalizeHeard('أعوذ بالله أن أكون من الجاهلين'))).toBe(0);
    expect(leadingIstiadhaLength(normalizeHeard('أعوذ برب الفلق'))).toBe(0);
    expect(leadingIstiadhaLength(normalizeHeard('أعوذ بك من همزات الشياطين'))).toBe(0);
    // and only at the start of what was heard
    expect(leadingIstiadhaLength(normalizeHeard(`قال ${ISTIADHA}`))).toBe(0);
  });

  it('does not send the page to Al-Baqarah 2:67', () => {
    for (const events of [
      utterance(`${ISTIADHA} بسم الله الرحمن الرحيم ${MULK_1}`),
      [...utterance(ISTIADHA), ...utterance('بسم الله الرحمن الرحيم'), ...utterance(MULK_1)],
    ]) {
      const out = run(MULK, events);
      for (const f of out.frames) expect(surahOf(f.livePos)).toBe(67);
      for (const f of out.frames) expect(f.jumped).toBe(false);
      for (let w = AYAH_2_67; w < AYAH_2_67 + 10; w++) expect(out.final.matched.has(w)).toBe(false);
      expect(out.final.cursor).toBe(MULK_2);
      expect(out.mistakes).toEqual([]);
    }
  });

  it('is not localized anywhere on its own', () => {
    const r = localize({
      words,
      cursor: 0,
      livePos: 0,
      heard: normalizeHeard(`${ISTIADHA} بسم الله الرحمن الرحيم`),
      localScore: 0,
    });
    expect(r.target).toBeNull();
  });

  it('does not stop the first-launch try on Al-Fatiha from following', () => {
    const out = run(0, utterance(`${ISTIADHA} بسم الله الرحمن الرحيم الحمد لله رب العالمين`));
    for (const f of out.frames) expect(pageOf(f.livePos)).toBe(1);
    expect(out.final.cursor).toBe(8);
  });
});

describe('the closing صدق الله العظيم', () => {
  it('is stripped whole from a final, and its opening from a partial', () => {
    const heard = normalizeHeard('قدير صدق الله العظيم');
    expect(trailingClosingLength(heard, false)).toBe(3);
    // "قل صدق الله" is 3:95, with a pause mark after it: a final keeps it
    expect(trailingClosingLength(normalizeHeard('قل صدق الله'), false)).toBe(0);
    expect(trailingClosingLength(normalizeHeard('قل صدق الله'), true)).toBe(2);
  });

  it('does not walk the cursor into the next ayah', () => {
    const out = run(MULK, utterance('تبارك الذي بيده الملك وهو على كل شيء قدير صدق الله العظيم'));
    expect(out.final.cursor).toBe(MULK_2);
    for (let w = MULK_2; w < MULK_2 + 6; w++) expect(out.final.matched.has(w)).toBe(false);
  });
});

describe('what was heard, as the recognizer spelled it', () => {
  it('keeps each token’s spelling next to its normalized form', () => {
    expect(normalizeHeardSpans(' فئران والسماء بنا', vocab)).toEqual({
      tokens: ['فيران', 'والسما', 'بنا'],
      raw: ['فئران', 'والسماء', 'بنا'],
    });
    // a detached proclitic is written joined, digits and Latin drop out
    expect(normalizeHeardSpans('شيء 3 OK ، و الله على', vocab)).toEqual({
      tokens: ['شي', 'والله', 'علي'],
      raw: ['شيء', 'والله', 'على'],
    });
    // harakat and tatweel are not letters
    expect(normalizeHeardSpans('الصَّلاةِ', vocab).raw).toEqual(['الصلاة']);
  });

  it('shows the live strip and the transcript spelled, and matches on the folded form', () => {
    let s = sessionReducer(initialSession(wordIndexOf(2, 47)), { type: 'start', at: 1, cursor: wordIndexOf(2, 47) }, config);
    s = sessionReducer(
      s,
      { type: 'final', alternatives: ['يا بني إسرائيل اذكروا نعمتي التي أنعمت عليكم وأني فضلتكم على العالمين'], at: 2 },
      config,
    );
    expect(s.lastHeard).toBe('يا بني إسرائيل اذكروا نعمتي التي أنعمت عليكم وأني فضلتكم على العالمين');
    expect(s.sessionHeardRaw).toContain('على');
    expect(s.sessionHeardRaw).toContain('إسرائيل');
    expect(s.sessionHeard).toContain('علي');
    expect(s.sessionHeard).toHaveLength(s.sessionHeardRaw.length);
    expect(s.cursor).toBe(wordIndexOf(2, 48));
  });
});

describe('the look-ahead within one utterance', () => {
  it('does not change once the session locks on part-way through it', () => {
    // device session 01: started at 1:1, the reciter began at الحمد
    const out = run(0, utterance('الحمد لله رب العالمين الرحمن الرحيم'));
    for (const w of [4, 5, 6, 7, 8, 9]) expect(out.final.matched.has(w)).toBe(true);
    for (const w of [1, 2, 3]) expect(out.final.matched.has(w)).toBe(false);
    // and the voice never jumped back to the basmala
    for (let i = 1; i < out.frames.length; i++) expect(out.frames[i].livePos).toBeGreaterThanOrEqual(4);
  });
});

describe('a practice range, recited again', () => {
  const FROM = wordIndexOf(1, 7);
  const ranged: SessionConfig = { ...config, floor: FROM, limit: 29 };
  const AYAH = 'صراط الذين انعمت عليهم غير المغضوب عليهم ولا الضالين';

  it('wraps a finished range back to its first word when started again', () => {
    const done = run(FROM, utterance(AYAH, 2), ranged);
    expect(done.final.cursor).toBe(29);
    const stopped = sessionReducer(done.final, { type: 'stop', at: 5_000_000 }, ranged);
    const again = sessionReducer(stopped, { type: 'start', at: 5_000_001, cursor: stopped.cursor }, ranged);
    expect(again.cursor).toBe(FROM);
    // a session with no range is left where it is
    expect(sessionReducer(stopped, { type: 'start', at: 5_000_001, cursor: 29 }, config).cursor).toBe(29);
  });

  it('is still followed when the cursor sits at the end of the range', () => {
    const r = align({ words, startCursor: 29, heard: normalizeHeard(AYAH), lookAhead: 3, floor: FROM, limit: 29 });
    expect(r.empty).toBe(false);
    expect(r.livePos).toBe(29);
    expect(r.anchor).toBe(FROM);
  });

  it('flags a skip in its last three words when the range is finished', () => {
    // ولا (index 27) dropped; nothing can come after the range to confirm it
    const out = run(FROM, utterance('صراط الذين انعمت عليهم غير المغضوب عليهم الضالين', 2), ranged);
    expect(out.mistakes).toEqual([27]);
  });

  it('flags a skip in the last words of any session when it stops', () => {
    const out = run(FROM, utterance('صراط الذين انعمت عليهم غير المغضوب عليهم الضالين', 2));
    expect(out.final.pending.map((p) => p.word)).toEqual([27]);
    const stopped = sessionReducer(out.final, { type: 'stop', at: 9_000_000 }, config);
    expect(stopped.mistakes.map((m) => m.word)).toEqual([27]);
    expect(stopped.pending).toEqual([]);
  });

  it('never relocates out of the range', () => {
    const baqarah: SessionConfig = { ...config, floor: wordIndexOf(2, 1), limit: wordIndexOf(2, 6), viewSurah: 2 };
    const out = run(
      wordIndexOf(2, 1),
      utterance('الله لا إله إلا هو الحي القيوم لا تأخذه سنة ولا نوم له ما في السماوات وما في الأرض'),
      baqarah,
    );
    for (const f of out.frames) {
      expect(f.cursor).toBeGreaterThanOrEqual(baqarah.floor);
      expect(f.cursor).toBeLessThanOrEqual(baqarah.limit);
    }
  });
});

describe('hints', () => {
  it('belong to the session they were used in', () => {
    let s = sessionReducer(initialSession(0), { type: 'start', at: 1, cursor: 0 }, config);
    s = sessionReducer(s, { type: 'hint', word: 5 }, config);
    s = sessionReducer(s, { type: 'stop', at: 2 }, config);
    expect(s.hinted.has(5)).toBe(true);
    s = sessionReducer(s, { type: 'start', at: 3 }, config);
    expect(s.hinted.size).toBe(0);
  });
});

describe('taking back "I said it right"', () => {
  const mistake = { word: 7, heardInstead: '', at: 1 };
  const flagged = (): SessionState => ({ ...initialSession(0), status: 'listening', mistakes: [mistake] });

  it('checks the word again and puts the mistake back', () => {
    const dismissed = sessionReducer(flagged(), { type: 'dismiss', word: 7 }, config);
    expect(dismissed.mistakes).toEqual([]);
    const undone = sessionReducer(dismissed, { type: 'undismiss', word: 7, mistake }, config);
    expect(undone.dismissed.has(7)).toBe(false);
    expect(undone.mistakes).toEqual([mistake]);
  });

  it('can forget every dismissal at once', () => {
    let s = sessionReducer(flagged(), { type: 'restoreDismissed', words: [3, 7, 9] }, config);
    s = sessionReducer(s, { type: 'clearDismissed' }, config);
    expect(s.dismissed.size).toBe(0);
    expect(sessionReducer(s, { type: 'clearDismissed' }, config)).toBe(s);
  });
});

describe('a wrong word said just before a pause', () => {
  it('is reported as said in the word’s place, not as skipped', () => {
    // 2:2 ended with للمؤمنين for للمتقين, a pause, then 2:3
    const out = run(wordIndexOf(2, 2), [
      ...utterance('ذلك الكتاب لا ريب فيه هدى للمؤمنين', 2),
      ...utterance('الذين يؤمنون بالغيب ويقيمون الصلاة', 2),
    ]);
    const word = wordIndexOf(2, 2) + 6;
    expect(out.mistakes).toEqual([word]);
    const m = out.final.mistakes[0];
    expect(m.heardInstead).toBe('للمومنين');
    expect(m.heardRaw).toBe('للمؤمنين');
  });
});

describe('starting later than the saved place', () => {
  it('is not a skip of the words before where the reciter began', () => {
    // device session 04: saved on يعمهون, the last word of 2:15
    const start = wordIndexOf(2, 16) - 1;
    const out = run(start, utterance('أولئك الذين اشتروا الضلالة بالهدى فما ربحت تجارتهم', 2));
    expect(out.mistakes).toEqual([]);
  });

  it('nor after a seek', () => {
    const at = wordIndexOf(2, 255);
    const out = run(at, [
      ...utterance('الحي القيوم لا تأخذه سنة ولا نوم له ما في السماوات', 2),
      ...utterance('وما في الأرض من ذا الذي يشفع عنده إلا بإذنه', 2),
    ]);
    expect(out.mistakes).toEqual([]);
  });

  it('but a skip after the first word still counts', () => {
    const out = run(4, [...utterance('الحمد لله رب الرحمن الرحيم', 2), ...utterance('مالك يوم الدين', 2)]);
    expect(out.mistakes).toEqual([7]);
  });
});

describe('بعدما, written joined by the recognizer', () => {
  it('splits into the mushaf’s two words only where the mushaf has two', () => {
    expect(normalizeHeard('فمن بدله بعدما سمعه', vocab)).toEqual(['فمن', 'بدله', 'بعد', 'ما', 'سمعه']);
    expect(normalizeHeard('مثلما', vocab)).toEqual(['مثل', 'ما']);
    expect(normalizeHeard('كلما', vocab)).toEqual(['كلما']);
    expect(normalizeHeard('انما', vocab)).toEqual(['انما']);
    expect(normalizeHeard('ربهما', vocab)).toEqual(['ربهما']);
    expect(normalizeHeardSpans('بعدما', vocab).raw).toEqual(['بعد', 'ما']);
  });

  it('is not two wrong words in 2:181', () => {
    const out = run(wordIndexOf(2, 181), [
      ...utterance('فمن بدله بعدما سمعه فإنما إثمه على الذين يبدلونه إن الله سميع عليم', 3),
      ...utterance('فمن خاف من موص جنفا أو إثما فأصلح بينهم', 3),
    ]);
    expect(out.mistakes).toEqual([]);
    expect(out.final.matched.has(wordIndexOf(2, 181) + 2)).toBe(true);
    expect(out.final.matched.has(wordIndexOf(2, 181) + 3)).toBe(true);
  });
});

describe('the JUMPED label', () => {
  it('is on the one event that jumped, not on the cooldown after it', () => {
    const fixture: ReplayFixture = syntheticFixture('jump', 0, [
      ['ان', 'الذين', 'كفروا', 'سواء', 'عليهم', 'انذرتهم', 'ام', 'لم', 'تنذرهم', 'لا', 'يومنون'],
    ]);
    const out = replay(fixture, config);
    const labelled = out.frames.filter((f) => f.jumpReason.startsWith('JUMPED'));
    const jumped = out.frames.filter((f) => f.jumped);
    expect(jumped).toHaveLength(1);
    expect(labelled).toEqual(jumped);
  });
});
