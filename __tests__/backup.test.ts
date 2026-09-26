/**
 * The backup format and the restore rules.
 *
 * Three kinds of test here.
 *
 * The ordinary kind checks the merge arithmetic. The HOSTILE kind feeds
 * `parseBackup` truncated files, other apps' JSON, hand-edited payloads and a
 * schema from the future, and pins that it returns a typed complaint rather than
 * throwing — this file is chosen by the user from their own storage with a
 * document picker, so "the input is a valid backup" is an assumption that has no
 * right to be made. The STRUCTURAL kind pins the promises: that a restore cannot
 * lose a review, that an entitlement never travels in a file the user can edit,
 * and that the file stays plain portable JSON. Those decay under pressure from
 * perfectly reasonable future requests, so they are assertions and not comments.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  BACKED_UP_KEYS,
  BACKUP_FORMAT,
  BACKUP_MIME,
  NEVER_BACKED_UP,
  SCHEMA_VERSION,
  SESSION_CAP,
  backupFilename,
  describeRestore,
  mergeCard,
  mergeDecks,
  parseBackup,
  planRestore,
  policyFor,
  serialiseBackup,
} from '../src/data/backup';
import { ALL_KEYS, MISTAKE_LOG_CAP, today, type LoggedSession } from '../src/data/storage';
import { DEFAULT_EASINESS, MIN_EASINESS, newCard, review, type HifzCard } from '../src/engine/hifz';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);

const K = {
  prefs: 'qh:prefs:v1',
  progress: 'qh:progress:v1',
  dismissed: 'qh:dismissed:v1',
  sessions: 'qh:sessions:v1',
  hifz: 'qh:hifz:v1',
  mistakes: 'qh:mistake-log:v1',
  onboarded: 'qh:onboarded:v1',
  entitlement: 'qh:entitlement:v1',
  prayerCache: 'qh:prayer-cache:v1',
} as const;

const card = (over: Partial<HifzCard> & { ayah: number }): HifzCard => ({
  ...newCard(over.ayah, T0),
  ...over,
});

const deckOf = (...cards: HifzCard[]): string =>
  JSON.stringify(Object.fromEntries(cards.map((c) => [String(c.ayah), c])));

const session = (id: string, at: number): LoggedSession => ({
  id,
  day: today(new Date(at)),
  at,
  surah: 2,
  wordsRecited: 20,
  versesCovered: 3,
  accuracy: 0.9,
  longestCleanRun: 12,
  hintsUsed: 0,
  mistakes: 1,
  durationMs: 60_000,
  furthestWord: 400,
});

const fileFrom = (values: Record<string, string>, now = T0): string =>
  serialiseBackup({ values, appVersion: '1.0.0', now });

/** The payload of a file made from `values`, as the restore path would see it. */
function payloadOf(values: Record<string, string>): Record<string, string> {
  const parsed = parseBackup(fileFrom(values));
  if (!parsed.ok) throw new Error(`expected a readable backup, got ${parsed.problem}`);
  return parsed.backup.payload;
}

// ---------------------------------------------------------------------------

describe('the envelope', () => {
  it('round-trips every key it is allowed to carry', () => {
    const values = {
      [K.hifz]: deckOf(card({ ayah: 5, reviews: 3 })),
      [K.prefs]: JSON.stringify({ theme: 'dark', reciter: 'x/' }),
      [K.sessions]: JSON.stringify([session('a', T0)]),
    };
    const parsed = parseBackup(fileFrom(values));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.payload).toEqual(values);
    expect(parsed.backup.schema).toBe(SCHEMA_VERSION);
    expect(parsed.backup.app).toBe('1.0.0');
    expect(parsed.backup.createdAt).toBe(T0);
    expect(parsed.warnings).toEqual([]);
  });

  it('declares its format, its schema and what it holds', () => {
    const envelope = JSON.parse(fileFrom({ [K.hifz]: '{}' })) as Record<string, unknown>;
    expect(envelope.format).toBe(BACKUP_FORMAT);
    expect(envelope.schema).toBe(SCHEMA_VERSION);
    expect(envelope.createdAt).toBe(T0);
    expect(envelope.keys).toEqual([K.hifz]);
  });

  it('names the file by the day it was made', () => {
    expect(backupFilename(T0)).toBe(`quran-habit-backup-${today(new Date(T0))}.json`);
  });

  it('omits a key storage had nothing for, rather than writing an empty one', () => {
    const payload = payloadOf({ [K.hifz]: '{}' });
    expect(Object.keys(payload)).toEqual([K.hifz]);
  });
});

