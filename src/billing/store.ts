/**
 * The boundary between this app and whatever eventually sells the coach.
 *
 * There is no real store implementation in this tree, and that is deliberate
 * rather than unfinished. A Google Play implementation needs a native billing
 * library and a Play Console account with the three products created in it, and
 * neither exists yet; writing one now would mean writing against an API nobody
 * here has run, which is the one thing this codebase tries hardest not to do.
 *
 * So this file is the shape of the hole. Everything above it — BillingProvider,
 * the upgrade screen, the settings row — is written against `BillingStore` and
 * tested against `nullStore`, so turning billing on later is adding ONE file
 * that implements this interface and passing it to the provider. Nothing else in
 * the app has to change.
 *
 * `nullStore` is not a stub that throws. It is the honest answer for a build
 * with no billing in it: every query comes back `unknown` (which the entitlement
 * reducer treats as "keep whatever the user already has", never as a
 * revocation), and every purchase comes back `unavailable` with a reason a human
 * can read. That means a dev build, an emulator, a phone with broken Play
 * Services and this shipping build all behave identically and correctly: nothing
 * is locked, nothing can be bought, nothing crashes.
 */
import type { StoreAnswer } from './entitlement';
import type { PlanId } from './plans';

/**
 * A product as the STORE describes it, which is not how plans.ts describes it.
 *
 * `price` is the string the store formats for the user's country and currency,
 * and it is the only price that may be shown next to a buy button. plans.ts
 * holds a US figure in cents from BEFORE Play's conversion, and it is explicitly
 * a proposal rather than a measurement — showing it as if it were the price the
 * user will be charged would be a lie in most of the markets this app is aimed
 * at. When the store cannot be reached there is no price, and the screen has to
 * say so instead of inventing one.
 */
export interface StoreProduct {
  planId: PlanId;
  /** must match the `sku` in plans.ts, which is what Play Console is keyed on */
  sku: string;
  /** formatted by the store, e.g. "MAD 29,99" — never derived from usdCents */
  price: string;
  /** the store's own title, if it gives one; the app prefers its own label */
  title?: string;
}

/**
 * What came of asking to buy something.
 *
 * Note that there is no `notEntitled` anywhere in here. A cancelled, failed or
 * impossible purchase says nothing whatsoever about what the user already owns,
 * and folding one into the snapshot as a negative would let a tapped-then-
 * dismissed purchase sheet lock a subscriber out of the coach they are paying
 * for. `answerOf` below is what enforces that, and a test pins it.
 */
export type PurchaseOutcome =
  | { kind: 'purchased'; plan: PlanId; expiresAt: number | null }
  /** the user backed out of the store's sheet — an ordinary, blameless event */
  | { kind: 'cancelled' }
  /** there is no store to buy from: no billing library, no Play Services, no products */
  | { kind: 'unavailable'; detail: string }
  /** the store tried and failed; `detail` is shown to the user, so it must name a fix */
  | { kind: 'failed'; detail: string };

/**
 * The few operations the app actually needs. Five, and adding a sixth should
 * require an argument — every method here is something a future implementation
 * has to get right against a real store.
 *
 * `isReachable` is the one beyond the four the app strictly needs, and it earns
 * its place by being the difference between "no price yet" and "this button will
 * always fail": the upgrade screen needs to distinguish those before it draws
 * anything a person could tap.
 */
export interface BillingStore {
  /** for diagnostics and the settings screen; never shown as marketing */
  readonly name: string;

  /**
   * Is there a store to talk to at all?
   *
   * False on an emulator, on a phone whose Play Services are broken, and in
   * every build that has no billing library linked. The upgrade screen uses this
   * to decide whether to offer a buy button, because a button that always
   * produces an error message is worse than no button.
   */
  isReachable(): Promise<boolean>;

  /**
   * What does the store think the user owns right now?
   *
   * MUST return `{ kind: 'unknown' }` — not `notEntitled` — for every failure,
   * timeout, missing library and absent network. `notEntitled` is a statement
   * that the store answered and the answer was no.
   */
  queryEntitlement(): Promise<StoreAnswer>;

  /** Localised prices, or an empty list when they cannot be fetched. */
  listProducts(): Promise<readonly StoreProduct[]>;

  /** Run the store's purchase flow for one plan. Never throws; see PurchaseOutcome. */
  purchase(plan: PlanId): Promise<PurchaseOutcome>;

  /**
   * Re-ask the store what this user owns, at the user's request.
   *
   * See the long note on restore below: with no backend, this is the ONLY
   * mechanism by which a reinstalled or second device gets its entitlement back.
   */
  restore(): Promise<StoreAnswer>;
}

/**
 * Why a failed purchase is not a negative entitlement.
 *
 * Maps an outcome onto something the entitlement reducer can eat. Only an actual
 * purchase moves the snapshot; everything else is silence, which
 * `applyStoreAnswer` deliberately treats as "change nothing at all".
 */
export function answerOf(outcome: PurchaseOutcome): StoreAnswer {
  if (outcome.kind === 'purchased') {
    return { kind: 'entitled', plan: outcome.plan, expiresAt: outcome.expiresAt };
  }
  return { kind: 'unknown' };
}

/**
 * The store for a build with no billing in it — which is every build today.
 *
 * Frozen, and a single shared object rather than a factory, so an accidental
 * second instance cannot behave differently from the first.
 */
