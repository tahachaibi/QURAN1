/**
 * The one place the entitlement snapshot lives.
 *
 * Mounted in app/_layout.tsx, above the router, for the same reason
 * RecitationProvider is: the answer to "has this person paid" must not be
 * re-derived per screen, and it must not be re-asked of the store every time
 * somebody opens settings.
 *
 * Three rules shaped this file, and all three are about NOT doing something.
 *
 *   1. It never blocks rendering. ThemeProvider returns null until preferences
 *      load, which is correct for it — the wrong font on Quranic text looks
 *      broken. Billing is the opposite case: with MONETISATION_ENABLED false
 *      nothing is gated at all, so a provider that waited on a storage read (let
 *      alone a store call) would delay the mushaf for a question whose answer
 *      cannot change what the user sees. Children render immediately with
 *      NOT_ENTITLED, and the snapshot arrives when it arrives.
 *
 *   2. It never asks the store when there is nothing to ask about. With the
 *      master switch off there is no store, no price and no locked feature, so
 *      the only thing this does is read the stored snapshot — which still
 *      matters, because a lifetime or promo record has to survive the switch
 *      being flipped later.
 *
 *   3. It only writes to storage when the snapshot actually changed, and it
 *      decides that by object IDENTITY rather than by comparing fields.
 *      `applyStoreAnswer` returns its input unchanged for an `unknown` answer,
 *      which is the ordinary outcome on a phone with no signal, so identity is
 *      both exactly right and free. A deep compare here would be slower and
 *      would quietly stop working the day the snapshot grows a field.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  NOT_ENTITLED,
  applyStoreAnswer,
  entitlementOf,
  isEntitled,
  shouldRecheck,
  type EntitlementSnapshot,
  type EntitlementState,
  type StoreAnswer,
} from './entitlement';
import { isAvailable, type Feature } from './gates';
import { MONETISATION_ENABLED, type PlanId } from './plans';
import { answerOf, nullStore, type BillingStore, type PurchaseOutcome, type StoreProduct } from './store';
import { loadEntitlement, saveEntitlement } from '../data/storage';

export interface BillingContextValue {
  /** the last thing the app established; NOT_ENTITLED until storage is read */
  snapshot: EntitlementSnapshot;
  /** the same thing, read as of now, with the reason the UI can explain */
  state: EntitlementState;
  /** has the stored snapshot been read — for copy only, never for gating */
  loaded: boolean;
  /** is a store call in flight — for a spinner only, never for gating */
  busy: boolean;
  /** the master switch, passed through so screens do not import it separately */
  monetisationEnabled: boolean;
  /**
   * Localised prices from the store. Empty whenever the store cannot be reached,
   * and a screen with no product for a plan must say it has no price rather than
   * fall back to the pre-conversion US figure in plans.ts.
   */
  products: readonly StoreProduct[];
  /** null until asked; false on an emulator, a dev build, and every build today */
  storeReachable: boolean | null;
  /** the only question the rest of the app should ask about a feature */
  can: (feature: Feature) => boolean;
  buy: (plan: PlanId) => Promise<PurchaseOutcome>;
  restore: () => Promise<StoreAnswer>;
}

const BillingContext = createContext<BillingContextValue | null>(null);

export function BillingProvider({
  children,
  /**
   * Defaults to `nullStore`, which is the whole of the billing implementation
   * that exists today. A real Play store is passed in here and nowhere else —
   * see the specification at the bottom of store.ts.
   */
  store = nullStore,
}: {
  children: ReactNode;
  store?: BillingStore;
}) {
  const [snapshot, setSnapshot] = useState<EntitlementSnapshot>(NOT_ENTITLED);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [products, setProducts] = useState<readonly StoreProduct[]>([]);
  const [storeReachable, setStoreReachable] = useState<boolean | null>(null);

  /**
   * The snapshot is mirrored in a ref because `fold` is called from promise
   * callbacks that outlive the render they were created in — a purchase that
   * resolves after the user has navigated away still has to be persisted, and
   * reading stale state there would throw the purchase away.
   */
  const snapshotRef = useRef<EntitlementSnapshot>(NOT_ENTITLED);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fold = useCallback((answer: StoreAnswer): EntitlementSnapshot => {
    const previous = snapshotRef.current;
    const next = applyStoreAnswer(previous, answer, Date.now());
    // Identity, deliberately: `unknown` returns `previous` itself, so an offline
    // phone that wakes up every hour rewrites nothing.
    if (next === previous) return previous;
    snapshotRef.current = next;
    // The write happens whether or not this component is still mounted: the
    // record is the user's, not the screen's.
    void saveEntitlement(next);
    if (alive.current) setSnapshot(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void loadEntitlement().then((stored) => {
      if (cancelled) return;
      snapshotRef.current = stored;
      setSnapshot(stored);
      setLoaded(true);

      // Nothing below this line has anything to do while the paid tier is
      // dormant: there is no store, no price to fetch and nothing locked.
      if (!MONETISATION_ENABLED) return;

      void store
        .isReachable()
        .then((reachable) => {
          if (cancelled) return;
          setStoreReachable(reachable);
          if (!reachable) return;

          void store
            .listProducts()
            .then((list) => {
              if (!cancelled) setProducts(list);
            })
            .catch(() => undefined); // no prices is a state the screen handles

          // Asking is never required, only worthwhile — a stale snapshot is
          // still honoured, so this is best-effort and its failure is silence.
          if (shouldRecheck(snapshotRef.current, Date.now())) {
            void store
              .queryEntitlement()
              .then(fold)
              .catch(() => fold({ kind: 'unknown' }));
          }
        })
        .catch(() => {
          if (!cancelled) setStoreReachable(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [store, fold]);

  const buy = useCallback(
    async (plan: PlanId): Promise<PurchaseOutcome> => {
      setBusy(true);
      try {
        const outcome = await store.purchase(plan);
        // `answerOf` turns everything except an actual purchase into `unknown`,
        // so a cancelled or failed attempt cannot revoke what is already owned.
        fold(answerOf(outcome));
        return outcome;
      } catch (cause) {
        // A billing library that throws is a bug in the library, not a reason to
        // white-screen a worship app.
        return {
          kind: 'failed',
          detail:
            'The store did not respond. Nothing was charged. ' +
            `Check the connection and try again. (${cause instanceof Error ? cause.message : String(cause)})`,
        };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [store, fold],
  );

  const restore = useCallback(async (): Promise<StoreAnswer> => {
    setBusy(true);
    try {
      const answer = await store.restore();
      fold(answer);
      return answer;
    } catch {
      // A failed restore must look like silence, never like "you own nothing".
      return { kind: 'unknown' };
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [store, fold]);

  const value = useMemo<BillingContextValue>(
    () => ({
      snapshot,
      state: entitlementOf(snapshot, Date.now()),
      loaded,
      busy,
      monetisationEnabled: MONETISATION_ENABLED,
      products,
      storeReachable,
      // `now` is read per call rather than captured, so a screen left open
      // across a grace boundary answers with the current time.
      can: (feature) =>
        isAvailable(feature, {
          entitled: isEntitled(snapshot, Date.now()),
          monetisationEnabled: MONETISATION_ENABLED,
        }),
      buy,
      restore,
    }),
    [snapshot, loaded, busy, products, storeReachable, buy, restore],
  );

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling(): BillingContextValue {
  const value = useContext(BillingContext);
  if (value === null) {
    throw new Error(
      'useBilling was called outside BillingProvider. The provider is mounted above the router in ' +
        'app/_layout.tsx; a screen that needs it must be rendered inside that tree.',
    );
  }
  return value;
}
