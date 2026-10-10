/**
 * The lead: the underline a beat ahead of the recognizer, display only.
 */
import {
  confirm,
  DEFAULT_MS_PER_UNIT,
  initialLead,
  LEAD_LAG_MS,
  RETRACT_SILENCE_MS,
  tick,
  unitsOfSpelling,
  wordMs,
  type TextOf,
} from '../src/engine/lead';

// six five-unit words; an ayah begins at word 4
const text: TextOf = { units: () => 5, startsAyah: (w) => w === 0 || w === 4 };
const WORD = (s: { msPerUnit: number }): number => wordMs(5, s.msPerUnit);
const open = { blocked: false, limit: 6 };

describe('the lead', () => {
  it('moves on while the voice is on, once the word has had time to be said', () => {
    // the voice is already on when word 0 is confirmed
    let s = tick(initialLead(0, 0), { ...open, now: 960, lastVoiceAt: 960 }, text);
    s = confirm(s, 1, 1000, text);
    expect(s.lead).toBe(1);
    const endsAt = 1000 - LEAD_LAG_MS + WORD(s);
    s = tick(s, { ...open, now: endsAt - 10, lastVoiceAt: endsAt - 20 }, text);
    expect(s.lead).toBe(1);
    s = tick(s, { ...open, now: endsAt + 10, lastVoiceAt: endsAt }, text);
    expect(s.lead).toBe(2);
  });

  it('never runs more than two words ahead of what is confirmed', () => {
    let s = confirm(initialLead(0, 0), 1, 1000, text);
    for (let t = 1000; t < 6000; t += 40) s = tick(s, { ...open, now: t, lastVoiceAt: t }, text);
    expect(s.lead).toBe(3);
  });

  it('holds while the reciter is silent, and moves on once the word has been said after it', () => {
    let s = confirm(initialLead(0, 0), 1, 1000, text);
    for (let t = 1000; t <= 3000; t += 40) s = tick(s, { ...open, now: t, lastVoiceAt: 900 }, text);
    expect(s.lead).toBe(1);
    // the voice comes back at 3030 and is seen at 3040: word 1 begins then
    s = tick(s, { ...open, now: 3040, lastVoiceAt: 3030 }, text);
    expect(s.lead).toBe(1);
    const end = 3040 + WORD(s);
    s = tick(s, { ...open, now: end - 40, lastVoiceAt: end - 40 }, text);
    expect(s.lead).toBe(1);
    s = tick(s, { ...open, now: end + 30, lastVoiceAt: end + 30 }, text);
    expect(s.lead).toBe(2);
  });

  it('steps back after a silence if it guessed ahead', () => {
    let s = confirm(initialLead(0, 0), 1, 1000, text);
    for (let t = 1000; t <= 2000; t += 40) s = tick(s, { ...open, now: t, lastVoiceAt: t }, text);
    expect(s.lead).toBe(2);
    s = tick(s, { ...open, now: 2000 + RETRACT_SILENCE_MS + 10, lastVoiceAt: 2000 }, text);
    expect(s.lead).toBe(1);
  });

  it('keeps the guess when the recognizer confirms it, and gives way to a confirmation past it', () => {
    let s = confirm(initialLead(0, 0), 1, 1000, text);
    for (let t = 1000; t <= 2000; t += 40) s = tick(s, { ...open, now: t, lastVoiceAt: t }, text);
    expect(s.lead).toBe(2);
    s = confirm(s, 2, 2100, text);
    expect(s.lead).toBe(2);
    s = confirm(s, 3, 2200, text);
    expect(s.lead).toBe(3);
  });

  it('anticipates nothing while the reciter owes the confirmed word', () => {
    let s = confirm(initialLead(0, 0), 1, 1000, text);
    for (let t = 1000; t <= 2000; t += 40) s = tick(s, { ...open, now: t, lastVoiceAt: t }, text);
    expect(s.lead).toBe(2);
    s = tick(s, { ...open, blocked: true, now: 2040, lastVoiceAt: 2040 }, text);
    expect(s.lead).toBe(1);
  });

  it('starts again from a confirmation that goes backwards', () => {
    let s = confirm(initialLead(3, 0), 4, 1000, text);
    s = confirm(s, 1, 3000, text);
    expect(s.lead).toBe(1);
    expect(s.confirmed).toBe(1);
  });

  it('learns a faster pace from a stretch of recitation', () => {
    let s = initialLead(1, 0);
    // the voice begins at 1000 on word 1, and a word is confirmed every 300 ms
    for (let t = 1000; t <= 2000; t += 20) {
      if (t > 1000 && (t - 1000) % 300 === 0) s = confirm(s, Math.min(5, 1 + (t - 1000) / 300), t, text);
      s = tick(s, { ...open, now: t, lastVoiceAt: t }, text);
    }
    expect(s.msPerUnit).toBeLessThan(DEFAULT_MS_PER_UNIT * 0.8);
  });

  it('is not fooled by the recognizer confirming words in a burst', () => {
    let s = initialLead(1, 0);
    // a slow reciter: the voice begins at 1000, and nothing is confirmed for
    // 2.2 s, then three words at once
    for (let t = 1000; t <= 3200; t += 20) s = tick(s, { ...open, now: t, lastVoiceAt: t }, text);
    s = confirm(s, 4, 3200, text);
    // 3 words, 15 units, in about 2 s: slower than the default, not faster
    expect(s.msPerUnit).toBeGreaterThan(DEFAULT_MS_PER_UNIT);
  });
});

