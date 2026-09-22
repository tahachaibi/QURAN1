/**
 * What may be sold, and what may never be.
 *
 * This file exists to be a constraint rather than a convenience. The app is a
 * worship app, and the line it must not cross is selling worship: the Quran, the
 * times of prayer, the call to prayer and the adhkar are not products. Nor,
 * separately, may the paid tier rest on content this project does not own — the
 * KFGQPC typeface is licensed "Free of Cost" and expressly not for sale, the
 * hadith English translations have no established licence, and the mushaf page
 * layout came from a community resource whose terms are still unconfirmed
 * (docs/fonts.md, docs/hadith.md, docs/mushaf-layout.md). A subscription that
 * unlocked any of those would be selling somebody else's work.
 *
 * What is left is the only thing here that is genuinely this app's own: the
 * record of what YOU recited, and what it concluded about it. The coach, not the
 * scripture.
 *
 * So FREE_FOREVER is not a marketing decision that a growth idea can revisit
 * later. A test asserts every entry of it is absent from the paid set, and it
 * will fail the build if the two ever overlap.
 */

/** Everything the app does that a person might be charged for. */
export type Feature =
  // --- free, permanently -----------------------------------------------------
  | 'quran'
  | 'mushaf'
  | 'followAlong'
  | 'hiddenMode'
  | 'prayerTimes'
  | 'adhan'
  | 'adhkar'
  | 'hadith'
  | 'listen'
  | 'sessionSummary'
  // --- the coach: this app's own conclusions about your own recitation --------
  | 'hifzSchedule'
  | 'mistakeHistory'
  | 'weakAyahReport'
  | 'progressOverTime'
  | 'backup';

/**
 * Never gated. Not now, not in a later release, not behind a "pro" label.
 *
 * `followAlong` and `hiddenMode` are on this list deliberately, and they are the
 * expensive ones to give away: voice tracking is the app's whole differentiator,
 * and a free tier that withholds it would convert better in the short run. It is
 * still the wrong call. Somebody memorising the Quran should not meet a paywall
 * between themselves and the page, and a person who cannot pay must still be
 * able to use every part of this that is worship.
 */
export const FREE_FOREVER: readonly Feature[] = [
  'quran',
  'mushaf',
  'followAlong',
  'hiddenMode',
  'prayerTimes',
  'adhan',
  'adhkar',
  'hadith',
  'listen',
  'sessionSummary',
] as const;

/**
 * Sold, when monetisation is switched on at all.
 *
 * Each of these is a conclusion this app drew from the user's own recitation, or
 * a way of keeping it. None of them is scripture, and none of them depends on
 * content whose licence is unresolved.
 */
export const COACH_FEATURES: readonly Feature[] = [
  'hifzSchedule',
  'mistakeHistory',
  'weakAyahReport',
  'progressOverTime',
  'backup',
] as const;

/**
 * Where the app is allowed to mention paying, and nowhere else.
 *
 * Three sites, enumerated, with a test that forbids a fourth. The reason is that
 * every future idea for growth will want one more — onboarding, the summary card
 * after a session, a banner on the mushaf — and each one individually will look
 * harmless. An app that asks for money while somebody is reciting has already
 * lost the thing it was for.
 *
 * Note what is NOT here: the mushaf, the prayer tab, the session summary, and
 * onboarding. A person's first minute with this app, and every minute they spend
 * on the page, is free of any mention of money.
 */
export const PAYWALL_SITES = [
  /** the tracker's coach section, where the locked thing is actually visible */
  'tracker',
  /** the settings screen, as a plain row */
  'settings',
  /** the upgrade screen itself, reached only from one of the above */
  'upgrade',
] as const;

export type PaywallSite = (typeof PAYWALL_SITES)[number];

/** Is this feature one that may ever require a subscription? */
export function isPaid(feature: Feature): boolean {
  return (COACH_FEATURES as readonly string[]).includes(feature);
}

/**
 * Can this feature be used right now?
 *
 * `entitled` is the answer from the entitlement reducer, and
 * `monetisationEnabled` is the master switch — off in every build until the
 * recitation tracking has been verified on real devices, because selling a voice
 * coach to a phone that cannot hear Arabic is not a product, it is a refund.
 */
export function isAvailable(
  feature: Feature,
  { entitled, monetisationEnabled }: { entitled: boolean; monetisationEnabled: boolean },
): boolean {
  if (!isPaid(feature)) return true;
  if (!monetisationEnabled) return true;
  return entitled;
}
