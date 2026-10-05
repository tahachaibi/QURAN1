/**
 * Restoring into a running app, and the session log a restore merges into.
 *
 * THE REGRESSION: a restore wrote storage and stopped there. The settings and
 * the hifz deck are each held in memory by a provider that writes its WHOLE
 * copy back on the next change, so the first toggle, or the first recitation
 * folded, after a restore put the pre-restore copy straight back — and every
 * card the restore had just brought back was gone. `restoreAll` is the one door
 * a restore goes through, and these pin what it promises whoever holds a copy.
 *
 * The deck holder below is a stand-in for RecitationProvider, written the way
 * the provider's own writes are: a copy in memory, every write queued on one
 * chain. It is what the provider has to do to take part.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { planRestore, SESSION_CAP } from '../src/data/backup';
import {
  holdAcrossRestores,
  loadSessions,
  logSession,
  restoreAll,
  today,
  type LoggedSession,
  type RestoreHolder,
} from '../src/data/storage';
import { newCard, review, type HifzDeck } from '../src/engine/hifz';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);
const DECK = 'qh:hifz:v1';
const SESSIONS = 'qh:sessions:v1';

const deckOf = (...ayahs: number[]): HifzDeck =>
  Object.fromEntries(ayahs.map((a) => [String(a), review(newCard(a, T0), 5, T0)]));

const storedDeck = async (): Promise<string[]> =>
  Object.keys(JSON.parse((await AsyncStorage.getItem(DECK)) ?? '{}') as HifzDeck).sort();

const row = (id: string, wordsRecited: number, at = T0): LoggedSession => ({
  id,
  day: today(new Date(at)),
  at,
  surah: 1,
  wordsRecited,
  versesCovered: 1,
  accuracy: 1,
  longestCleanRun: wordsRecited,
  hintsUsed: 0,
  mistakes: 0,
  durationMs: 60_000,
  furthestWord: wordsRecited,
});

/** RecitationProvider in miniature: a deck in memory, every write on one chain. */
function deckHolder() {
  let deck: HifzDeck = {};
  let chain: Promise<void> = Promise.resolve();
  const queue = (run: () => Promise<void>): Promise<void> => {
    const next = chain.then(run, run);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const reload = async (): Promise<void> => {
    deck = JSON.parse((await AsyncStorage.getItem(DECK)) ?? '{}') as HifzDeck;
  };
  return {
    load: () => queue(reload),
    /** a fold: read-modify-write of the copy in memory, saved whole */
    fold: (ayah: number) =>
      queue(async () => {
        deck = { ...deck, ...deckOf(ayah) };
        await AsyncStorage.setItem(DECK, JSON.stringify(deck));
      }),
    /** the part a provider has to add: the restore on its chain, then a re-read */
    holder: ((write) =>
      queue(async () => {
        await write();
        await reload();
      })) as RestoreHolder,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('restoring into the running app', () => {
  it('keeps what it restored when the holder writes its copy back afterwards', async () => {
    await AsyncStorage.setItem(DECK, JSON.stringify(deckOf(1)));
    const provider = deckHolder();
    await provider.load();
    const release = holdAcrossRestores(provider.holder);
    try {
      const file = { [DECK]: JSON.stringify(deckOf(2)) };
      await restoreAll((current) => planRestore(current, file).values);
      // the very next thing the user does: recite, and the deck is saved whole
      await provider.fold(3);
      expect(await storedDeck()).toEqual(['1', '2', '3']);
    } finally {
      release();
    }
  });

  it('lets a write already in flight land first, then plans on top of it', async () => {
    // A fold racing the restore: queued on the holder's chain before the
    // restore was, so it lands first — and the plan, made inside the wrap,
    // sees it instead of writing over it.
    await AsyncStorage.setItem(DECK, JSON.stringify(deckOf(1)));
    const provider = deckHolder();
    await provider.load();
    const release = holdAcrossRestores(provider.holder);
    try {
      const file = { [DECK]: JSON.stringify(deckOf(2)) };
      const folding = provider.fold(3);
      await restoreAll((current) => planRestore(current, file).values);
      await folding;
      await provider.fold(4);
      expect(await storedDeck()).toEqual(['1', '2', '3', '4']);
    } finally {
      release();
    }
  });

  it('plans from storage as it is when it writes, not when the file was picked', async () => {
    await AsyncStorage.setItem(DECK, JSON.stringify(deckOf(1)));
    const file = { [DECK]: JSON.stringify(deckOf(2)) };
    // the confirmation is on screen; meanwhile a recitation is saved
    await AsyncStorage.setItem(DECK, JSON.stringify(deckOf(1, 3)));
    const outcome = await restoreAll((current) => planRestore(current, file).values);
    expect(outcome).toEqual({ planned: 1, restored: [DECK] });
    expect(await storedDeck()).toEqual(['1', '2', '3']);
  });

  it('reports a backup with nothing new in it as nothing planned, and writes nothing', async () => {
    await AsyncStorage.setItem(DECK, JSON.stringify(deckOf(1)));
    const file = { [DECK]: JSON.stringify(deckOf(1)) };
    const setItem = AsyncStorage.setItem as jest.Mock;
    setItem.mockClear();
    expect(await restoreAll((current) => planRestore(current, file).values)).toEqual({ planned: 0, restored: [] });
    expect(setItem).not.toHaveBeenCalled();
  });

  it('runs the write exactly once, inside every holder', async () => {
    const order: string[] = [];
    const outer: RestoreHolder = async (write) => {
      order.push('outer in');
      await write();
      await write(); // a confused holder must not write twice
      order.push('outer out');
    };
    const inner: RestoreHolder = async (write) => {
      order.push('inner in');
      await write();
      order.push('inner out');
    };
    const releases = [holdAcrossRestores(outer), holdAcrossRestores(inner)];
    try {
      let plans = 0;
      await restoreAll(() => {
        plans++;
        order.push('write');
        return { [DECK]: '{}' };
      });
      expect(plans).toBe(1);
      expect(order).toEqual(['outer in', 'inner in', 'write', 'inner out', 'outer out']);
    } finally {
      releases.forEach((release) => release());
    }
  });

  it('does not let a holder that never runs the write swallow the restore', async () => {
    const release = holdAcrossRestores(async () => undefined);
    try {
      const outcome = await restoreAll(() => ({ [DECK]: '{}' }));
      expect(outcome.restored).toEqual([DECK]);
    } finally {
      release();
    }
  });

  it('stops wrapping restores once a holder lets go', async () => {
    const holder = jest.fn<Promise<void>, [() => Promise<void>]>((write) => write());
    holdAcrossRestores(holder)();
    await restoreAll(() => ({ [DECK]: '{}' }));
    expect(holder).not.toHaveBeenCalled();
  });
});

describe('one row per session', () => {
  it('replaces the row a session supersedes, in its place', async () => {
    await logSession(row('a', 10));
    await logSession(row('b', 5));
    await logSession(row('a', 200)); // the backgrounded session, finished later
    expect((await loadSessions()).map((s) => [s.id, s.wordsRecited])).toEqual([
      ['a', 200],
      ['b', 5],
    ]);
  });

  it('counts sessions against the cap, not the copies a session left behind', async () => {
    // Every superseded copy used to take a place under the cap, so the oldest
    // days fell off long before the history was really full — and with them
    // the start of a long streak.
    const full = Array.from({ length: SESSION_CAP }, (_, i) => row(`s${i}`, 1, T0 + i * 1000));
    await AsyncStorage.setItem(SESSIONS, JSON.stringify(full));
    const newest = `s${SESSION_CAP - 1}`;
    await logSession(row(newest, 50, T0 + (SESSION_CAP - 1) * 1000));
    await logSession(row(newest, 80, T0 + (SESSION_CAP - 1) * 1000));
    const stored = await loadSessions();
    expect(stored).toHaveLength(SESSION_CAP);
    expect(stored[0].id).toBe('s0');
    expect(stored[stored.length - 1]).toMatchObject({ id: newest, wordsRecited: 80 });
  });
});
