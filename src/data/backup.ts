/**
 * The backup file format, and the rules about what restoring one does.
 *
 * The app has no backend and no account, so an uninstall, a lost phone or a new
 * phone takes the hifz deck, the streak, the mistake history and every reading
 * position with it — months of work, with nothing anywhere to recover from.
 * That is the worst consequence of the no-server promise, and a file the user
 * holds is the honest answer to it. `src/data/storage.ts` already knows how to
 * read and write every key; this file decides what goes in the file, what comes
 * back out of it, and what happens when the two disagree.
 *
 * Everything here is PURE and clock-injected, like src/engine/hifz.ts and
 * src/billing/entitlement.ts: plain objects in, plain objects out, no
 * AsyncStorage, no file system, no `Date.now()`. The device-side plumbing is
 * `exportAll` / `importAll` in storage.ts, and the UI is somebody else's file.
 *
 * PORTABILITY IS A REQUIREMENT, NOT A NICETY. The single most likely reason
 * somebody needs this file is switching phones, and the switch that loses
 * everything is the one to an iPhone, where this app does not exist. So the file
 * is plain UTF-8 JSON with no Android-specific encoding, no base64, no binary
 * and no compression — readable in a text editor on any machine, and parseable
 * by whatever eventually has to read it. The Arabic in it is left as literal
 * characters rather than \u escapes for the same reason: a person should be able
 * to open this and see that it is theirs.
 */

import { MIN_EASINESS, recitedReviewsOf, type HifzCard, type HifzDeck } from '../engine/hifz';
import type { MistakeRecord } from '../engine/confusion';
import { ALL_KEYS, MISTAKE_LOG_CAP, type LoggedSession, type ProgressMap } from './storage';

// ---------------------------------------------------------------------------
// the envelope
// ---------------------------------------------------------------------------

/**
 * Stamped on every file so a reader can tell a Quran Habit backup from some
 * other app's JSON before it does anything with it. Never change this string.
 */
export const BACKUP_FORMAT = 'quran-habit-backup';

/**
 * The version of the ENVELOPE and of the meaning of the payload's keys — not
 * the app version.
 *
 * WHEN TO BUMP IT: only when the meaning of an existing key's stored value
 * changes in a way a restore could get wrong — a re-keyed hifz deck, a changed
 * unit, a field that used to mean something else. Adding a new key does not need
 * a bump: an older build simply will not know that key and will drop it, and a
 * newer build reading an older file just finds it missing. That asymmetry is the
 * whole reason storage keys carry their own `:v1` suffix.
 *
 * WHAT A FUTURE READER MUST DO:
 *  - schema OLDER than this build's: read it, and migrate. Add the migration to
 *    `migratePayload` below. Never refuse an old file — the whole point of a
 *    backup is that it is read by a build that did not exist when it was made,
 *    and somebody restoring a two-year-old file is exactly the person this
 *    feature is for.
 *  - schema ABSENT: treat it as 1. Only version 1 could ever have shipped
 *    without the field, and every value is re-validated on the way in anyway.
 *  - schema NEWER: refuse, and say so. This is the one refusal here, and it is
 *    deliberate: a newer schema may have changed what a key's contents mean, and
 *    writing those bytes into this build's storage would hand the defensive
 *    readers in storage.ts something they cannot tell from corruption. They would
 *    quietly degrade to defaults — which is to say, the restore would silently
 *    delete the deck it was supposed to save. Refusing tells the user to update
 *    the app, which actually works.
 */
export const SCHEMA_VERSION = 1;

/** What a backup file contains, once. */
export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  schema: number;
  /** the app version that wrote it, for a human reading the file or a bug report */
  app: string;
  /** epoch ms the file was made; shown to the user before they overwrite anything */
  createdAt: number;
  /**
   * Which keys the payload holds.
   *
   * ADVISORY ONLY. It is here so a person (or a support conversation) can see at
   * a glance what a file contains without reading the payload. `parseBackup`
   * never uses it to decide what to write — see the note there.
   */
  keys: string[];
  /**
   * Storage key -> the raw stored string, exactly as AsyncStorage held it.
   *
   * Raw strings rather than re-parsed values, matching `exportAll`: a copy that
   * re-serialises is a copy that can quietly change something.
   */
  payload: Record<string, string>;
}

/** Suggested filename. Dated, because the date is the thing a user chooses by. */
export function backupFilename(now: number): string {
  const d = new Date(now);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `quran-habit-backup-${yyyy}-${mm}-${dd}.json`;
}

