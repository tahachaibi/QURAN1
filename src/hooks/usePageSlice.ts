/**
 * Per-page state slices (spec §5.7).
 *
 * The session owns one global cursor. A page component must only re-render when
 * something inside ITS word range changed, so every page gets a slice clamped to
 * that range, cached by reference. When a recognized word lands on page 3, pages
 * 2 and 4 get the identical slice object back and React.memo bails out.
 */
import { useCallback, useRef } from 'react';

import { pageWordRange } from '../data/quran';
import type { SessionState } from '../engine/session';

export interface PageSlice {
  page: number;
  from: number;
  to: number;
  /** global index of the current word if it is on this page, else -1 */
  current: number;
  /** words on this page that have been recited */
  recited: number[];
  /** words on this page flagged as missed */
  missed: number[];
  /** words on this page that needed a hint */
  hinted: number[];
  /** 0..1 share of this page that has been recited, for the progress ribbon */
  progress: number;
}

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const sameSlice = (a: PageSlice, b: PageSlice): boolean =>
  a.page === b.page &&
  a.current === b.current &&
  a.progress === b.progress &&
  sameNumbers(a.recited, b.recited) &&
  sameNumbers(a.missed, b.missed) &&
  sameNumbers(a.hinted, b.hinted);

export function usePageSlice(session: SessionState): (page: number) => PageSlice {
  const cache = useRef(new Map<number, PageSlice>());

  return useCallback(
    (page: number): PageSlice => {
      const [from, to] = pageWordRange(page);
      const recited: number[] = [];
      const missed: number[] = [];
      const hinted: number[] = [];
      for (let i = from; i < to; i++) {
        if (session.matched.has(i)) recited.push(i);
        if (session.hinted.has(i)) hinted.push(i);
      }
      for (const m of session.mistakes) if (m.word >= from && m.word < to) missed.push(m.word);

      const live = session.livePos;
      const next: PageSlice = {
        page,
        from,
        to,
        current: live >= from && live < to ? live : -1,
        recited,
        missed,
        hinted,
        progress: to > from ? recited.length / (to - from) : 0,
      };

      const previous = cache.current.get(page);
      if (previous !== undefined && sameSlice(previous, next)) return previous;
      cache.current.set(page, next);
      return next;
    },
    [session],
  );
}
