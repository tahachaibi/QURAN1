/**
 * The store boundary, and where the app is allowed to mention it.
 *
 * Two kinds of test again. The arithmetic ones pin the rule that only an actual
 * purchase moves the entitlement snapshot — a cancelled sheet, a dead network
 * and a build with no billing in it are all silence, and silence never takes
 * anything away.
 *
 * The structural one pins where a paywall may appear in the source, because the
 * promise in gates.ts ("never on the page") is enforced by a list of strings
 * that nothing stops a later screen from ignoring.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { NOT_ENTITLED, applyStoreAnswer, entitlementOf, type EntitlementSnapshot } from '../src/billing/entitlement';
import { answerOf, nullStore, type PurchaseOutcome } from '../src/billing/store';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);

const subscribed: EntitlementSnapshot = {
  plan: 'annual',
  goodUntil: T0 + 300 * DAY,
  checkedAt: T0,
  source: 'play',
};

describe('the store that is not there', () => {
  it('reports silence, not a refusal, when asked what the user owns', async () => {
    // The distinction this whole module exists for: a build with no billing in
    // it must look like "cannot find out", never like "you own nothing". If it
    // ever returned notEntitled, flipping the master switch on would revoke
    // every promo and lifetime record on every device at once.
    await expect(nullStore.queryEntitlement()).resolves.toEqual({ kind: 'unknown' });
    await expect(nullStore.restore()).resolves.toEqual({ kind: 'unknown' });
  });

  it('is not reachable and sells nothing', async () => {
    await expect(nullStore.isReachable()).resolves.toBe(false);
    await expect(nullStore.listProducts()).resolves.toEqual([]);
    const outcome = await nullStore.purchase('annual');
    expect(outcome.kind).toBe('unavailable');
    // the reason has to be readable by a person, and has to say what is NOT
    // happening as a result — nothing is locked
    expect(outcome.kind === 'unavailable' && outcome.detail).toContain('Nothing is locked');
  });

  it('cannot be reconfigured by accident', () => {
    expect(Object.isFrozen(nullStore)).toBe(true);
  });
});

describe('what a purchase attempt means for entitlement', () => {
  it('records only an actual purchase', () => {
    const answer = answerOf({ kind: 'purchased', plan: 'lifetime', expiresAt: null });
    expect(answer).toEqual({ kind: 'entitled', plan: 'lifetime', expiresAt: null });
  });

  it('treats a cancelled, failed or impossible purchase as silence', () => {
    // Regression this pins: a user taps Buy, changes their mind, and the
    // dismissed sheet must not be folded in as "not entitled" — which would lock
    // a paying subscriber out of the schedule they are still paying for.
    const notPurchases: PurchaseOutcome[] = [
      { kind: 'cancelled' },
      { kind: 'failed', detail: 'no network' },
      { kind: 'unavailable', detail: 'no billing library' },
    ];
    for (const outcome of notPurchases) {
      expect(answerOf(outcome)).toEqual({ kind: 'unknown' });
      // and folded in, it changes the snapshot by identity, so nothing is even written
      expect(applyStoreAnswer(subscribed, answerOf(outcome), T0 + DAY)).toBe(subscribed);
    }
  });

  it('unlocks the coach when the store confirms a purchase', () => {
    const after = applyStoreAnswer(NOT_ENTITLED, answerOf({ kind: 'purchased', plan: 'annual', expiresAt: T0 + 365 * DAY }), T0);
    expect(entitlementOf(after, T0 + 100 * DAY)).toEqual({ active: true, reason: 'current', plan: 'annual' });
  });
});

describe('where a paywall may appear in the source', () => {
  /**
   * gates.ts enumerates three permitted sites and a test forbids a fourth, but
   * that test only checks the list — nothing there stops a screen from routing
   * to /upgrade or reading `useBilling` anyway.
   *
   * These are the files where a mention of money would break the promise that
   * matters most: the page itself, the session summary that follows a
   * recitation, and a person's first minute with the app. The tracker is
   * deliberately NOT in this list — it is a permitted site, because the locked
   * thing is visible there.
   */
  const sacred = [
    'app/onboarding.tsx',
    'app/surah/[id].tsx',
    'app/adhan.tsx',
    'app/adhkar.tsx',
    'src/components/MushafPage.tsx',
    'src/components/SummaryCard.tsx',
  ];

  it.each(sacred)('%s never asks for money', (file) => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8');
    expect(source).not.toContain('/upgrade');
    expect(source).not.toContain('useBilling');
  });
});