/** Plain JSON, and nothing cleverer. See the portability note at the top. */
export const BACKUP_MIME = 'application/json';

// ---------------------------------------------------------------------------
// what is backed up, and what restoring each key does
// ---------------------------------------------------------------------------

/**
 * What a restore does with one key.
 *
 * `skip` means the key is neither written into a backup nor read out of one.
 * Everything else names how the file's value is combined with what is already
 * on the device.
 */
export type KeyPolicy =
  | 'skip'
  | 'replace'
  | 'carry'
  | 'merge-hifz'
  | 'merge-sessions'
  | 'merge-mistakes'
  | 'merge-progress'
  | 'merge-dismissed';

/**
 * Per-key policy, and the argument for each one.
 *
 * Keys are written out in full rather than derived, because the POINT of this
 * table is that somebody had to think about each one. A key in storage.ts with
 * no entry here defaults to `carry` — non-destructive — and a test fails until
 * whoever added it makes a decision.
 */
const POLICY: Readonly<Record<string, KeyPolicy>> = {
  /**
   * Settings are the one thing replaced outright, and this is the deliberate
   * exception to the merge rule below. A person restoring onto a new phone wants
   * their reciter, their theme, their prayer offsets and their per-prayer bells
   * back; there is no meaningful "merge" of two theme choices. And the cost of
   * getting it wrong is bounded in a way nothing else here is: somebody who
   * restores an old file and finds the wrong reciter selected fixes it in ten
   * seconds. Losing a month of hifz is not like that.
   *
   * storage.ts's `readJson` spreads the stored object over DEFAULT_PREFS, so a
   * preference added since the file was written keeps its default rather than
   * becoming undefined. That is what makes replacing safe across versions.
   *
   * Note for the UI: `addedAdhans` inside prefs holds file:// URIs into the old
   * device's app sandbox. Those paths do not exist on a new phone. The entries
   * survive the restore and the recordings do not, and `selectedAdhan` already
   * falls back to a built-in rather than going silent, so the failure is a
   * missing custom adhan and not a missing Fajr. Copying the audio itself would
   * mean base64 in the file, which breaks the plain-JSON promise for the sake of
   * a file the user still has on their old phone.
   */
  'qh:prefs:v1': 'replace',

  /** Per-surah resume positions: per surah, the later read wins. Nothing is lost. */
  'qh:progress:v1': 'merge-progress',

  /**
   * Permanently dismissed false mistakes: union. A dismissal is a decision the
   * user made once and should never have to make twice, and a union cannot
   * resurrect one they already silenced.
   */
  'qh:dismissed:v1': 'merge-dismissed',

  /** Session log: union by id. See `mergeSessions`. */
  'qh:sessions:v1': 'merge-sessions',

  /** The deck. The hard one — see `mergeCard`. */
  'qh:hifz:v1': 'merge-hifz',

  /** Mistake history, which has no ids to merge by. See `mergeMistakes`. */
  'qh:mistake-log:v1': 'merge-mistakes',

  /**
   * Restore it if this device has never been onboarded, never un-set it. A
   * plain '1', not JSON, which is why it cannot be merged like the rest.
   */
  'qh:onboarded:v1': 'carry',

  /**
   * Retired: it held per-day prayer check-offs and nothing reads it any more
   * (see storage.ts). Backing up a dead key would only carry it forward forever.
   */
  'qh:streak:v1': 'skip',

  /**
   * A cache of one day's prayer times for one location. Restoring it onto a new
   * phone in a different city would show the wrong times until the next fetch,
   * which is worse than showing none. It refills by itself.
   */
  'qh:prayer-cache:v1': 'skip',

  /** A fetched list that refills itself; there is no user data in it. */
  'qh:reciters:v1': 'skip',

  /**
   * Today's dhikr tallies, stamped with today's date. A restored tally from
   * another day reads as zero anyway, so carrying it is pure noise.
   */
  'qh:adhkar:v1': 'skip',

  /**
   * NEVER. A purchase is not a file.
   *
   * This file is plain JSON on the user's own storage and is meant to be — so
   * anything in it can be hand-edited in a text editor. An entitlement written
   * into a backup is a one-line unlock for anybody who opens it, and, worse in
   * the other direction, restoring a stale "not entitled" record would take the
   * coach away from somebody who is paying for it. Google Play is the only thing
   * that knows, it is asked on launch, and it answers for free. There is nothing
   * to back up here, so the key never reaches the file at all: the honest way to
   * stop a forged entitlement is to not have a field to forge.
   */
  'qh:entitlement:v1': 'skip',
};