describe('portability, because the phone being left behind may be the Android one', () => {
  // The most likely reason anybody ever needs this file is a new phone, and the
  // switch that loses everything is to an iPhone, where this app does not exist.
  // So the file has to be readable by something that is not this app.
  it('is plain JSON a stranger can read', () => {
    const text = fileFrom({ [K.prefs]: JSON.stringify({ reciter: 'yasser_ad-dussary/' }) });
    expect(() => JSON.parse(text) as unknown).not.toThrow();
    expect(BACKUP_MIME).toBe('application/json');
    // no base64, no compression, no length-prefixed anything
    expect(text).toMatch(/^\{\n/);
  });

  it('keeps Arabic as Arabic rather than escaping it', () => {
    // A person should be able to open this and see that it is theirs.
    const text = fileFrom({ [K.mistakes]: JSON.stringify([{ word: 1, expected: 'ٱلْحَمْدُ', heardInstead: '' }]) });
    expect(text).toContain('ٱلْحَمْدُ');
    expect(text).not.toContain('\\u0627');
  });
});

describe('what never travels in a backup', () => {
  it('never puts an entitlement in a file the user can edit', () => {
    // Plain JSON on the user's own storage means hand-editable. An entitlement
    // field would be a one-line unlock, and a stale one would revoke the coach
    // from somebody who is paying. Play is asked on launch and answers for free,
    // so there is nothing to carry and no field to forge.
    expect(NEVER_BACKED_UP).toContain(K.entitlement);
    expect(BACKED_UP_KEYS).not.toContain(K.entitlement);
    const text = fileFrom({
      [K.entitlement]: JSON.stringify({ plan: 'lifetime', goodUntil: null, checkedAt: T0, source: 'play' }),
      [K.hifz]: '{}',
    });
    expect(text).not.toContain('lifetime');
    expect(text).not.toContain(K.entitlement);
  });

  it('refuses an entitlement smuggled into a hand-edited file', () => {
    const forged = JSON.stringify({
      format: BACKUP_FORMAT,
      schema: SCHEMA_VERSION,
      app: '1.0.0',
      createdAt: T0,
      keys: [K.entitlement, K.hifz],
      payload: {
        [K.entitlement]: JSON.stringify({ plan: 'lifetime', goodUntil: null, checkedAt: T0, source: 'play' }),
        [K.hifz]: '{}',
      },
    });
    const parsed = parseBackup(forged);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.payload[K.entitlement]).toBeUndefined();
    expect(parsed.warnings).toContainEqual({ kind: 'ignored-keys', keys: [K.entitlement] });
    // and the plan would not write it either, even if a caller skipped parseBackup
    const plan = planRestore({}, { [K.entitlement]: 'anything' });
    expect(plan.values[K.entitlement]).toBeUndefined();
    expect(plan.summary.skipped).toContain(K.entitlement);
  });

  it('leaves caches out, because a cache restored is worse than a cache empty', () => {
    // Yesterday's prayer times for the city you have left are wrong answers, not
    // missing ones.
    expect(NEVER_BACKED_UP).toContain(K.prayerCache);
    expect(NEVER_BACKED_UP).toContain('qh:reciters:v1');
  });

  it('forces a decision about every key the app owns', () => {
    // A key added to storage.ts and forgotten here would default to `carry`,
    // which is safe but silent. This fails until somebody writes down what a
    // restore should do with it — the same failure mode ALL_KEYS itself exists
    // to prevent, one layer up.
    const source = readFileSync(join(__dirname, '..', 'src', 'data', 'backup.ts'), 'utf8');
    for (const key of ALL_KEYS) {
      expect(source).toContain(`'${key}':`);
    }
  });
});

