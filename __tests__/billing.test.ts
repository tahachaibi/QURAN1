/**
 * The rules of the paid tier.
 *
 * Two kinds of test here, and the second kind is the reason this file matters.
 *
 * The ordinary kind checks the entitlement arithmetic. The structural kind
 * checks promises — that worship is never sold, that there is no fourth place to
 * ask for money, that silence from the store never takes away what somebody paid
 * for. Those are commitments that decay under pressure from perfectly reasonable
 * future requests, so they are written down as assertions rather than as good
 * intentions in a comment.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  COACH_FEATURES,
  FREE_FOREVER,
  PAYWALL_SITES,
  isAvailable,
  isPaid,
  type Feature,
} from '../src/billing/gates';
import {
  NOT_ENTITLED,
  OFFLINE_GRACE_DAYS,
  applyStoreAnswer,
  entitlementOf,
  grantPromo,
  isEntitled,
  shouldRecheck,
  startTrial,
  type EntitlementSnapshot,
} from '../src/billing/entitlement';
import { MONETISATION_ENABLED, PLANS, TRIAL_DAYS, planById } from '../src/billing/plans';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);

const subscribed = (expiresAt: number | null, checkedAt = T0): EntitlementSnapshot => ({
  plan: 'annual',
  goodUntil: expiresAt,
  checkedAt,
  source: 'play',
});

describe('what may be sold', () => {
  it('never sells worship', () => {
    // If this ever fails, something on the free list has been moved behind a
    // paywall, and no amount of conversion improvement makes that the right call.
    for (const feature of FREE_FOREVER) {
      expect(isPaid(feature)).toBe(false);
      expect(
        isAvailable(feature, { entitled: false, monetisationEnabled: true }),
      ).toBe(true);
    }
  });

  it('keeps the follow-along free, which is the expensive promise', () => {
    // The voice tracking is the whole differentiator and the obvious thing to
    // gate. It is on the free list on purpose; this test is what says no when
    // somebody later reasons their way to gating it.
    expect(FREE_FOREVER).toContain<Feature>('followAlong');
    expect(FREE_FOREVER).toContain<Feature>('hiddenMode');
    expect(FREE_FOREVER).toContain<Feature>('quran');
    expect(FREE_FOREVER).toContain<Feature>('prayerTimes');
    expect(FREE_FOREVER).toContain<Feature>('adhan');
    expect(FREE_FOREVER).toContain<Feature>('adhkar');
  });

  it('sells nothing that rests on content this project does not own', () => {
    // The KFGQPC font is licensed "Free of Cost" and expressly not for sale, the
    // hadith English translations have no established licence, and the mushaf
    // layout's terms are unconfirmed. Everything on the paid list has to be this
    // app's own conclusion about the user's own recitation.
    const encumbered: Feature[] = ['quran', 'mushaf', 'hadith'];
    for (const feature of encumbered) {
      expect(COACH_FEATURES).not.toContain(feature);
    }
  });

  it('has no overlap between the two lists', () => {
    for (const paid of COACH_FEATURES) expect(FREE_FOREVER).not.toContain(paid);
    for (const free of FREE_FOREVER) expect(COACH_FEATURES).not.toContain(free);
  });

  it('asks for money in exactly three places, and never on the page', () => {
    // Every growth idea will want a fourth site, and each one will look
    // harmless on its own. Notably absent: the mushaf, the prayer tab, the
    // session summary, and onboarding — a person's first minute, and every
    // minute they spend reciting, has no mention of money in it.
    expect(PAYWALL_SITES).toHaveLength(3);
    expect(PAYWALL_SITES).not.toContain('mushaf');
    expect(PAYWALL_SITES).not.toContain('onboarding');
    expect(PAYWALL_SITES).not.toContain('sessionSummary');
  });

  it('ships with monetisation off', () => {
    // The paid tier is built, tested and dormant. It stays dormant until the
    // recitation tracking has been observed working on a real device, because
    // that is the only thing a subscriber would be paying for.
    expect(MONETISATION_ENABLED).toBe(false);
  });

  it('gates nothing at all while monetisation is off', () => {
    for (const feature of [...FREE_FOREVER, ...COACH_FEATURES]) {
      expect(isAvailable(feature, { entitled: false, monetisationEnabled: false })).toBe(true);
    }
  });

  it('gates the coach, and only the coach, once it is on', () => {
    for (const feature of COACH_FEATURES) {
      expect(isAvailable(feature, { entitled: false, monetisationEnabled: true })).toBe(false);
      expect(isAvailable(feature, { entitled: true, monetisationEnabled: true })).toBe(true);
    }
  });
});

describe('entitlement', () => {
  it('starts locked', () => {
    expect(entitlementOf(NOT_ENTITLED, T0)).toEqual({ active: false, reason: 'none' });
    expect(isEntitled(NOT_ENTITLED, T0)).toBe(false);
  });

  it('honours a current subscription', () => {
    const state = entitlementOf(subscribed(T0 + 30 * DAY), T0);
    expect(state).toEqual({ active: true, reason: 'current', plan: 'annual' });
  });

  it('treats a lifetime purchase as needing no clock and no network', () => {
    const lifetime: EntitlementSnapshot = { plan: 'lifetime', goodUntil: null, checkedAt: 0, source: 'play' };
    // far future, far past, and a checkedAt of zero: none of it matters
    expect(entitlementOf(lifetime, T0).active).toBe(true);
    expect(entitlementOf(lifetime, T0 + 100 * 365 * DAY).active).toBe(true);
    expect(entitlementOf(lifetime, 0).active).toBe(true);
    // and it is never re-queried, because a flaky store can only answer worse
    expect(shouldRecheck(lifetime, T0 + 400 * DAY)).toBe(false);
  });

  it('keeps working through the offline grace after expiry', () => {
    const expired = subscribed(T0 - DAY);
    const state = entitlementOf(expired, T0);
    expect(state).toEqual({ active: true, reason: 'grace', plan: 'annual' });
    expect(isEntitled(expired, T0 + (OFFLINE_GRACE_DAYS - 2) * DAY)).toBe(true);
  });

  it('eventually locks after the grace runs out', () => {
    const expired = subscribed(T0);
    expect(entitlementOf(expired, T0 + (OFFLINE_GRACE_DAYS + 1) * DAY)).toEqual({
      active: false,
      reason: 'expired',
    });
  });
});

describe('what the store says, and what it fails to say', () => {
  /**
   * The centre of this whole module.
   *
   * The app is offline-first and has no server, so "I could not find out" is an
   * ordinary state, not an error. If it were ever treated as a negative, a
   * paying user on a plane or in a masjid with no signal would lose the
   * revision schedule they paid for.
   */
  it('changes NOTHING when the store cannot be reached', () => {
    const current = subscribed(T0 + 300 * DAY);
    const after = applyStoreAnswer(current, { kind: 'unknown' }, T0 + DAY);
    // by identity, so a caller can skip the storage write entirely
    expect(after).toBe(current);
  });

  it('does not let repeated silence add up to a revocation', () => {
    let snapshot = subscribed(T0 + 10 * DAY);
    for (let day = 0; day < 60; day++) {
      snapshot = applyStoreAnswer(snapshot, { kind: 'unknown' }, T0 + day * DAY);
    }
    // 60 days of not knowing, and the record is untouched
    expect(snapshot).toEqual(subscribed(T0 + 10 * DAY));
  });

  it('takes the coach away only on a definitive no', () => {
    const revoked = applyStoreAnswer(subscribed(T0 + 300 * DAY), { kind: 'notEntitled' }, T0);
    expect(revoked.source).toBe('none');
    expect(revoked.plan).toBeNull();
    expect(entitlementOf(revoked, T0)).toEqual({ active: false, reason: 'none' });
  });

  it('records a purchase the store confirms', () => {
    const bought = applyStoreAnswer(
      NOT_ENTITLED,
      { kind: 'entitled', plan: 'annual', expiresAt: T0 + 365 * DAY },
      T0,
    );
    expect(bought).toEqual({ plan: 'annual', goodUntil: T0 + 365 * DAY, checkedAt: T0, source: 'play' });
    expect(isEntitled(bought, T0 + 300 * DAY)).toBe(true);
  });

  it('records a lifetime purchase with no expiry', () => {
    const bought = applyStoreAnswer(
      NOT_ENTITLED,
      { kind: 'entitled', plan: 'lifetime', expiresAt: null },
      T0,
    );
    expect(bought.goodUntil).toBeNull();
    expect(entitlementOf(bought, T0 + 50 * 365 * DAY).reason).toBe('lifetime');
  });
});

