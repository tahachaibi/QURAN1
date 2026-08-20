/**
 * Replay harness (spec §9).
 *
 * Feeds a recorded sequence of recognizer events — partials and finals, up to
 * five alternatives each — through the real reducer and returns the cursor
 * path. This is the only way to iterate on matching quality without reciting
 * the passage again, and it is what turns "accuracy feels worse" into a diff.
 *
 * Fixtures captured on a device by the debug overlay's "export session" button
 * drop straight into __tests__/fixtures/ and run here unmodified.
 */
import { initialSession, sessionReducer, type SessionConfig, type SessionEvent, type SessionState } from './session';

export interface ReplayEvent {
  kind: 'partial' | 'final' | 'segment' | 'pause' | 'resume';
  /** up to 5 recognizer alternatives, best first, as raw (un-normalized) text */
  alternatives?: string[];
  /** ms since the previous event; defaults to 250 for partials, 600 for finals */
  dt?: number;
}

export interface ReplayFixture {
  name: string;
  /** where the session started; use wordIndexOf(surah, ayah) to build it */
  startCursor: number;
  /** true when hand-written rather than captured from a device */
  synthetic?: boolean;
  notes?: string;
  events: ReplayEvent[];
}

export interface ReplayFrame {
  index: number;
  kind: ReplayEvent['kind'];
  cursor: number;
  livePos: number;
  lockedOn: boolean;
  mistakes: number[];
  pending: number[];
  matchedCount: number;
  jumpReason: string;
  localScore: number;
  globalScore: number;
}

export interface ReplayOutcome {
  frames: ReplayFrame[];
  final: SessionState;
  /** the cursor after each event, the headline signal to assert on */
  cursorPath: number[];
  /** words flagged as mistakes by the end */
  mistakes: number[];
}

const DEFAULT_DT: Record<ReplayEvent['kind'], number> = {
  partial: 250,
  final: 600,
  segment: 100,
  pause: 100,
  resume: 100,
};

export function replay(fixture: ReplayFixture, config: SessionConfig): ReplayOutcome {
  let now = 1_000_000; // a fixed epoch: replays must be deterministic
  let state = sessionReducer(initialSession(fixture.startCursor), { type: 'start', at: now, cursor: fixture.startCursor }, config);

  const frames: ReplayFrame[] = [];
  fixture.events.forEach((e, index) => {
    now += e.dt ?? DEFAULT_DT[e.kind];
    let event: SessionEvent;
    switch (e.kind) {
      case 'partial':
        event = { type: 'partial', alternatives: e.alternatives ?? [], at: now, emittedAt: now };
        break;
      case 'final':
        event = { type: 'final', alternatives: e.alternatives ?? [], at: now, emittedAt: now };
        break;
      case 'segment':
        event = { type: 'endOfSegment', at: now };
        break;
      case 'pause':
        event = { type: 'pause', at: now };
        break;
      case 'resume':
        event = { type: 'resume', at: now };
        break;
    }
    state = sessionReducer(state, event, config);
    frames.push({
      index,
      kind: e.kind,
      cursor: state.cursor,
      livePos: state.livePos,
      lockedOn: state.lockedOn,
      mistakes: state.mistakes.map((m) => m.word),
      pending: state.pending.map((p) => p.word),
      matchedCount: state.matched.size,
      jumpReason: state.debug.jumpReason,
      localScore: Number(state.debug.localScore.toFixed(3)),
      globalScore: Number(state.debug.globalScore.toFixed(3)),
    });
  });

  return {
    frames,
    final: state,
    cursorPath: frames.map((f) => f.cursor),
    mistakes: state.mistakes.map((m) => m.word),
  };
}

/**
 * Turn a plain recitation into a fixture that grows partials the way a
 * recognizer does: each partial extends the previous one, then a final commits.
 * Used to build the synthetic fixtures; real captures do not need it.
 */
export function syntheticFixture(
  name: string,
  startCursor: number,
  utterances: string[][],
  notes?: string,
): ReplayFixture {
  const events: ReplayEvent[] = [];
  for (const utterance of utterances) {
    for (let n = 1; n <= utterance.length; n++) {
      events.push({ kind: 'partial', alternatives: [utterance.slice(0, n).join(' ')] });
    }
    events.push({ kind: 'final', alternatives: [utterance.join(' ')] });
    events.push({ kind: 'segment' });
  }
  return { name, startCursor, synthetic: true, notes, events };
}