describe('parseBackup, given something that is not a good backup', () => {
  // It never throws. Every one of these is a file a document picker can hand us.
  const cases: [string, string, string][] = [
    ['an empty file', '', 'empty'],
    ['whitespace only', '   \n ', 'empty'],
    ['a truncated file', '{"format":"quran-habit-backup","sche', 'not-json'],
    ['a photo, or anything else', '\u0000\u0001binary', 'not-json'],
    ['a bare array', '[1,2,3]', 'not-an-object'],
    ['a bare string', '"hello"', 'not-an-object'],
    ['null', 'null', 'not-an-object'],
    ['another app’s JSON', '{"format":"some-other-app","payload":{}}', 'not-a-backup'],
    ['ours, but with no payload', `{"format":"${BACKUP_FORMAT}","schema":1}`, 'not-a-backup'],
    ['ours, with a payload that is a string', `{"format":"${BACKUP_FORMAT}","payload":"x"}`, 'not-a-backup'],
    ['ours, with an unreadable version', `{"format":"${BACKUP_FORMAT}","schema":"one","payload":{}}`, 'not-a-backup'],
  ];

  for (const [name, text, problem] of cases) {
    it(`reports ${problem} for ${name}`, () => {
      const parsed = parseBackup(text);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.problem).toBe(problem);
      expect(parsed.detail.length).toBeGreaterThan(0);
    });
  }

  it('does not throw on any of them', () => {
    for (const [, text] of cases) expect(() => parseBackup(text)).not.toThrow();
  });

  it('refuses a schema from the future instead of guessing at it', () => {
    // A newer schema may have changed what a key's contents MEAN. Writing those
    // bytes in would hand storage.ts's defensive readers something they cannot
    // tell from corruption; they would degrade to defaults, and the restore would
    // delete the deck it was meant to save. Telling the user to update the app
    // is the only answer here that actually works.
    const parsed = parseBackup(
      JSON.stringify({ format: BACKUP_FORMAT, schema: SCHEMA_VERSION + 1, payload: { [K.hifz]: '{}' } }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problem).toBe('schema-too-new');
    expect(parsed.detail).toMatch(/newer version/i);
  });

  it('assumes schema 1 when the field is absent, rather than refusing a readable file', () => {
    const parsed = parseBackup(
      JSON.stringify({ format: BACKUP_FORMAT, payload: { [K.hifz]: deckOf(card({ ayah: 1, reviews: 1 })) } }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.schema).toBe(1);
    expect(parsed.warnings).toContainEqual({ kind: 'schema-assumed' });
  });

  it('never lets the file choose which storage keys get written', () => {
    // The envelope's `keys` list is advisory. Walking it would let a hand-edited
    // file write anything it liked into AsyncStorage.
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        schema: 1,
        keys: ['qh:hifz:v1', 'evil:token', '../../etc/passwd'],
        payload: { [K.hifz]: '{}', 'evil:token': 'sk-live', '../../etc/passwd': 'root' },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.backup.payload)).toEqual([K.hifz]);
    expect(parsed.warnings).toContainEqual({
      kind: 'foreign-keys',
      keys: ['../../etc/passwd', 'evil:token'],
    });
  });

  it('drops entries whose value is not a stored string', () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        schema: 1,
        payload: { [K.hifz]: { ayah: 1 }, [K.prefs]: '{}' },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.payload[K.hifz]).toBeUndefined();
    expect(parsed.warnings).toContainEqual({ kind: 'unreadable-keys', keys: [K.hifz] });
  });

  it('says so when the file promised a key it does not contain', () => {
    // What a half-written file looks like from the outside.
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        schema: 1,
        keys: [K.hifz, K.sessions],
        payload: { [K.hifz]: '{}' },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings).toContainEqual({ kind: 'incomplete', keys: [K.sessions] });
  });

  it('reports a file with nothing restorable in it', () => {
    const parsed = parseBackup(
      JSON.stringify({ format: BACKUP_FORMAT, schema: 1, payload: { [K.entitlement]: '{}' } }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problem).toBe('nothing-to-restore');
  });

  it('survives a payload value that is itself corrupt, restoring the rest', () => {
    const plan = planRestore(
      { [K.hifz]: deckOf(card({ ayah: 1, reviews: 2 })) },
      { [K.hifz]: '{"broken', [K.dismissed]: '[7]' },
    );
    expect(plan.summary.hifz.recovered).toBe(0);
    expect(plan.values[K.hifz]).toBeUndefined();
    expect(plan.values[K.dismissed]).toBe('[7]');
  });
});