describe('trial and promo', () => {
  it('gives a fresh install one trial', () => {
    const trial = startTrial(NOT_ENTITLED, TRIAL_DAYS, T0);
    expect(trial).not.toBeNull();
    expect(isEntitled(trial as EntitlementSnapshot, T0 + (TRIAL_DAYS - 1) * DAY)).toBe(true);
  });

  it('refuses a second trial', () => {
    const trial = startTrial(NOT_ENTITLED, TRIAL_DAYS, T0) as EntitlementSnapshot;
    expect(startTrial(trial, TRIAL_DAYS, T0 + 30 * DAY)).toBeNull();
    // and once it has lapsed and been recorded as such, still no
    const lapsed = applyStoreAnswer(trial, { kind: 'notEntitled' }, T0 + 30 * DAY);
    expect(startTrial(lapsed, TRIAL_DAYS, T0 + 31 * DAY)).toBeNull();
  });

  it('grants a promo, including one that never expires', () => {
    expect(entitlementOf(grantPromo(90, T0), T0 + 80 * DAY).active).toBe(true);
    expect(entitlementOf(grantPromo(90, T0), T0 + 200 * DAY).active).toBe(false);
    expect(entitlementOf(grantPromo(null, T0), T0 + 50 * 365 * DAY).reason).toBe('lifetime');
  });
});

