/**
 * Runs the underline's lead (src/engine/lead.ts) against the live session.
 *
 * State lives in a ref and is stepped on a short timer while listening; React
 * state changes only when the underlined word does, so this costs one or two
 * page re-renders per word, the same as a confirmed word.
 */
import { useEffect, useRef, useState } from 'react';

import { confirm, initialLead, tick, type LeadState } from '../engine/lead';
import type { SessionState } from '../engine/session';

/** About 25 steps a second: finer than any word, coarse enough to cost nothing. */
const TICK_MS = 40;

export interface LeadOptions {
  session: SessionState;
  /** normalized words, for the pace (letters per word) */
  words: readonly string[];
  /** exclusive upper bound: the end of a practice range, or of the Quran */
  limit: number;
  /** ms epoch the microphone last heard a voice */
  lastVoiceAt: () => number;
  /** false turns the lead off: the underline stays on the confirmed word */
  enabled: boolean;
}

/** The word to underline, or -1 to underline the confirmed position. */
export function useLead({ session, words, limit, lastVoiceAt, enabled }: LeadOptions): number {
  const listening = session.status === 'listening';
  const [lead, setLead] = useState(-1);
  const state = useRef<LeadState>(initialLead(session.livePos, Date.now()));

  // Every confirmation, at once.
  useEffect(() => {
    state.current = confirm(state.current, session.livePos, Date.now(), words);
    setLead((current) => (current === -1 ? current : state.current.lead));
  }, [session.livePos, words]);

  // The reciter owes the confirmed word (strict Hidden mode), or has not been
  // found yet: nothing to anticipate.
  const owed = session.mistakes.some((m) => m.word === session.livePos);
  const blocked = !session.lockedOn || owed;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  useEffect(() => {
    if (!enabled || !listening) {
      setLead(-1);
      return undefined;
    }
    // the pace carries over from the last session: it is the reciter's
    state.current = { ...initialLead(state.current.confirmed, Date.now()), msPerLetter: state.current.msPerLetter };
    const id = setInterval(() => {
      const next = tick(
        state.current,
        { now: Date.now(), lastVoiceAt: lastVoiceAt(), blocked: blockedRef.current, limit },
        words,
      );
      if (next === state.current) return;
      state.current = next;
      setLead(next.lead);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [enabled, listening, lastVoiceAt, limit, words]);

  return lead;
}