describe('restore merges, and cannot lose a review', () => {
  it('keeps a month of work when an old backup is restored over it', () => {
    // THE regression this whole merge exists for: somebody uses the app for a
    // month, then opens a three-month-old file out of curiosity or by mistake.
    // Replace would destroy the month. There is no undo and no server.
    const month = [card({ ayah: 10, reviews: 8, lastReviewedAt: T0, dueAt: T0 + 5 * DAY })];
    const old = [card({ ayah: 10, reviews: 2, lastReviewedAt: T0 - 90 * DAY, dueAt: T0 - 80 * DAY })];
    const plan = planRestore({ [K.hifz]: deckOf(...month) }, { [K.hifz]: deckOf(...old) });

    expect(plan.summary.hifz).toEqual({ total: 1, added: 0, recovered: 0, kept: 1 });
    expect(plan.summary.losesNothing).toBe(true);
    // nothing changed, so nothing is written at all
    expect(plan.values[K.hifz]).toBeUndefined();
  });

  it('recovers ayahs the device has never seen', () => {
    const plan = planRestore(
      { [K.hifz]: deckOf(card({ ayah: 1, reviews: 1 })) },
      { [K.hifz]: deckOf(card({ ayah: 1, reviews: 1 }), card({ ayah: 2, reviews: 4 })) },
    );
    expect(plan.summary.hifz.added).toBe(1);
    expect(plan.summary.hifz.total).toBe(2);
    const deck = JSON.parse(plan.values[K.hifz]) as Record<string, HifzCard>;
    expect(deck['2'].reviews).toBe(4);
  });

  it('reports nothing to do for an identical file', () => {
    const values = { [K.hifz]: deckOf(card({ ayah: 3, reviews: 5 })), [K.dismissed]: '[1,2]' };
    const plan = planRestore(values, payloadOf(values));
    expect(plan.values).toEqual({});
    expect(plan.summary.losesNothing).toBe(true);
  });
});

