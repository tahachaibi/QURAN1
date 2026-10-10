/**
 * The lead: where the underline is drawn, a beat ahead of the recognizer.
 *
 * WHY: the recognizer commits to a word only after hearing a little of the
 * next one, so every confirmed position arrives late. The engine adds nothing
 * to that (measured: 628 of 633 cursor moves on the same event the word
 * arrived), so the only way to put the underline under the word being SAID is
 * to anticipate it. The microphone level arrives at once, and the reciter's
 * own pace is measured from the words already confirmed: while the voice is
 * on, once the current word has had time to be said, the underline moves to
 * the next one. Where it helps most is the first words of an ayah, which the
 * recognizer is slowest to confirm (1.2 to 1.8 s after the voice on a device
 * recording).
 *
 * The lead is display only. It never reveals a hidden word, never counts as
 * recited, never grades anything. It runs at most MAX_LEAD words ahead of the
 * confirmed position, stops when the voice stops, steps back after a silence
 * if it guessed ahead, and gives way at once to every confirmation.
 *
 * Pure, and driven by explicit times, so it is tested without a clock.
 */

/** How far ahead of the confirmed position the underline may run. */
export const MAX_LEAD = 1;
/**
 * How far into the next word the reciter is when a confirmation arrives in
 * the middle of an ayah. Measured on a device recording, the recognizer
 * confirmed an ayah's last word between 0.2 s before and 0.45 s after the
 * voice stopped, so the lag is small.
 */
export const LEAD_LAG_MS = 150;
/** The voice counts as on if it was heard this recently. */
export const VOICE_RECENT_MS = 250;
/** After this much silence a guess that ran ahead steps back. */
export const RETRACT_SILENCE_MS = 1200;
/**
 * Pace, in ms per unit of length (see TextOf.units): bounds, and the guess
 * before any is measured. Tartil on a device recording was 130-165.
 */
export const MIN_MS_PER_UNIT = 50;
export const MAX_MS_PER_UNIT = 250;
export const DEFAULT_MS_PER_UNIT = 130;
/**
 * A confirmation one word BACK this soon after a forward one is the recognizer
 * revising its last partial (المستقي, then nothing, then المستقيم), not the
 * reciter going back. Following it made the underline flicker back and forth.
 */
export const REVISION_MS = 1000;
/** Confirmations further apart than this span a pause, not speech: no pace from them. */
const PACE_GAP_MS = 1500;
const PACE_SMOOTHING = 0.3;

/** What the lead needs to know about the text. */
export interface TextOf {
  /**
   * How long a word is to say, in units: its letters, plus its long vowels
   * (a superscript alif counts one, a maddah two). The plain spelling drops
   * them, and مٰلك is not a three-letter word when it is recited.
   */
  units: (word: number) => number;
  /** whether the word begins an ayah, where the reciter usually pauses first */
  startsAyah: (word: number) => boolean;
}

export interface LeadState {
  /** the last confirmed position (session.livePos) */
  confirmed: number;
  /** when it was confirmed */
  confirmedAt: number;
  /** the word the underline is on */
  lead: number;
  /** when the reciter is taken to have begun the word under the underline */
  leadStartedAt: number;
  msPerUnit: number;
}

export function initialLead(position: number, now: number): LeadState {
  return {
    confirmed: position,
    confirmedAt: now,
    lead: position,
    leadStartedAt: now,
    msPerUnit: DEFAULT_MS_PER_UNIT,
  };
}

/** How long a word takes to say at this pace; a floor for the shortest particles. */
export function wordMs(units: number, msPerUnit: number): number {
  return Math.max(2, units) * msPerUnit;
}

/**
 * A new confirmed position. Forward: refine the pace, and keep the lead if it
 * had already got there or further (the guess was right). Backward, or a jump:
 * start again from it.
 */
