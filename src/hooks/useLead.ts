/**
 * Runs the underline's lead (src/engine/lead.ts) against the live session.
 *
 * State lives in a ref and is stepped on a short timer while listening; React
 * state changes only when the underlined word does, so this costs one or two
 * page re-renders per word, the same as a confirmed word.
 */
import { useEffect, useRef, useState } from 'react';

import { ayahByGlobal, ayahDisplayWords, globalAyahOf, wordInAyahOf } from '../data/quran';
import { confirm, initialLead, tick, unitsOfSpelling, type LeadState, type TextOf } from '../engine/lead';
import type { SessionState } from '../engine/session';

const unitsCache = new Map<number, number>();
/** The mushaf as the lead needs it: each word's length to say, and where ayahs begin. */
const TEXT: TextOf = {
  units: (word) => {
    let units = unitsCache.get(word);
    if (units === undefined) {
      const display = ayahDisplayWords(ayahByGlobal(globalAyahOf(word)))[wordInAyahOf(word)] ?? '';
      units = unitsOfSpelling(display);
      unitsCache.set(word, units);
    }
    return units;
  },
  startsAyah: (word) => wordInAyahOf(word) === 0,
};

/** About 25 steps a second: finer than any word, coarse enough to cost nothing. */
const TICK_MS = 40;

export interface LeadOptions {
  session: SessionState;
  /** exclusive upper bound: the end of a practice range, or of the Quran */
  limit: number;
  /** ms epoch the microphone last heard a voice */
  lastVoiceAt: () => number;
  /** false turns the lead off: the underline stays on the confirmed word */
  enabled: boolean;
}

/** The word to underline, or -1 to underline the confirmed position. */
export function useLead({ session, limit, lastVoiceAt, enabled }: LeadOptions): number {
  const listening = session.status === 'listening';
  const [lead, setLead] = useState(-1);
  const state = useRef<LeadState>(initialLead(session.livePos, Date.now()));

  // Every confirmation, at once.
  useEffect(() => {
    state.current = confirm(state.current, session.livePos, Date.now(), TEXT);
    setLead((current) => (current === -1 ? current : state.current.lead));
  }, [session.livePos]);

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
    state.current = { ...initialLead(state.current.confirmed, Date.now()), msPerUnit: state.current.msPerUnit };
    setLead(state.current.lead);
    const id = setInterval(() => {
      const next = tick(
        state.current,
        { now: Date.now(), lastVoiceAt: lastVoiceAt(), blocked: blockedRef.current, limit },
        TEXT,
      );
      if (next === state.current) return;
      state.current = next;
      setLead(next.lead);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [enabled, listening, lastVoiceAt, limit]);

  return lead;
}