describe('merging one ayah, which is the hard question', () => {
  it('takes the schedule whole from the more recently reviewed card', () => {
    // easiness/interval/dueAt only mean anything together: taking `intervalDays`
    // from one card and `dueAt` from the other invents a record that never
    // existed and schedules nonsense.
    const mine = card({ ayah: 4, reviews: 3, intervalDays: 3, dueAt: T0 + 3 * DAY, lastReviewedAt: T0, lastGrade: 4 });
    const theirs = card({
      ayah: 4,
      reviews: 3,
      intervalDays: 40,
      dueAt: T0 + 40 * DAY,
      lastReviewedAt: T0 - 30 * DAY,
      lastGrade: 5,
    });
    const { card: merged, winner } = mergeCard(mine, theirs);
    expect(winner).toBe('mine');
    expect(merged.intervalDays).toBe(3);
    expect(merged.dueAt).toBe(T0 + 3 * DAY);
    expect(merged.lastGrade).toBe(4);
  });

  it('lets the backup win when it holds the more recent review', () => {
    const mine = card({ ayah: 4, reviews: 1, lastReviewedAt: T0 - 60 * DAY, dueAt: T0 - 59 * DAY });
    const theirs = card({ ayah: 4, reviews: 2, lastReviewedAt: T0 - 2 * DAY, dueAt: T0 + DAY });
    const { winner, card: merged } = mergeCard(mine, theirs);
    expect(winner).toBe('theirs');
    expect(merged.dueAt).toBe(T0 + DAY);
  });

  it('takes the maximum of the history counters, never the sum', () => {
    // Restoring your own older file onto your own phone: the file's history is a
    // PREFIX of the device's, so summing would double-count every shared review
    // and inflate the lapse rate of every ayah the user ever struggled with.
    const mine = card({ ayah: 7, reviews: 10, lapses: 3, recitedReviews: 6, lastReviewedAt: T0 });
    const theirs = card({ ayah: 7, reviews: 4, lapses: 1, recitedReviews: 4, lastReviewedAt: T0 - 40 * DAY });
    const { card: merged } = mergeCard(mine, theirs);
    expect(merged.reviews).toBe(10);
    expect(merged.lapses).toBe(3);
    expect(merged.recitedReviews).toBe(6);
  });

  it('cannot un-hear a recitation that happened on the other phone', () => {
    // recitedReviews is what separates an ayah a recogniser heard from one the
    // user tapped a button about; hifz.ts caps the interval and the reported
    // strength of a card nothing has ever heard. Verification is a historical
    // fact, so it survives a merge with an unverified card that reviewed later.
    const tapped = review(newCard(9, T0 - 10 * DAY), 3, T0, 'self-report');
    const heard = review(newCard(9, T0 - 40 * DAY), 5, T0 - 30 * DAY, 'recited');
    const { card: merged, winner } = mergeCard(tapped, heard);
    expect(winner).toBe('mine');
    expect(merged.recitedReviews).toBe(1);
    expect(merged.lastSource).toBe('self-report');
  });

  it('resolves an absent recitedReviews to reviews, not to zero', () => {
    // A deck written before the self-report path existed has no such field, and
    // every review in it came from the recognizer because nothing else could
    // write one. Getting this default backwards would relabel a whole restored
    // deck as unverified.
    const legacy: HifzCard = {
      ayah: 11,
      easiness: DEFAULT_EASINESS,
      repetitions: 3,
      intervalDays: 10,
      dueAt: T0 + 10 * DAY,
      lastReviewedAt: T0 - 40 * DAY,
      lastGrade: 5,
      reviews: 7,
      lapses: 0,
    };
    const fresh = card({ ayah: 11, reviews: 1, recitedReviews: 0, lastReviewedAt: T0 });
    const { card: merged } = mergeCard(fresh, legacy);
    expect(merged.recitedReviews).toBe(7);
  });

  it('believes whichever device found the ayah harder', () => {
    // easiness is the long-run difficulty estimate rather than part of the
    // current schedule, and lowering it only shortens future intervals. Same
    // rule as hifz.ts: evidence may make a card harder, never easier.
    const mine = card({ ayah: 12, reviews: 5, easiness: 2.6, lastReviewedAt: T0 });
    const theirs = card({ ayah: 12, reviews: 5, easiness: 1.7, lastReviewedAt: T0 - DAY });
    expect(mergeCard(mine, theirs).card.easiness).toBeCloseTo(1.7);
    expect(mergeCard(mine, card({ ayah: 12, easiness: 0.2, reviews: 1 })).card.easiness).toBe(MIN_EASINESS);
  });

  it('lets any reviewed card beat an untouched one', () => {
    const untouched = newCard(13, T0 + 10 * DAY);
    const reviewed = card({ ayah: 13, reviews: 2, lastReviewedAt: T0 - 5 * DAY, dueAt: T0 });
    expect(mergeCard(untouched, reviewed).winner).toBe('theirs');
    expect(mergeCard(reviewed, untouched).winner).toBe('mine');
  });

  it('breaks a tie towards revising sooner', () => {
    // Indistinguishable evidence. Showing an ayah a week early costs thirty
    // seconds; showing it three months late costs the memorisation.
    const mine = card({ ayah: 14, reviews: 2, lastReviewedAt: T0, dueAt: T0 + 60 * DAY });
    const theirs = card({ ayah: 14, reviews: 2, lastReviewedAt: T0, dueAt: T0 + 2 * DAY });
    expect(mergeCard(mine, theirs).winner).toBe('theirs');
    expect(mergeCard(theirs, mine).winner).toBe('mine');
  });

  it('drops a card filed under a key that does not match its ayah', () => {
    // Hand-edited or corrupt, and not recoverable: dueQueue would report one
    // number while the deck is filed under another.
    const plan = planRestore({}, { [K.hifz]: JSON.stringify({ '5': card({ ayah: 900, reviews: 3 }) }) });
    expect(plan.summary.hifz.added).toBe(0);
    expect(plan.values[K.hifz]).toBeUndefined();
  });

  it('drops a card whose numbers are not numbers', () => {
    const plan = planRestore(
      {},
      { [K.hifz]: JSON.stringify({ '5': { ayah: 5, easiness: 'hard', reviews: 1 }, '6': card({ ayah: 6, reviews: 1 }) }) },
    );
    expect(plan.summary.hifz).toEqual({ total: 1, added: 1, recovered: 0, kept: 0 });
  });

  it('counts added, recovered and kept over a whole deck', () => {
    const mine = {
      '1': card({ ayah: 1, reviews: 4, lastReviewedAt: T0 }),
      '2': card({ ayah: 2, reviews: 1, lastReviewedAt: T0 - 50 * DAY }),
    };
    const theirs = {
      '2': card({ ayah: 2, reviews: 2, lastReviewedAt: T0 - DAY }),
      '3': card({ ayah: 3, reviews: 6, lastReviewedAt: T0 - 2 * DAY }),
    };
    expect(mergeDecks(mine, theirs).change).toEqual({ total: 3, added: 1, recovered: 1, kept: 1 });
  });
});

