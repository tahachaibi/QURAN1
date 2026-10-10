/**
 * The lead: the underline a beat ahead of the recognizer, display only.
 */
import {
  confirm,
  DEFAULT_MS_PER_LETTER,
  initialLead,
  LEAD_LAG_MS,
  RETRACT_SILENCE_MS,
  tick,
  wordMs,
} from '../src/engine/lead';

// five-letter words
const words = ['اااا1', 'اااا2', 'اااا3', 'اااا4', 'اااا5', 'اااا6'];
const open = { blocked: false, limit: words.length };

describe('the lead', () => {
  it('moves on while the voice is on, once the word has had time to be said', () => {
    // word 1 confirmed at t=1000: the reciter has been on word 1 since 600
    let s = confirm(initialLead(0, 0), 1, 1000, words);
    expect(s.lead).toBe(1);
    // word 1 ends LEAD_LAG_MS before its own length after the confirmation
    const endsAt = 1000 - LEAD_LAG_MS + wordMs(words[1], s.msPerLetter);
    s = tick(s, { ...open, now: endsAt - 10, lastVoiceAt: endsAt - 20 }, words);
    expect(s.lead).toBe(1);
    s = tick(s, { ...open, now: endsAt + 10, lastVoiceAt: endsAt }, words);
    expect(s.lead).toBe(2);
  });

  it('never runs more than one word ahead of what is confirmed', () => {
    let s = confirm(initialLead(0, 0), 1, 1000, words);
    for (let t = 1000; t < 6000; t += 40) s = tick(s, { ...open, now: t, lastVoiceAt: t }, words);
    expect(s.lead).toBe(2);
  });

  it('holds while the reciter is silent, and moves the moment they start again', () => {
    let s = confirm(initialLead(0, 0), 1, 1000, words);
    s = tick(s, { ...open, now: 3000, lastVoiceAt: 1000 }, words);
    expect(s.lead).toBe(1);
    s = tick(s, { ...open, now: 3040, lastVoiceAt: 3030 }, words);
    expect(s.lead).toBe(2);
  });

  it('steps back after a silence if it guessed ahead', () => {
    let s = confirm(initialLead(0, 0), 1, 1000, words);
    s = tick(s, { ...open, now: 2000, lastVoiceAt: 2000 }, words);
    expect(s.lead).toBe(2);
    s = tick(s, { ...open, now: 2000 + RETRACT_SILENCE_MS + 10, lastVoiceAt: 2000 }, words);
    expect(s.lead).toBe(1);
  });

  it('keeps the guess when the recognizer confirms it, and gives way to a confirmation past it', () => {
    let s = confirm(initialLead(0, 0), 1, 1000, words);
    s = tick(s, { ...open, now: 2000, lastVoiceAt: 2000 }, words);
    expect(s.lead).toBe(2);
    s = confirm(s, 2, 2100, words);
    expect(s.lead).toBe(2);
    s = confirm(s, 4, 2200, words);
    expect(s.lead).toBe(4);
  });

  it('anticipates nothing while the reciter owes the confirmed word', () => {
    let s = confirm(initialLead(0, 0), 1, 1000, words);
    s = tick(s, { ...open, now: 2000, lastVoiceAt: 2000 }, words);
    expect(s.lead).toBe(2);
    s = tick(s, { ...open, blocked: true, now: 2040, lastVoiceAt: 2040 }, words);
    expect(s.lead).toBe(1);
  });

  it('starts again from a confirmation that goes backwards', () => {
    let s = confirm(initialLead(3, 0), 4, 1000, words);
    s = confirm(s, 1, 1500, words);
    expect(s.lead).toBe(1);
    expect(s.confirmed).toBe(1);
  });

  it('learns a faster pace from the confirmations', () => {
    let s = initialLead(0, 0);
    // a word every 300 ms: half the default pace
    for (let i = 1; i <= 5; i++) s = confirm(s, i, i * 300, words);
    expect(s.msPerLetter).toBeLessThan(DEFAULT_MS_PER_LETTER * 0.8);
  });
});