/** `carry` by default: an unrecognised key is restored only where nothing exists. */
export const policyFor = (key: string): KeyPolicy => POLICY[key] ?? 'carry';

/** Keys this app owns that deliberately never enter a backup file. */
export const NEVER_BACKED_UP: readonly string[] = ALL_KEYS.filter((k) => policyFor(k) === 'skip');

/** Keys a backup file may carry. Derived, so the two lists cannot drift apart. */
export const BACKED_UP_KEYS: readonly string[] = ALL_KEYS.filter((k) => policyFor(k) !== 'skip');

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

export interface BackupInput {
  /** exactly what `exportAll()` returned */
  values: Record<string, string>;
  /** the running app version, from the caller — this module reads no globals */
  appVersion: string;
  /** epoch ms */
  now: number;
}

/**
 * Build the file. Pure: hand it `exportAll()`'s result and a clock reading.
 *
 * Two-space indentation is not decoration. This file is the user's only copy of
 * their own data and it should be legible to them, and to whoever has to help
 * them with it. It costs a few kilobytes on a file that is measured in tens.
 */
export function serialiseBackup(input: BackupInput): string {
  const payload: Record<string, string> = {};
  for (const key of BACKED_UP_KEYS) {
    const raw = input.values[key];
    if (typeof raw === 'string') payload[key] = raw;
  }
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    schema: SCHEMA_VERSION,
    app: input.appVersion,
    createdAt: input.now,
    keys: Object.keys(payload).sort(),
    payload,
  };
  return JSON.stringify(envelope, null, 2);
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/** Why a file could not be read, in terms the UI can put in a sentence. */
export type BackupProblem =
  /** nothing, or only whitespace — a zero-byte file, or a failed copy */
  | 'empty'
  /** not JSON at all: truncated mid-write, or the user picked a photo */
  | 'not-json'
  /** valid JSON, but not an object — a bare array, string or number */
  | 'not-an-object'
  /** JSON, an object, but not one of ours */
  | 'not-a-backup'
  /** ours, but written by a newer build whose keys may mean something else */
  | 'schema-too-new'
  /** ours, readable, but there is nothing in it this build can restore */
  | 'nothing-to-restore';

/** Something odd that did not stop the read, but that the user should be told. */
export type BackupWarning =
  /** the file omitted `schema`; assumed to be 1 */
  | { kind: 'schema-assumed' }
  /** the file was written by an older schema and was migrated on the way in */
  | { kind: 'migrated'; from: number }
  /** keys this app does not own, dropped without being looked at */
  | { kind: 'foreign-keys'; keys: string[] }
  /** keys this build deliberately does not restore (see POLICY) */
  | { kind: 'ignored-keys'; keys: string[] }
  /** entries whose value was not a string, so cannot be a stored value */
  | { kind: 'unreadable-keys'; keys: string[] }
  /** `keys` promised something the payload does not contain */
  | { kind: 'incomplete'; keys: string[] };

export interface ParsedBackup {
  /** the schema the file declared (or 1, if it declared none) */
  schema: number;
  /** the app version that wrote it; '' when the file did not say */
  app: string;
  /** epoch ms, or 0 when the file did not say or said something absurd */
  createdAt: number;
  /**
   * Only keys this app owns AND this build restores, with string values.
   * Safe to hand to `describeRestore` / `planRestore` / `importAll`.
   */
  payload: Record<string, string>;
}

export type BackupParse =
  | { ok: true; backup: ParsedBackup; warnings: BackupWarning[] }
  | { ok: false; problem: BackupProblem; detail: string };

const fail = (problem: BackupProblem, detail: string): BackupParse => ({ ok: false, problem, detail });

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Bring an older payload up to the current schema.
 *
 * Empty today, because there has only ever been one schema. It exists as the
 * named place for the next person to put a migration, so the answer to "where
 * does old-file handling go" is not "wherever".
 */
function migratePayload(payload: Record<string, string>, _from: number): Record<string, string> {
  return payload;
}