describe('the session log', () => {
  it('unions by id, because the union really is what happened', () => {
    const mine = [session('a', T0 - 2 * DAY), session('b', T0)];
    const theirs = [session('b', T0), session('c', T0 - 10 * DAY)];
    const plan = planRestore({ [K.sessions]: JSON.stringify(mine) }, { [K.sessions]: JSON.stringify(theirs) });
    expect(plan.summary.sessions.recovered).toBe(1);
    expect(plan.summary.sessions.merged).toBe(3);
    const merged = JSON.parse(plan.values[K.sessions]) as LoggedSession[];
    expect(merged.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('caps at the same length storage.ts trims to, and says how many fell off', () => {
    // If the restore wrote a longer list than logSession trims to, the next
    // session logged would silently drop the oldest ones — a data loss that
    // would look like a bug in the tracker.
    const storage = readFileSync(join(__dirname, '..', 'src', 'data', 'storage.ts'), 'utf8');
    expect(storage).toContain(`all.length - ${SESSION_CAP}`);

    const mine = Array.from({ length: SESSION_CAP }, (_, i) => session(`mine-${i}`, T0 - i * 1000));
    const theirs = Array.from({ length: 50 }, (_, i) => session(`old-${i}`, T0 - (10_000 + i) * 1000));
    const plan = planRestore({ [K.sessions]: JSON.stringify(mine) }, { [K.sessions]: JSON.stringify(theirs) });
    expect(plan.summary.sessions.merged).toBe(SESSION_CAP);
    expect(plan.summary.sessions.dropped).toBe(50);
    expect(plan.summary.losesNothing).toBe(false);
    // the newest survive: the ones dropped are the oldest in the union
    const merged = JSON.parse(plan.values[K.sessions]) as LoggedSession[];
    expect(merged.some((s) => s.id === 'mine-0')).toBe(true);
  });

  it('ignores entries that are not sessions', () => {
    const plan = planRestore({}, { [K.sessions]: JSON.stringify([null, 3, { id: 7 }, session('a', T0)]) });
    expect(plan.summary.sessions.merged).toBe(1);
  });
});

describe('the mistake log, which has no ids to merge by', () => {
  const m = (word: number, heard = 'x') => ({ word, expected: 'ٱلْحَمْدُ', heardInstead: heard });

  it('does not inflate a pattern by restoring a file that overlaps', () => {
    // No ids and no timestamps: two identical records are indistinguishable from
    // one record counted twice. Concatenating would make buildProfile recommend
    // drills for mistakes that were made once.
    const mine = [m(1), m(1), m(2)];
    const plan = planRestore(
      { [K.mistakes]: JSON.stringify(mine) },
      { [K.mistakes]: JSON.stringify([m(1), m(1)]) },
    );
    expect(plan.summary.mistakes.recovered).toBe(0);
    expect(plan.values[K.mistakes]).toBeUndefined();
  });

  it('recovers only the surplus of each pattern', () => {
    const plan = planRestore(
      { [K.mistakes]: JSON.stringify([m(1)]) },
      { [K.mistakes]: JSON.stringify([m(1), m(1), m(1), m(2)]) },
    );
    expect(plan.summary.mistakes.recovered).toBe(3);
    expect(plan.summary.mistakes.merged).toBe(4);
  });

  it('puts recovered records in front, so the cap trims the oldest history', () => {
    const mine = Array.from({ length: MISTAKE_LOG_CAP }, (_, i) => m(1000 + i));
    const plan = planRestore(
      { [K.mistakes]: JSON.stringify(mine) },
      { [K.mistakes]: JSON.stringify([m(1), m(2)]) },
    );
    const merged = JSON.parse(plan.values[K.mistakes]) as { word: number }[];
    expect(merged.length).toBe(MISTAKE_LOG_CAP);
    expect(plan.summary.mistakes.dropped).toBe(2);
    // the device's most recent mistakes survive; the recovered old ones are cut
    expect(merged[merged.length - 1].word).toBe(1000 + MISTAKE_LOG_CAP - 1);
  });

  it('tells apart two mistakes on the same word', () => {
    const plan = planRestore(
      { [K.mistakes]: JSON.stringify([m(1, 'a')]) },
      { [K.mistakes]: JSON.stringify([m(1, 'a'), m(1, 'b')]) },
    );
    expect(plan.summary.mistakes.recovered).toBe(1);
  });
});

describe('the smaller keys', () => {
  it('unions dismissed false mistakes, so a decision is never made twice', () => {
    const plan = planRestore({ [K.dismissed]: '[3,1]' }, { [K.dismissed]: '[1,9]' });
    expect(plan.values[K.dismissed]).toBe('[1,3,9]');
    expect(plan.summary.dismissed.recovered).toBe(1);
  });

  it('keeps the more recent reading position per surah', () => {
    const plan = planRestore(
      { [K.progress]: JSON.stringify({ '2': { cursor: 50, at: T0 } }) },
      {
        [K.progress]: JSON.stringify({
          '2': { cursor: 900, at: T0 - DAY },
          '18': { cursor: 12, at: T0 - 5 * DAY },
        }),
      },
    );
    const merged = JSON.parse(plan.values[K.progress]) as Record<string, { cursor: number }>;
    expect(merged['2'].cursor).toBe(50);
    expect(merged['18'].cursor).toBe(12);
    expect(plan.summary.progress).toEqual({ total: 2, added: 1, recovered: 0, kept: 1 });
  });

  it('restores onboarding onto a fresh install and never un-sets it', () => {
    expect(policyFor(K.onboarded)).toBe('carry');
    expect(planRestore({}, { [K.onboarded]: '1' }).summary.onboardingCarried).toBe(true);
    expect(planRestore({ [K.onboarded]: '1' }, {}).values[K.onboarded]).toBeUndefined();
  });

  it('carries an unrecognised future key only where nothing exists', () => {
    // The default is non-destructive on purpose: a key nobody has thought about
    // yet must not be able to overwrite live data.
    expect(policyFor('qh:something-new:v1')).toBe('carry');
  });
});

describe('settings, the one thing a restore overwrites', () => {
  it('replaces them, and says so before anything is written', () => {
    // The deliberate exception. There is no meaningful merge of two theme
    // choices, and the cost of getting it wrong is ten seconds of re-picking a
    // reciter — nothing like losing a month of hifz.
    const current = { [K.prefs]: JSON.stringify({ theme: 'dark', reciter: 'a/' }) };
    const incoming = { [K.prefs]: JSON.stringify({ theme: 'light', reciter: 'b/' }) };
    const summary = describeRestore(current, incoming);
    expect(summary.settingsReplaced).toBe(true);
    expect(summary.losesNothing).toBe(false);
    expect(planRestore(current, incoming).values[K.prefs]).toBe(incoming[K.prefs]);
  });

  it('does not call identical settings a replacement', () => {
    const same = { [K.prefs]: JSON.stringify({ theme: 'dark' }) };
    expect(describeRestore(same, same).settingsReplaced).toBe(false);
    expect(describeRestore(same, same).losesNothing).toBe(true);
  });
});

describe('describeRestore, which the UI must call first', () => {
  it('answers in counts, without writing anything', () => {
    const current = {
      [K.hifz]: deckOf(card({ ayah: 1, reviews: 9, lastReviewedAt: T0 })),
      [K.sessions]: JSON.stringify([session('a', T0)]),
    };
    const incoming = {
      [K.hifz]: deckOf(card({ ayah: 1, reviews: 2, lastReviewedAt: T0 - 90 * DAY }), card({ ayah: 2, reviews: 3 })),
      [K.sessions]: JSON.stringify([session('a', T0), session('b', T0 - 90 * DAY)]),
      [K.prayerCache]: '{"day":"2026-01-01"}',
    };
    const summary = describeRestore(current, incoming);
    expect(summary.hifz).toEqual({ total: 2, added: 1, recovered: 0, kept: 1 });
    expect(summary.sessions.recovered).toBe(1);
    expect(summary.skipped).toEqual([K.prayerCache]);
    expect(summary.losesNothing).toBe(true);
    expect(summary).toEqual(planRestore(current, incoming).summary);
  });

  it('is honest about an empty file and an empty device', () => {
    const summary = describeRestore({}, {});
    expect(summary.losesNothing).toBe(true);
    expect(summary.hifz.total).toBe(0);
    expect(planRestore({}, {}).values).toEqual({});
  });

  it('describes a fresh install restoring everything', () => {
    const file = payloadOf({
      [K.hifz]: deckOf(card({ ayah: 1, reviews: 4 }), card({ ayah: 2, reviews: 2 })),
      [K.sessions]: JSON.stringify([session('a', T0), session('b', T0 - DAY)]),
      [K.dismissed]: '[4]',
      [K.prefs]: JSON.stringify({ theme: 'dark' }),
      [K.onboarded]: '1',
    });
    const summary = describeRestore({}, file);
    expect(summary.hifz).toEqual({ total: 2, added: 2, recovered: 0, kept: 0 });
    expect(summary.sessions.merged).toBe(2);
    expect(summary.dismissed.recovered).toBe(1);
    expect(summary.onboardingCarried).toBe(true);
    // A fresh device has no settings of its own, so nothing is overwritten and
    // the confirmation screen can say plainly that this cannot cost anything.
    expect(summary.settingsReplaced).toBe(false);
    expect(summary.losesNothing).toBe(true);
    expect(Object.keys(planRestore({}, file).values).sort()).toEqual(
      [K.dismissed, K.hifz, K.onboarded, K.prefs, K.sessions].sort(),
    );
  });
});

/**
 * Reachability.
 *
 * This module was committed complete, tested, and wired to NOTHING: 956 lines
 * and 59 tests that no user could ever reach, because the screen that would
 * call it was another engineer's file and never got written. All the tests
 * passed the whole time, which is exactly why they did not catch it — a pure
 * module is perfectly testable while being perfectly useless.
 *
 * So this asserts the one thing the other tests structurally cannot: that
 * something a person can actually tap leads here.
 */
describe('a user can actually reach this', () => {
  const settings = readFileSync(join(__dirname, '..', 'app', 'settings.tsx'), 'utf8');

  it('is wired to a screen', () => {
    expect(settings).toContain('data/backupFile');
    expect(settings).toMatch(/shareBackup/);
    expect(settings).toMatch(/pickBackupFile/);
  });

  it('plans the restore before writing it', () => {
    // planRestore must be reached from the screen, and importAll must not be
    // called from the same function that picks the file. The gap between them
    // is the confirmation step, and it is the whole reason restore is not
    // destructive by accident.
    expect(settings).toContain('planRestore');
    expect(settings).toContain('importAll');
    const pick = settings.slice(settings.indexOf('const doPick'), settings.indexOf('const confirm'));
    expect(pick).toContain('planRestore');
    expect(pick).not.toContain('importAll');
  });

  it('explains every way a file can be refused', () => {
    // A parse problem the screen does not name falls through to a raw `detail`
    // string, which is written for a developer, not for somebody who just lost
    // their phone.
    for (const problem of [
      'empty',
      'not-json',
      'not-an-object',
      'not-a-backup',
      'schema-too-new',
      'nothing-to-restore',
    ]) {
      expect(settings).toContain(`'${problem}'`);
    }
  });
});
