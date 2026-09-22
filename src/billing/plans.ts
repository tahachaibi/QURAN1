/**
 * What is offered, at what price, and the master switch.
 *
 * MONETISATION_ENABLED is false, and shipping it false is the point. The paid
 * tier is built so that it exists, is tested, and can be turned on in one
 * commit — but the app launches free, because the one thing a subscriber would
 * be paying for is the app's reading of their own recitation, and that reading
 * has never been observed working on a real phone
 * (docs/acceptance-log.md: ten tests, zero filled in). Selling a voice coach to
 * a phone that cannot hear Arabic is not a product, it is a refund and a
 * one-star review.
 *
 * PRICES ARE A JUDGEMENT, NOT A MEASUREMENT. The numbers below are a starting
 * point reasoned from what comparable apps charge; no market research was done
 * and none could be from where this was written. Treat them as a proposal to
 * argue with. Per-country prices are set in Play Console, not here — this file
 * only records what to set them TO, and why.
 */

/** The master switch. Flip this, and only this, to turn the paid tier on. */
export const MONETISATION_ENABLED = false;

/** Days of full coach access on the one trial a device gets. */
export const TRIAL_DAYS = 14;

export type PlanId = 'monthly' | 'annual' | 'lifetime' | 'trial' | 'promo';

export interface Plan {
  id: PlanId;
  /** the Play Console product id this maps to; unset for trial and promo */
  sku?: string;
  /** what the user sees, in the app's default locale */
  label: string;
  /** US price in whole cents, before Play's per-country conversion */
  usdCents: number;
  /** null for a one-off purchase */
  renews: 'month' | 'year' | null;
  /** shown under the price, and it has to be true */
  note: string;
}

/**
 * Three, and no more.
 *
 * A fourth option does not raise revenue, it raises the time somebody spends on
 * a screen that is not the Quran.
 */
export const PLANS: readonly Plan[] = [
  {
    id: 'monthly',
    sku: 'coach_monthly',
    label: 'Monthly',
    usdCents: 299,
    renews: 'month',
    note: 'Cancel any time in Google Play.',
  },
  {
    id: 'annual',
    sku: 'coach_annual',
    label: 'Yearly',
    usdCents: 1999,
    renews: 'year',
    note: 'Works out at about $1.67 a month.',
  },
  {
    /**
     * Lifetime exists mainly for the markets where this app will be used most.
     * A recurring foreign-currency charge converts close to zero in Morocco,
     * Egypt, Indonesia and Pakistan — a single payment does not, and it also
     * means the buyer never has to think about this app's business again.
     */
    id: 'lifetime',
    sku: 'coach_lifetime',
    label: 'One payment, forever',
    usdCents: 4999,
    renews: null,
    note: 'Paid once. Android only — see below.',
  },
] as const;

export const planById = (id: PlanId): Plan | undefined => PLANS.find((p) => p.id === id);

/**
 * What "lifetime" honestly means here, and it must be said before the purchase.
 *
 * A Play entitlement belongs to a Google account on Android. With no backend
 * there is nothing that could carry it to an iPhone, so somebody who buys
 * lifetime and later switches to iOS has lost it. Saying so on the purchase
 * screen costs a few sales; not saying so earns a refund and a review that is
 * entirely deserved.
 */
export const LIFETIME_CAVEAT =
  'Lifetime access is tied to your Google account on Android. There is no iPhone version, and if one is ever made this purchase will not carry across to it.';

/**
 * Countries where the default currency conversion should NOT be accepted.
 *
 * Play converts a US price automatically, and its conversion is close to
 * meaningless in these markets: $2.99 is a rounding error in Oslo and a real
 * decision in Casablanca. These are the places this app is most likely to be
 * used, so the price has to be set by hand for each of them.
 *
 * The figures are what to consider, not what is correct — they are reasoned from
 * local purchasing power rather than measured, and whoever sets them should look
 * at what locally successful apps actually charge first.
 */
export const REGIONAL_PRICING_NOTES: readonly { country: string; guidance: string }[] = [
  { country: 'MA', guidance: 'Morocco — roughly 15-20 MAD/month. Lead with lifetime.' },
  { country: 'EG', guidance: 'Egypt — well below the converted price; lifetime first.' },
  { country: 'ID', guidance: 'Indonesia — high volume, low ARPU. Annual or lifetime only.' },
  { country: 'PK', guidance: 'Pakistan — as Indonesia. Monthly will not convert.' },
  { country: 'TR', guidance: 'Türkiye — price in lira and revisit it; inflation moves it.' },
  { country: 'US', guidance: 'United States, UK, Gulf, EU — the list price stands.' },
] as const;

/**
 * The promise that is worth more than any feature on the paid list.
 *
 * Muslim Pro's problem is not that it lacks features, it is ads and the feeling
 * of being harvested. Tarteel's is the price. The answer to both is a sentence,
 * and it is a commitment this codebase actually keeps: there is no analytics
 * library, no advertising id is read, and there is no account system to sign
 * into. If any of those three ever stops being true, this constant has to change
 * first, and it should be hard to bring yourself to do it.
 */
export const NEVER_PROMISE = [
  'No ads. Not now, not later.',
  'No account, and no email address asked for.',
  'No analytics and no tracking of any kind.',
  'The Quran, prayer times, the adhan, the adhkar and the recitation follow-along stay free.',
] as const;