/**
 * Read a file. Hostile-input safe: this NEVER throws and NEVER trusts the file.
 *
 * The load-bearing rule is the last one. The envelope carries a `keys` list, and
 * it would be natural to walk it — that is exactly the bug. A hand-edited or
 * malicious file would then choose which storage keys get written, and the app
 * would obligingly write them. So the walk is over `BACKED_UP_KEYS`, this
 * build's own list, and the file only ever gets to supply VALUES for keys this
 * app already owns. `importAll` applies the same rule again on the way to disk;
 * that duplication is intentional, because it is the kind of check that must not
 * depend on the caller having done it.
 *
 * Values are not parsed or validated here beyond being strings. They do not need
 * to be: every reader in storage.ts degrades a corrupt value to its default, and
 * the merge functions below re-validate everything they touch. Rejecting a whole
 * backup because one key's JSON is malformed would throw away the other eight.
 */
export function parseBackup(text: string): BackupParse {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return fail('empty', 'The file is empty.');
  }

  let root: unknown;
  try {
    root = JSON.parse(text) as unknown;
  } catch {
    // Much the commonest real cause is a truncated file: a copy interrupted, or
    // a share that never finished writing.
    return fail('not-json', 'This file is not readable as JSON. It may be incomplete.');
  }

  if (!isObject(root)) return fail('not-an-object', 'This file does not look like a backup.');
  if (root.format !== BACKUP_FORMAT) {
    return fail('not-a-backup', 'This file was not made by Quran Habit.');
  }

  const warnings: BackupWarning[] = [];

  let schema: number;
  if (root.schema === undefined || root.schema === null) {
    schema = 1;
    warnings.push({ kind: 'schema-assumed' });
  } else if (typeof root.schema !== 'number' || !Number.isFinite(root.schema)) {
    return fail('not-a-backup', 'This file says it is a backup but its version is unreadable.');
  } else {
    schema = Math.trunc(root.schema);
  }

  if (schema > SCHEMA_VERSION) {
    // Deliberate refusal. See SCHEMA_VERSION.
    return fail(
      'schema-too-new',
      'This backup was made by a newer version of Quran Habit. Update the app, then restore it.',
    );
  }

  const rawPayload = isObject(root.payload) ? root.payload : null;
  if (rawPayload === null) {
    return fail('not-a-backup', 'This backup has no data in it.');
  }

  const owned = new Set<string>(ALL_KEYS);
  const restorable = new Set<string>(BACKED_UP_KEYS);
  const foreign: string[] = [];
  const ignored: string[] = [];
  const unreadable: string[] = [];

  for (const key of Object.keys(rawPayload)) {
    if (!owned.has(key)) foreign.push(key);
    else if (!restorable.has(key)) ignored.push(key);
    else if (typeof rawPayload[key] !== 'string') unreadable.push(key);
  }

  // NOTE the direction of this loop: over OUR keys, not the file's.
  let payload: Record<string, string> = {};
  for (const key of BACKED_UP_KEYS) {
    const value = rawPayload[key];
    if (typeof value === 'string') payload[key] = value;
  }

  if (schema < SCHEMA_VERSION) {
    payload = migratePayload(payload, schema);
    warnings.push({ kind: 'migrated', from: schema });
  }

  if (foreign.length > 0) warnings.push({ kind: 'foreign-keys', keys: foreign.sort() });
  if (ignored.length > 0) warnings.push({ kind: 'ignored-keys', keys: ignored.sort() });
  if (unreadable.length > 0) warnings.push({ kind: 'unreadable-keys', keys: unreadable.sort() });

  // The advisory `keys` list, used for the one thing it is good for: telling the
  // user that the file promised something it does not actually contain, which is
  // what a half-written file looks like from the outside.
  if (Array.isArray(root.keys)) {
    const missing = root.keys.filter(
      (k): k is string => typeof k === 'string' && restorable.has(k) && payload[k] === undefined,
    );
    if (missing.length > 0) warnings.push({ kind: 'incomplete', keys: missing.sort() });
  }

  if (Object.keys(payload).length === 0) {
    return fail('nothing-to-restore', 'This backup holds nothing this version of the app can restore.');
  }

  const createdAt =
    typeof root.createdAt === 'number' && Number.isFinite(root.createdAt) && root.createdAt > 0
      ? root.createdAt
      : 0;

  return {
    ok: true,
    backup: {
      schema,
      app: typeof root.app === 'string' ? root.app : '',
      createdAt,
      payload,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// restoring: merge, not replace, and why
// ---------------------------------------------------------------------------

/**
 * RESTORE MERGES. It does not overwrite. (Settings are the one exception, and
 * the reason is argued at `qh:prefs:v1` above.)
 *
 * The decision, stated plainly because it is the most consequential one in this
 * file. A restore is not a symmetric operation: the two mistakes it can make are
 * nothing like each other in cost.
 *
 *   - Merge when replace was wanted: the user ends up with the union of two
 *     histories. Their deck is slightly larger than they expected and a few
 *     ayahs are scheduled sooner than they would have been. Cost: some extra
 *     revision, which is the thing they are doing anyway.
 *   - Replace when merge was wanted: a person who has used the app for a month
 *     and then opens a three-month-old file — because they were curious, because
 *     they tapped the wrong button, because they assumed it would "sync" —
 *     destroys a month of hifz. There is no undo, because there is no server.
 *     Cost: the exact thing this feature exists to prevent, caused by the
 *     feature.
 *
 * So: merge. And the merge is defined so that it CANNOT lose a review, a
 * session, a dismissal or a reading position — every rule below is a maximum, a
 * union, or the more recent of two, never an overwrite.
 *
 * `describeRestore` exists so the UI can say all of this in counts BEFORE
 * anything is written. The user must not learn what a restore did by finding out
 * afterwards.
 */

export interface DeckChange {
  /** entries after the merge */
  total: number;
  /** entries that only existed in the file */
  added: number;
  /** entries where the file's version was the more recent and now wins */
  recovered: number;
  /** entries the device's own version keeps */
  kept: number;
}

export interface ListChange {
  current: number;
  incoming: number;
  /** length after the merge, after any cap */
  merged: number;
  /** how many of those came from the file and were not already here */
  recovered: number;
  /** how many fell off the end of a capped list */
  dropped: number;
}

export interface RestoreSummary {
  hifz: DeckChange;
  progress: DeckChange;
  sessions: ListChange;
  mistakes: ListChange;
  dismissed: ListChange;
  /** true when the file's settings differ from the current ones and will win */
  settingsReplaced: boolean;
  /** true when this device has never been onboarded and the file says otherwise */
  onboardingCarried: boolean;
  /** keys present in the file that this build deliberately does not restore */
  skipped: string[];
  /**
   * True when nothing currently on this device is lost by going ahead. The one
   * sentence the confirmation screen most needs.
   */
  losesNothing: boolean;
}

export interface RestorePlan {
  /** hand straight to `importAll` */
  values: Record<string, string>;
  summary: RestoreSummary;
}

const NO_DECK_CHANGE: DeckChange = { total: 0, added: 0, recovered: 0, kept: 0 };
const NO_LIST_CHANGE: ListChange = { current: 0, incoming: 0, merged: 0, recovered: 0, dropped: 0 };

/** Parse a stored value, degrading to a fallback exactly like storage.ts does. */
function readValue<T>(raw: string | undefined, guard: (v: unknown) => v is T, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return guard(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => isObject(v);
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// --- the hifz deck ---------------------------------------------------------

function isCard(value: unknown, key: string): value is HifzCard {
  if (!isObject(value)) return false;
  const c = value as Partial<HifzCard>;
  if (
    !num(c.ayah) ||
    !num(c.easiness) ||
    !num(c.repetitions) ||
    !num(c.intervalDays) ||
    !num(c.dueAt) ||
    !num(c.lastReviewedAt) ||
    !num(c.lastGrade) ||
    !num(c.reviews) ||
    !num(c.lapses)
  ) {
    return false;
  }
  // The deck is keyed by String(ayah) everywhere it is written. A file whose key
  // and `ayah` disagree is hand-edited or corrupt, and the disagreement is not
  // recoverable: `dueQueue` would report one number while the deck is filed
  // under another. Drop the card rather than guess which half is right.
  return String(c.ayah) === key;
}

function readDeck(raw: string | undefined): HifzDeck {
  const parsed = readValue<Record<string, unknown>>(raw, isRecord, {});
  const deck: HifzDeck = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isCard(value, key)) deck[key] = value;
  }
  return deck;
}

/**
 * Combine two records of the same ayah. THE hard question of this file.
 *
 * "The better card" is not a single number, because an SM-2 record is two
 * different things wearing one shape:
 *
 *  1. A SCHEDULE — easiness, repetitions, intervalDays, dueAt, lastGrade,
 *     lastReviewedAt, lastSource. These are only meaningful TOGETHER. Taking
 *     `intervalDays` from one card and `dueAt` from the other produces a record
 *     that never existed and schedules nonsense. So the schedule is taken whole,
 *     from one winner.
 *  2. A HISTORY — reviews, lapses, recitedReviews. These are monotonic counters:
 *     they only ever went up, and a count cannot be un-earned by anything that
 *     happened on another phone.
 *
 * The schedule winner is the card reviewed MOST RECENTLY, because SM-2 is a
 * model of a memory and the freshest evidence is the best description of it. A
 * card with no reviews at all loses to any card with one. Ties break towards the
 * EARLIER `dueAt` — when the two are indistinguishable, revise sooner. Showing an
 * ayah a week early costs thirty seconds; showing it three months late costs the
 * memorisation, and this whole module exists because of that asymmetry.
 *
 * The history counters are then repaired to the MAXIMUM of the two, never the
 * sum. In the ordinary case — restoring your own older file onto your own phone —
 * the file's history is a prefix of the device's and summing would double-count
 * every shared review. In the genuine two-device fork, the maximum undercounts,
 * which errs towards keeping the card in circulation. Wrong in the safe
 * direction, in both cases.
 *
 * `recitedReviews` deserves its own sentence: it is what separates an ayah a
 * recogniser actually heard from one the user tapped a button about, and it is
 * capped by `UNHEARD_MAX_INTERVAL_DAYS` and `UNVERIFIED_STRENGTH_CAP` in
 * hifz.ts. Taking the maximum means verification is treated as a historical
 * fact: once something heard you recite an ayah, no later tap on another phone
 * can un-hear it. It is read through `recitedReviewsOf`, so a pre-self-report
 * card whose field is absent resolves to `reviews` and not to zero — getting
 * that default backwards would relabel a whole restored deck as unverified.
 *
 * `easiness` is the deliberate exception to "take the winner's". It is the
 * long-run difficulty estimate rather than part of the current schedule, and the
 * MINIMUM of the two is taken: when two devices disagree about how hard an ayah
 * is, believe the one that found it harder. That only ever shortens future
 * intervals, and it matches the rule in hifz.ts that a self-report may make a
 * card harder but never easier.
 */
export function mergeCard(mine: HifzCard, theirs: HifzCard): { card: HifzCard; winner: 'mine' | 'theirs' } {
  let winner: 'mine' | 'theirs';
  if (mine.reviews === 0 && theirs.reviews > 0) winner = 'theirs';
  else if (theirs.reviews === 0 && mine.reviews > 0) winner = 'mine';
  else if (theirs.lastReviewedAt > mine.lastReviewedAt) winner = 'theirs';
  else if (mine.lastReviewedAt > theirs.lastReviewedAt) winner = 'mine';
  else winner = theirs.dueAt < mine.dueAt ? 'theirs' : 'mine';

  const schedule = winner === 'mine' ? mine : theirs;
  const card: HifzCard = {
    ...schedule,
    reviews: Math.max(mine.reviews, theirs.reviews),
    lapses: Math.max(mine.lapses, theirs.lapses),
    recitedReviews: Math.max(recitedReviewsOf(mine), recitedReviewsOf(theirs)),
    easiness: Math.max(MIN_EASINESS, Math.min(mine.easiness, theirs.easiness)),
  };
  return { card, winner };
}

export function mergeDecks(mine: HifzDeck, theirs: HifzDeck): { deck: HifzDeck; change: DeckChange } {
  const deck: HifzDeck = { ...mine };
  let added = 0;
  let recovered = 0;
  for (const [key, theirCard] of Object.entries(theirs)) {
    const myCard = mine[key];
    if (myCard === undefined) {
      deck[key] = theirCard;
      added++;
      continue;
    }
    const { card, winner } = mergeCard(myCard, theirCard);
    deck[key] = card;
    if (winner === 'theirs') recovered++;
  }
  const total = Object.keys(deck).length;
  return { deck, change: { total, added, recovered, kept: total - added - recovered } };
}

// --- reading positions -----------------------------------------------------

function readProgress(raw: string | undefined): ProgressMap {
  const parsed = readValue<Record<string, unknown>>(raw, isRecord, {});
  const out: ProgressMap = {};
  for (const [surah, entry] of Object.entries(parsed)) {
    if (isObject(entry) && num(entry.cursor) && num(entry.at)) {
      out[surah] = { cursor: entry.cursor, at: entry.at };
    }
  }
  return out;
}

/** Per surah, the more recent read wins. `at` is what "continue reading" sorts on. */
function mergeProgress(mine: ProgressMap, theirs: ProgressMap): { map: ProgressMap; change: DeckChange } {
  const map: ProgressMap = { ...mine };
  let added = 0;
  let recovered = 0;
  for (const [surah, entry] of Object.entries(theirs)) {
    const existing = mine[surah];
    if (existing === undefined) {
      map[surah] = entry;
      added++;
    } else if (entry.at > existing.at) {
      map[surah] = entry;
      recovered++;
    }
  }
  const total = Object.keys(map).length;
  return { map, change: { total, added, recovered, kept: total - added - recovered } };
}

// --- the session log -------------------------------------------------------

/**
 * Mirrors the cap in `logSession` (storage.ts), which is a literal rather than
 * an export. A test reads that file and fails if the two ever diverge — a
 * restore that writes a longer list than the app trims to would have its oldest
 * sessions silently dropped by the next session logged, which is a data loss
 * that would look like a bug in the tracker.
 */
export const SESSION_CAP = 800;

function isSession(v: unknown): v is LoggedSession {
  return isObject(v) && typeof v.id === 'string' && num(v.at);
}

function readSessions(raw: string | undefined): LoggedSession[] {
  const parsed = readValue<unknown[]>(raw, isArray, []);
  return parsed.filter(isSession);
}

/**
 * Union by id, oldest first, capped like the log itself.
 *
 * Sessions carry a unique id, so this is the one merge here that is exactly
 * right: the union of two session logs IS the set of sessions that happened.
 * On a collision the device's own record is kept — it is the one the tracker has
 * already been counting, and the two are the same session anyway.
 */
function mergeSessions(mine: LoggedSession[], theirs: LoggedSession[]): { list: LoggedSession[]; change: ListChange } {
  const byId = new Map<string, LoggedSession>();
  for (const s of mine) byId.set(s.id, s);
  let recovered = 0;
  for (const s of theirs) {
    if (byId.has(s.id)) continue;
    byId.set(s.id, s);
    recovered++;
  }
  const all = [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const list = all.slice(Math.max(0, all.length - SESSION_CAP));
  return {
    list,
    change: {
      current: mine.length,
      incoming: theirs.length,
      merged: list.length,
      recovered,
      dropped: all.length - list.length,
    },
  };
}

// --- the mistake log -------------------------------------------------------

function isMistake(v: unknown): v is MistakeRecord {
  return (
    isObject(v) && num(v.word) && typeof v.expected === 'string' && typeof v.heardInstead === 'string'
  );
}

function readMistakes(raw: string | undefined): MistakeRecord[] {
  const parsed = readValue<unknown[]>(raw, isArray, []);
  return parsed.filter(isMistake);
}

const mistakeKey = (m: MistakeRecord): string => `${m.word}\u0000${m.expected}\u0000${m.heardInstead}`;

/**
 * Per-pattern maximum, not concatenation.
 *
 * This log has no ids and no timestamps — it is a bounded ring of raw records
 * that `buildProfile` counts by pattern. That means two identical records are
 * genuinely indistinguishable from one record counted twice, so concatenating
 * the two logs would inflate every pattern in the overlap, and the confusion
 * profile would start recommending drills for mistakes that were made once.
 *
 * Taking, per distinct (word, expected, heard) pattern, the larger of the two
 * counts never invents a mistake that did not happen. Like the hifz counters it
 * undercounts a true two-device fork, which is the safe direction here too: the
 * cost is a pattern surfacing slightly later.
 *
 * Recovered records go in FRONT of the device's own, because they are older
 * history and the cap trims from the front. That keeps the device's most recent
 * mistakes — the ones that describe how the user is reciting now.
 */
function mergeMistakes(mine: MistakeRecord[], theirs: MistakeRecord[]): { list: MistakeRecord[]; change: ListChange } {
  const have = new Map<string, number>();
  for (const m of mine) have.set(mistakeKey(m), (have.get(mistakeKey(m)) ?? 0) + 1);

  const extra: MistakeRecord[] = [];
  const seen = new Map<string, number>();
  for (const m of theirs) {
    const key = mistakeKey(m);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > (have.get(key) ?? 0)) extra.push(m);
  }

  const all = [...extra, ...mine];
  const list = all.slice(Math.max(0, all.length - MISTAKE_LOG_CAP));
  return {
    list,
    change: {
      current: mine.length,
      incoming: theirs.length,
      merged: list.length,
      recovered: extra.length,
      dropped: all.length - list.length,
    },
  };
}

// --- dismissed false mistakes ----------------------------------------------

function readDismissed(raw: string | undefined): number[] {
  return readValue<unknown[]>(raw, isArray, []).filter(num);
}

function mergeDismissed(mine: number[], theirs: number[]): { list: number[]; change: ListChange } {
  const set = new Set(mine);
  let recovered = 0;
  for (const word of theirs) {
    if (set.has(word)) continue;
    set.add(word);
    recovered++;
  }
  const list = [...set].sort((a, b) => a - b);
  return {
    list,
    change: { current: mine.length, incoming: theirs.length, merged: list.length, recovered, dropped: 0 },
  };
}

// ---------------------------------------------------------------------------
// the plan
// ---------------------------------------------------------------------------

/**
 * Work out exactly what a restore would write, without writing it.
 *
 * `current` is `exportAll()`'s result; `incoming` is `parseBackup(...).backup.payload`.
 * `values` is handed to `importAll`, which applies the owned-keys rule a second
 * time. Only keys that actually change are included, so a restore that would be
 * a no-op writes nothing.
 */
export function planRestore(
  current: Record<string, string>,
  incoming: Record<string, string>,
): RestorePlan {
  const values: Record<string, string> = {};
  let hifz = NO_DECK_CHANGE;
  let progress = NO_DECK_CHANGE;
  let sessions = NO_LIST_CHANGE;
  let mistakes = NO_LIST_CHANGE;
  let dismissed = NO_LIST_CHANGE;
  let settingsReplaced = false;
  let onboardingCarried = false;
  const skipped: string[] = [];

  // Over OUR keys, never the file's. Same rule as parseBackup, for the same
  // reason, and it holds even if a caller skips parseBackup entirely.
  for (const key of ALL_KEYS) {
    const from = incoming[key];
    const mine = current[key];
    const policy = policyFor(key);

    if (policy === 'skip') {
      if (typeof from === 'string') skipped.push(key);
      continue;
    }
    if (typeof from !== 'string') continue;

    switch (policy) {
      case 'replace': {
        if (mine !== from) values[key] = from;
        // Only an OVERWRITE counts. A fresh install has no settings of its own,
        // so restoring them there costs nothing and `losesNothing` must not be
        // dragged false by it — which is the whole case this feature is for.
        if (typeof mine === 'string' && mine !== from) settingsReplaced = true;
        break;
      }
      case 'carry': {
        if (typeof mine !== 'string') {
          values[key] = from;
          if (key === 'qh:onboarded:v1') onboardingCarried = true;
        }
        break;
      }
      case 'merge-hifz': {
        const merged = mergeDecks(readDeck(mine), readDeck(from));
        hifz = merged.change;
        if (merged.change.added > 0 || merged.change.recovered > 0) {
          values[key] = JSON.stringify(merged.deck);
        }
        break;
      }
      case 'merge-progress': {
        const merged = mergeProgress(readProgress(mine), readProgress(from));
        progress = merged.change;
        if (merged.change.added > 0 || merged.change.recovered > 0) {
          values[key] = JSON.stringify(merged.map);
        }
        break;
      }
      case 'merge-sessions': {
        const merged = mergeSessions(readSessions(mine), readSessions(from));
        sessions = merged.change;
        if (merged.change.recovered > 0) values[key] = JSON.stringify(merged.list);
        break;
      }
      case 'merge-mistakes': {
        const merged = mergeMistakes(readMistakes(mine), readMistakes(from));
        mistakes = merged.change;
        if (merged.change.recovered > 0) values[key] = JSON.stringify(merged.list);
        break;
      }
      case 'merge-dismissed': {
        const merged = mergeDismissed(readDismissed(mine), readDismissed(from));
        dismissed = merged.change;
        if (merged.change.recovered > 0) values[key] = JSON.stringify(merged.list);
        break;
      }
    }
  }

  return {
    values,
    summary: {
      hifz,
      progress,
      sessions,
      mistakes,
      dismissed,
      settingsReplaced,
      onboardingCarried,
      skipped: skipped.sort(),
      // Settings are the only thing a restore overwrites, and a capped list is
      // the only thing it can push off the end. If neither happened, the user
      // can be told plainly that this cannot cost them anything.
      losesNothing: !settingsReplaced && sessions.dropped === 0 && mistakes.dropped === 0,
    },
  };
}

/**
 * What a restore will do, in counts, for the confirmation screen.
 *
 * The UI must call this and show it BEFORE writing anything. A destructive
 * operation with no undo and no server behind it has to be explained in advance
 * or it is a trap, and "you will keep 412 ayahs and recover 38" is a sentence a
 * person can actually make a decision about.
 */
export const describeRestore = (
  current: Record<string, string>,
  incoming: Record<string, string>,
): RestoreSummary => planRestore(current, incoming).summary;