export const nullStore: BillingStore = Object.freeze({
  name: 'none',
  isReachable: () => Promise.resolve(false),
  queryEntitlement: () => Promise.resolve<StoreAnswer>({ kind: 'unknown' }),
  listProducts: () => Promise.resolve<readonly StoreProduct[]>([]),
  purchase: (plan: PlanId) =>
    Promise.resolve<PurchaseOutcome>({
      kind: 'unavailable',
      detail:
        `This build has no billing in it, so ${plan} cannot be bought. ` +
        'Nothing is locked either — every feature is available.',
    }),
  restore: () => Promise.resolve<StoreAnswer>({ kind: 'unknown' }),
});

/* ===========================================================================
 * WHAT THE REAL IMPLEMENTATION HAS TO DO
 *
 * Read this before writing src/billing/playStore.ts. It is a specification of
 * behaviour, not of syntax: the function names of whichever library gets picked
 * are not asserted here because none of them has been run from this repo.
 *
 * --- the library -----------------------------------------------------------
 * It has to be a library that talks to Google Play Billing directly. That is a
 * constraint the repo already enforces rather than a preference: the structural
 * test in __tests__/billing.test.ts fails the build if package.json's
 * dependencies contain "purchases" or "revenuecat", which rules out RevenueCat
 * and anything else that fronts billing with an account and a server. Those are
 * genuinely convenient, and they are also a backend, an identity and a third
 * party receiving data about who bought what — all three of which this app
 * promises it does not have (plans.ts NEVER_PROMISE).
 *
 * The candidates worth evaluating are the community `react-native-iap` and
 * Expo's own IAP module. UNVERIFIED FROM HERE: which of them supports Expo SDK
 * 52 / RN 0.76 with a config plugin, and what their current APIs look like. Do
 * not take the shape of the calls below from this comment — check the library's
 * own docs against the version actually installed.
 *
 * Whatever is chosen needs a dev-client rebuild, exactly like
 * modules/expo-arabic-speech: billing cannot work in Expo Go.
 *
 * --- queryEntitlement ------------------------------------------------------
 * Ask the store for the purchases attached to the signed-in account, then map:
 *
 *   an unexpired subscription for coach_monthly / coach_annual
 *       -> { kind: 'entitled', plan, expiresAt: <the store's expiry, in ms> }
 *   a purchase of coach_lifetime
 *       -> { kind: 'entitled', plan: 'lifetime', expiresAt: null }
 *   the store answered and there is nothing
 *       -> { kind: 'notEntitled' }
 *   no network, no Play Services, a timeout, a thrown error, a connection that
 *   never came up, a response the code does not recognise
 *       -> { kind: 'unknown' }
 *
 * That last line is the whole point of this module and the easiest thing to get
 * wrong, because most billing wrappers report a failed query as "no purchases".
 * Anything ambiguous is `unknown`. A wrong `notEntitled` locks a paying user out
 * of their revision schedule on a plane; a wrong `unknown` costs, at worst, the
 * 30-day grace in entitlement.ts.
 *
 * If the store reports a purchase that needs acknowledging, acknowledge it.
 * BELIEVED, VERIFY AGAINST PLAY'S OWN DOCS BEFORE SHIPPING: Play automatically
 * refunds and revokes a purchase that is not acknowledged within three days. A
 * one-line mistake there looks exactly like a support inbox full of people whose
 * purchase evaporated.
 *
 * --- purchase --------------------------------------------------------------
 * Launch the store's own sheet. The app must not draw anything that looks like a
 * payment form; the only thing that may take a card here is Google Play.
 *
 * Map the user backing out to `cancelled` and say nothing to them about it —
 * they already know, and a worship app that argues with a dismissed purchase
 * sheet is the kind of app this one exists as an alternative to. On success,
 * return the plan and the expiry the STORE reports, never a locally computed
 * one: the device clock is not evidence of anything.
 *
 * --- restore, with no backend ----------------------------------------------
 * This is the part that needs thinking about rather than typing, because "no
 * accounts, no backend" sounds like it should make restore impossible.
 *
 * The reasoning, which is the basis of the lifetime caveat in plans.ts and of
 * the copy on app/upgrade.tsx: a Play purchase is not held by this app, it is
 * held by Google against the Google account that made it. Play Billing exposes a
 * query for the purchases the signed-in account owns for this package, so
 * "restore" is not a transfer of anything — it is just asking that question
 * again and folding the answer in. A reinstall, a factory reset, or a second
 * Android device signed into the same Google account should therefore all
 * recover the entitlement with no server and no login of ours, and a subscription
 * on a phone with no network keeps working from the local snapshot plus the
 * offline grace instead.
 *
 * UNVERIFIED FROM HERE, AND IT MATTERS: the above is reasoned from Play
 * Billing's documented model, not from an observed device. Nobody on this
 * project has yet watched a purchase survive a reinstall. Before the switch in
 * plans.ts is flipped, that has to be tested for real on two devices and one
 * reinstall, and it belongs in docs/acceptance-log.md next to the recitation
 * tests. If it turns out not to hold, the honest fix is to say so on the upgrade
 * screen — not to add a backend.
 *
 * What CANNOT be restored, and what the upgrade screen already says out loud:
 * a promo grant (entitlement.ts `grantPromo`) lives only in this device's
 * AsyncStorage, because there is nothing else for it to live in. A promo user who
 * reinstalls needs another code. Google Play's own promo-code redemption is the
 * mechanism to hand out, precisely because Play then owns the record.
 *
 * --- what must NOT be built here -------------------------------------------
 * No receipt validation server. No user ids, no device fingerprints, no
 * "anonymous" identifier that is in practice an identity. If entitlement ever
 * appears to need one of those, the answer is a more generous offline grace, not
 * a backend — this app's whole claim is that nothing about the user leaves the
 * phone, and billing is not an exception to it.
 * =========================================================================== */
