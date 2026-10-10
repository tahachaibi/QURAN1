/**
 * The lead: where the underline is drawn, a beat ahead of the recognizer.
 *
 * WHY: the recognizer commits to a word only after hearing a little of the
 * next one, so every confirmed position arrives late, by about a word. The
 * engine adds nothing to that (measured: 628 of 633 cursor moves on the same
 * event the word arrived), so the only way to put the underline under the
 * word being SAID is to anticipate it. The microphone level arrives at once,
 * and the reciter's own pace is measured from the words already confirmed:
 * while the voice is on, once the current word has had time to be said, the
 * underline moves to the next one.
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
 * How long after the reciter began a word the recognizer confirms the word
 * before it: the moment a confirmation arrives, they have already been on the
 * next word about this long.
 */
export const LEAD_LAG_MS = 400;
/** The voice counts as on if it was heard this recently. */
export const VOICE_RECENT_MS = 250;
/** After this much silence a guess that ran ahead steps back. */
export const RETRACT_SILENCE_MS = 1200;
/** Pace bounds, ms per letter, and the starting guess before any is measured. */
export const MIN_MS_PER_LETTER = 60;
export const MAX_MS_PER_LETTER = 220;
export const DEFAULT_MS_PER_LETTER = 120;
/** Confirmations further apart than this span a pause, not speech: no pace from them. */
const PACE_GAP_MS = 1500;
const PACE_SMOOTHING = 0.3;

export interface LeadState {
  /** the last confirmed position (session.livePos) */
  confirmed: number;
  /** when it was confirmed */
  confirmedAt: number;
  /** the word the underline is on */
  lead: number;
  /** when the reciter is taken to have begun the word under the underline */
  leadStartedAt: number;
  msPerLetter: number;
}

export function initialLead(position: number, now: number): LeadState {
  return {
    confirmed: position,
    confirmedAt: now,
    lead: position,
    leadStartedAt: now,
    msPerLetter: DEFAULT_MS_PER_LETTER,
  };
}

/** How long a word takes to say at this pace; a floor for the shortest particles. */
export function wordMs(word: string, msPerLetter: number): number {
  return Math.max(2, word.length) * msPerLetter;
}

/**
 * A new confirmed position. Forward: refine the pace, and keep the lead if it
 * had already got there or further (the guess was right). Backward, or a jump:
 * start again from it.
 */
export function confirm(
  state: LeadState,
  position: number,
  now: number,
  words: readonly string[],
): LeadState {
  if (position === state.confirmed) return state;
  if (position < state.confirmed || position - state.confirmed > 12) {
    return { ...initialLead(position, now), msPerLetter: state.msPerLetter };
  }

  let msPerLetter = state.msPerLetter;
  const gap = now - state.confirmedAt;
  if (gap > 0 && gap < PACE_GAP_MS) {
    let letters = 0;
    for (let w = state.confirmed; w < position; w++) letters += Math.max(2, (words[w] ?? '').length);
    if (letters > 0) {
      const measured = Math.min(MAX_MS_PER_LETTER, Math.max(MIN_MS_PER_LETTER, gap / letters));
      msPerLetter = msPerLetter + PACE_SMOOTHING * (measured - msPerLetter);
    }
  }

  if (state.lead >= position) {
    // the underline was already there: the anticipation was right, keep its timing
    return { ...state, confirmed: position, confirmedAt: now, msPerLetter };
  }
  return {
    confirmed: position,
    confirmedAt: now,
    lead: position,
    leadStartedAt: now - LEAD_LAG_MS,
    msPerLetter,
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

/** Advance, hold or step back, once per frame or so. */
export function tick(state: LeadState, input: TickInput, words: readonly string[]): LeadState {
  const { now, lastVoiceAt, blocked, limit } = input;
  if (blocked) {
    return state.lead === state.confirmed ? state : { ...state, lead: state.confirmed, leadStartedAt: now };
  }
  const silentFor = now - lastVoiceAt;
  if (state.lead > state.confirmed && silentFor > RETRACT_SILENCE_MS) {
    // it guessed ahead and the reciter stopped short of that word
    return { ...state, lead: state.confirmed, leadStartedAt: now };
  }
  if (silentFor > VOICE_RECENT_MS) return state;
  if (state.lead - state.confirmed >= MAX_LEAD || state.lead + 1 >= limit) return state;

  const endsAt = state.leadStartedAt + wordMs(words[state.lead] ?? '', state.msPerLetter);
  if (now < endsAt) return state;
  // The next word began when this one ended, or now if the reciter paused in
  // between and has just started again.
  return { ...state, lead: state.lead + 1, leadStartedAt: Math.max(endsAt, now - VOICE_RECENT_MS) };
}
