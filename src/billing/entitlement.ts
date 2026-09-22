/**
 * Whether the coach layer is unlocked — pure, clock-injected, and biased
 * towards the user in every ambiguous case.
 *
 * The hard part of entitlement in THIS app is not the happy path, it is silence.
 * Quran Habit is offline-first and has no backend: there is no server to ask, and
 * Google Play can only be reached when the phone has a connection and Play
 * Services are working. So the app is regularly in a state of "I cannot find out
 * right now", and the whole design question is what it does then.
 *
 * It keeps what the user paid for. A person who pays for a year and then spends a
 * fortnight on a plane, in a masjid with no signal, or in a country where Play
 * Services are flaky, must not find their revision schedule locked. Silence is
 * therefore never treated as a negative: `applyStoreAnswer` with an `unknown`
 * answer returns the snapshot completely untouched, and expiry alone is softened
 * by a long offline grace.
 *
 * The cost of that is real and accepted: somebody who cancels and then stays
 * offline keeps the coach for the grace window. For a solo-developer worship app
 * that is the right side to err on — the alternative is a support inbox full of
 * people who paid and got locked out, which costs more than the leak and is a
 * worse thing to have done.
 *
 * Every entry point takes `now`, like src/engine/hifz.ts, so all of this is
 * deterministic under test.
 */

import type { PlanId } from './plans';

/**
 * How long after expiry the coach keeps working when Play has NOT said no.
 *
 * Generous on purpose. This window is only ever reached when the app could not
 * get a definitive answer, and the failure it protects against — a paying user
 * locked out by a bad connection — is far worse than the one it allows.
 */
export const OFFLINE_GRACE_DAYS = 30;

/**
 * How long a snapshot is considered worth re-checking after.
 *
 * Not an expiry: a stale snapshot is still honoured. It only decides when the app
 * bothers asking Play again.
 */
export const RECHECK_AFTER_HOURS = 24;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** What the app last managed to establish about the user's entitlement. */
export interface EntitlementSnapshot {
  /** what was bought, or null when nothing has been */
  plan: PlanId | null;
  /**
   * epoch ms this entitlement is known good until, or null for no expiry.
   *
   * null means lifetime — and it is deliberately the SAME representation as
   * "never expires", so a lifetime purchase needs no network access, ever, to
   * keep working. That matters: a lifetime buyer who reinstalls on a plane
   * should still be able to restore from the local snapshot.
   */
  goodUntil: number | null;
  /** epoch ms of the last DEFINITIVE answer from the store */
  checkedAt: number;
  /** where this entitlement came from */
  source: 'play' | 'trial' | 'promo' | 'none';
}

export const NOT_ENTITLED: EntitlementSnapshot = {
  plan: null,
  goodUntil: 0,
  checkedAt: 0,
  source: 'none',
};

/** Why the coach is or is not unlocked, in terms the UI can explain. */
export type EntitlementState =
  | { active: true; reason: 'lifetime' | 'current' | 'grace'; plan: PlanId }
  | { active: false; reason: 'none' | 'expired' | 'cancelled' };

/**
 * Read a snapshot as of `now`.
 *
 * Note the ordering: lifetime is checked before anything time-based, so no clock
 * skew, timezone change or restored backup can take away a lifetime purchase.
 */
export function entitlementOf(snapshot: EntitlementSnapshot, now: number): EntitlementState {
  if (snapshot.plan === null || snapshot.source === 'none') {
    return { active: false, reason: 'none' };
  }
  if (snapshot.goodUntil === null) {
    return { active: true, reason: 'lifetime', plan: snapshot.plan };
  }
  if (now <= snapshot.goodUntil) {
    return { active: true, reason: 'current', plan: snapshot.plan };
  }
  if (now <= snapshot.goodUntil + OFFLINE_GRACE_DAYS * DAY_MS) {
    return { active: true, reason: 'grace', plan: snapshot.plan };
  }
  return { active: false, reason: 'expired' };
}

/** Convenience: the single boolean the feature gates want. */
export const isEntitled = (snapshot: EntitlementSnapshot, now: number): boolean =>
  entitlementOf(snapshot, now).active;

/**
 * What the store told us, or failed to tell us.
 *
 * `unknown` is not an error state to be handled somewhere else — it is the
 * ordinary case on a phone with no signal, and it is the reason this module
 * exists in this shape.
 */
export type StoreAnswer =
  | { kind: 'entitled'; plan: PlanId; expiresAt: number | null }
  | { kind: 'notEntitled' }
  | { kind: 'unknown' };

/**
 * Fold a store answer into the snapshot.
 *
 * `unknown` returns the previous snapshot BY IDENTITY, which is both the correct
 * behaviour and a useful property: a caller can compare references to decide
 * whether anything needs writing to storage, so a phone that is offline for a
 * week does not rewrite the same record every time it wakes up.
 */
export function applyStoreAnswer(
  snapshot: EntitlementSnapshot,
  answer: StoreAnswer,
  now: number,
): EntitlementSnapshot {
  switch (answer.kind) {
    case 'unknown':
      return snapshot;
    case 'notEntitled':
      /**
       * A definitive no. This is the ONE path that takes the coach away, and it
       * requires Play to have actually answered — which is why `unknown` above
       * cannot reach it. Play's own billing grace period is already reflected in
       * the purchase it reports, so by the time it says no, it means no.
       */
      return { plan: null, goodUntil: 0, checkedAt: now, source: 'none' };
    case 'entitled':
      return {
        plan: answer.plan,
        goodUntil: answer.expiresAt,
        checkedAt: now,
        source: 'play',
      };
  }
}

/**
 * Start the one free trial this device gets.
 *
 * Returns null if a trial is already running or has already been used, so the
 * caller shows the price instead of the offer.
 *
 * HONEST LIMITATION, not a bug to be fixed later: with no accounts and no
 * backend, "already used" can only be remembered in local storage, which an
 * uninstall clears. Somebody determined to keep reinstalling can keep trialling.
 * The alternatives are an account system, a server, or a device fingerprint —
 * the first two break the app's no-backend promise and the third is exactly the
 * kind of tracking this app tells people it does not do. A small leak is the
 * correct price for that.
 */
export function startTrial(
  snapshot: EntitlementSnapshot,
  days: number,
  now: number,
): EntitlementSnapshot | null {
  if (snapshot.source !== 'none' || snapshot.plan !== null) return null;
  if (snapshot.checkedAt > 0) return null; // a trial has been run before
  return {
    plan: 'trial',
    goodUntil: now + days * DAY_MS,
    checkedAt: now,
    source: 'trial',
  };
}

/**
 * Grant the coach from a Play Console promo code, or by hand.
 *
 * This is the "cannot afford it" path, and it is here because a worship app that
 * has no answer for a student who asks will either refuse them or field the
 * request by hand forever. Both are worse than a redeemable code.
 */
export function grantPromo(days: number | null, now: number): EntitlementSnapshot {
  return {
    plan: 'promo',
    goodUntil: days === null ? null : now + days * DAY_MS,
    checkedAt: now,
    source: 'promo',
  };
}

/** Should the app bother asking Play again? Never required, only worthwhile. */
export function shouldRecheck(snapshot: EntitlementSnapshot, now: number): boolean {
  // A lifetime purchase is settled; re-asking can only produce a worse answer
  // from a flaky store, so it is not asked.
  if (snapshot.goodUntil === null && snapshot.plan !== null) return false;
  return now - snapshot.checkedAt >= RECHECK_AFTER_HOURS * HOUR_MS;
}