describe('the plans', () => {
  it('offers three, and no more', () => {
    expect(PLANS).toHaveLength(3);
    expect(PLANS.map((p) => p.id)).toEqual(['monthly', 'annual', 'lifetime']);
  });

  it('prices the year below twelve months', () => {
    const monthly = planById('monthly');
    const annual = planById('annual');
    expect(annual!.usdCents).toBeLessThan(monthly!.usdCents * 12);
  });

  it('gives every purchasable plan a store product id', () => {
    for (const plan of PLANS) expect(typeof plan.sku).toBe('string');
    // trial and promo are not bought, so they have none
    expect(planById('trial')).toBeUndefined();
    expect(planById('promo')).toBeUndefined();
  });

  it("says nothing in its notes that the code does not do", () => {
    // Every note appears under a price on the upgrade screen. A claim there is a
    // promise, and the lifetime one in particular has to carry its caveat.
    for (const plan of PLANS) expect(plan.note.length).toBeGreaterThan(0);
    expect(planById('lifetime')!.note.toLowerCase()).toContain('android only');
  });
});

describe('the promise, checked against the codebase rather than trusted', () => {
  /**
   * "No ads, no account, no analytics" is the sentence that answers both Muslim
   * Pro and Tarteel, and it is worth more than anything on the paid list. It is
   * also the easiest thing in the world to break by adding one library.
   *
   * So it is checked against package.json, not asserted in prose.
   */
  it('has no analytics, advertising or account dependency', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const names = Object.keys(pkg.dependencies).join(' ').toLowerCase();
    for (const forbidden of [
      'analytics',
      'firebase',
      'amplitude',
      'mixpanel',
      'segment',
      'sentry',
      'bugsnag',
      'admob',
      'facebook',
      'auth0',
      'revenuecat',
      'purchases',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('never gates a feature the promise says is free', () => {
    // The promise text and the gate list have to agree; drift between a
    // marketing sentence and the code is how an app ends up lying by accident.
    const promised: Feature[] = ['quran', 'prayerTimes', 'adhan', 'adhkar', 'followAlong'];
    for (const feature of promised) expect(FREE_FOREVER).toContain(feature);
  });
});