describe('the lead around ayahs, pauses and revisions', () => {
  it("starts an ayah's first word after the pause before it, not before the ayah ahead is confirmed", () => {
    // word 3 ends the ayah; its confirmation puts the underline on word 4
    let s = confirm(initialLead(2, 0), 4, 1000, text);
    // the voice runs on a little (word 3's last letter, held), then a pause
    for (let t = 1000; t <= 1200; t += 40) s = tick(s, { ...open, now: t, lastVoiceAt: t }, text);
    for (let t = 1240; t < 4000; t += 40) s = tick(s, { ...open, now: t, lastVoiceAt: 1200 }, text);
    expect(s.lead).toBe(4);
    // word 4 begins at 4000, and is still being said just before its length is up
    const end = 4000 + WORD(s);
    for (let t = 4000; t <= end - 80; t += 40) s = tick(s, { ...open, now: t, lastVoiceAt: t }, text);
    expect(s.lead).toBe(4);
    for (let t = end - 40; t <= end + 80; t += 40) s = tick(s, { ...open, now: t, lastVoiceAt: t }, text);
    expect(s.lead).toBe(5);
  });

  it('never anticipates the first word of the next ayah', () => {
    let s = confirm(initialLead(2, 0), 3, 1000, text);
    for (let t = 1000; t <= 5000; t += 40) s = tick(s, { ...open, now: t, lastVoiceAt: t }, text);
    expect(s.lead).toBe(3);
  });

  it('does not count a pause as time spent on the next word', () => {
    let s = confirm(initialLead(0, 0), 1, 1000, text);
    for (let t = 1000; t <= 5000; t += 40) s = tick(s, { ...open, now: t, lastVoiceAt: 900 }, text);
    s = tick(s, { ...open, now: 5100, lastVoiceAt: 5100 }, text);
    expect(s.lead).toBe(1);
  });

  it('ignores the recognizer taking back its last word, but not the reciter going back', () => {
    let s = confirm(initialLead(0, 0), 3, 1000, text);
    s = confirm(s, 2, 1200, text);
    expect(s.confirmed).toBe(3);
    s = confirm(s, 1, 3000, text);
    expect(s.confirmed).toBe(1);
  });
});

describe('the length of a word to say', () => {
  it('counts the long vowels the plain spelling leaves out', () => {
    // مَٰلِكِ: three letters and a superscript alif
    expect(unitsOfSpelling('مَٰلِكِ')).toBe(4);
    // ٱلضَّآلِّينَ: seven letters, and the maddah two more
    expect(unitsOfSpelling('ٱلضَّآلِّينَ')).toBe(9);
    expect(unitsOfSpelling('لَا')).toBe(2);
  });
});