export function confirm(state: LeadState, position: number, now: number, text: TextOf): LeadState {
  if (position === state.confirmed) return state;
  if (position === state.confirmed - 1 && now - state.confirmedAt < REVISION_MS) return state;
  if (position < state.confirmed || position - state.confirmed > 12) {
    return { ...initialLead(position, now), msPerUnit: state.msPerUnit };
  }

  // The time since the last confirmation was spent saying the words between,
  // unless the first of them opens an ayah: then it includes the pause.
  let msPerUnit = state.msPerUnit;
  const gap = now - state.confirmedAt;
  if (gap > 0 && gap < PACE_GAP_MS && !text.startsAyah(state.confirmed)) {
    let units = 0;
    for (let w = state.confirmed; w < position; w++) units += Math.max(2, text.units(w));
    if (units > 0) {
      const measured = Math.min(MAX_MS_PER_UNIT, Math.max(MIN_MS_PER_UNIT, gap / units));
      msPerUnit = msPerUnit + PACE_SMOOTHING * (measured - msPerUnit);
    }
  }

  if (state.lead >= position) {
    // the underline was already there: the anticipation was right, keep its timing
    return { ...state, confirmed: position, confirmedAt: now, msPerUnit };
  }
  return {
    confirmed: position,
    confirmedAt: now,
    lead: position,
    // Mid-ayah the reciter is already into this word. An ayah's first word has
    // not begun before the ayah ahead of it is confirmed: the reciter was
    // still holding that one's last word, and likely pauses next (see tick).
    leadStartedAt: text.startsAyah(position) ? now : now - LEAD_LAG_MS,
    msPerUnit,
  };
}

export interface TickInput {
  now: number;
  /** when the microphone last heard a voice */
  lastVoiceAt: number;
  /**
   * Nothing may be anticipated: not locked on yet, or the confirmed word is
   * one the reciter owes (strict Hidden mode), or the range is over.
   */
  blocked: boolean;
  /** exclusive upper bound on where the lead may go */
  limit: number;
}

/** Advance, hold or step back, every few tens of ms. */
export function tick(state: LeadState, input: TickInput, text: TextOf): LeadState {
  const { now, lastVoiceAt, blocked, limit } = input;
  if (blocked) {
    return state.lead === state.confirmed ? state : { ...state, lead: state.confirmed, leadStartedAt: now };
  }
  const silentFor = now - lastVoiceAt;
  if (state.lead > state.confirmed && silentFor > RETRACT_SILENCE_MS) {
    // it guessed ahead and the reciter stopped short of that word
    return { ...state, lead: state.confirmed, leadStartedAt: now };
  }
  if (silentFor > VOICE_RECENT_MS) {
    // Nothing is being said, so the word under the underline has not begun:
    // it begins when the voice comes back.
    return state.leadStartedAt >= now ? state : { ...state, leadStartedAt: now };
  }
  if (state.lead - state.confirmed >= MAX_LEAD || state.lead + 1 >= limit) return state;
  // Never across the end of an ayah: its last word is held (the madd before a
  // stop) for longer than its letters say, so the next ayah's first word is
  // left to the recognizer, which confirms an ayah's end close to the voice's.
  if (text.startsAyah(state.lead + 1)) return state;

  const endsAt = state.leadStartedAt + wordMs(text.units(state.lead), state.msPerUnit);
  if (now < endsAt) return state;
  // The next word began when this one ended, or now if the reciter paused in
  // between and has just started again.
  return { ...state, lead: state.lead + 1, leadStartedAt: Math.max(endsAt, now - VOICE_RECENT_MS) };
}

/**
 * The length of a word to say, from its mushaf spelling: base letters, plus
 * one for each superscript alif and two for each maddah (also on آ). Harakat, sukun and
 * small pause marks add nothing.
 */
export function unitsOfSpelling(display: string): number {
  let units = 0;
  for (const ch of display) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x0670) units += 1; // superscript alif
    else if (c === 0x0653) units += 2; // maddah
    else if (c === 0x0622) units += 3; // alif with maddah: a letter and a long vowel
    else if ((c >= 0x0621 && c <= 0x064a) || c === 0x0671) units += 1; // letters, alif wasla
  }
  return units;
}
