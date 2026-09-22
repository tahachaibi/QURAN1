/**
 * The paid tier with the master switch ON — the half of the wiring that no test
 * could reach before.
 *
 * REGRESSION THIS PINS, and it is not a small one. Every assertion in
 * billingWiring.test.tsx runs with MONETISATION_ENABLED false, which means
 * `sellable` on app/upgrade.tsx is false before either of its other two clauses
 * is even evaluated. So the two guards the brief called the things that matter
 * most — refusing to sell to a phone that cannot hear Arabic, and never asking
 * for money while somebody is reciting — were dead code as far as the suite was
 * concerned: both could be deleted and the whole suite stayed green. (Verified
 * by doing it: replacing `sellable` with `monetisationEnabled` alone failed
 * nothing.) Same for the settings row, which was only ever asserted absent, and
 * for `can()`, which only ever answered "yes" to everything.
 *
 * `plans` is mocked rather than edited, because MONETISATION_ENABLED must stay
 * false in the real module and __tests__/billing.test.ts asserts exactly that.
 * Mocking it here is what lets both facts be true at once: the app ships dormant,
 * and the day somebody flips the switch these tests already say what has to
 * happen.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Settings from '../app/settings';
import Upgrade from '../app/upgrade';
import { BillingProvider, useBilling, type BillingContextValue } from '../src/billing/BillingProvider';
import { COACH_FEATURES, FREE_FOREVER } from '../src/billing/gates';
import { type EntitlementSnapshot, type StoreAnswer } from '../src/billing/entitlement';
import type { BillingStore, PurchaseOutcome, StoreProduct } from '../src/billing/store';

const ENTITLEMENT_KEY = 'qh:entitlement:v1';
const DAY = 86_400_000;

// --- mocks -----------------------------------------------------------------

/**
 * The one mock that is the point of this file: the same module the real app
 * reads, with the switch flipped. Everything else in plans.ts — the three plans,
 * the never-promise, the lifetime caveat — stays real, because the screen renders
 * it and the copy is half of what is under test.
 */
jest.mock('../src/billing/plans', () => ({
  ...jest.requireActual('../src/billing/plans'),
  MONETISATION_ENABLED: true,
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const READY_CAPABILITIES = {
  sdkInt: 34,
  recognitionAvailable: true,
  onDeviceAvailable: true,
  segmentedAvailable: true,
  strategy: 'SEGMENTED' as const,
  segmentedProven: true,
};

const mockRecognizer = {
  linked: true,
  capabilities: { ...READY_CAPABILITIES } as Record<string, unknown> | null,
  languageStatus: { supported: true, localeInstalled: true } as Record<string, unknown> | null,
  strategy: 'SEGMENTED',
  lastError: null,
  requestLanguagePack: () => Promise.resolve(),
};
const mockSession = { status: 'idle' as 'idle' | 'listening' | 'paused' | 'stopped' };
const mockPush = jest.fn();

jest.mock('../src/context/RecitationProvider', () => ({
  useRecitation: () => ({ recognizer: mockRecognizer, session: mockSession }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('../src/theme/ThemeProvider', () => {
  const { lightPalette: palette } = require('../src/theme/theme');
  const { DEFAULT_PREFS } = require('../src/data/storage');
  return {
    useTheme: () => ({
      palette,
      dark: false,
      reduceMotion: false,
      highContrast: false,
      fontStep: DEFAULT_PREFS.fontStep,
      prefs: DEFAULT_PREFS,
      setPrefs: () => undefined,
    }),
  };
});

// --- helpers ---------------------------------------------------------------

const PRODUCTS: readonly StoreProduct[] = [
  { planId: 'monthly', sku: 'coach_monthly', price: 'MAD 29,99' },
  { planId: 'annual', sku: 'coach_annual', price: 'MAD 199,00' },
  { planId: 'lifetime', sku: 'coach_lifetime', price: 'MAD 499,00' },
];

function reachableStore(over: Partial<BillingStore> = {}): BillingStore & { calls: string[] } {
  const calls: string[] = [];
  const base: BillingStore = {
    name: 'test',
    isReachable: () => {
      calls.push('isReachable');
      return Promise.resolve(true);
    },
    queryEntitlement: () => {
      calls.push('queryEntitlement');
      return Promise.resolve<StoreAnswer>({ kind: 'unknown' });
    },
    listProducts: () => {
      calls.push('listProducts');
      return Promise.resolve(PRODUCTS);
    },
    purchase: () => {
      calls.push('purchase');
      return Promise.resolve<PurchaseOutcome>({ kind: 'cancelled' });
    },
    restore: () => {
      calls.push('restore');
      return Promise.resolve<StoreAnswer>({ kind: 'unknown' });
    },
  };
  return { ...base, ...over, calls };
}

let seen: BillingContextValue | null = null;

function Probe() {
  seen = useBilling();
  return null;
}

/**
 * Mounts and then drains the provider's promise chain.
 *
 * The mount effect is three promises deep (loadEntitlement -> isReachable ->
 * listProducts), and one `await act` only flushes the microtasks queued at the
 * time it runs, so a single pass leaves `products` empty and `storeReachable`
 * null — which looks exactly like the bug this file is here to catch.
 */
async function mount(node: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(node);
  });
  await act(async () => undefined);
  await act(async () => undefined);
  return tree;
}

const text = (tree: ReactTestRenderer): string => {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (n !== null && typeof n === 'object' && 'children' in n) {
      walk((n as { children: unknown }).children);
    }
  };
  walk(tree.toJSON());
  return out.join(' ');
};

/** every accessibility label in the tree that belongs to something pressable */
const pressableLabels = (tree: ReactTestRenderer): Set<string> => {
  const labels = new Set<string>();
  for (const node of tree.root.findAll(
    (n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string',
  )) {
    labels.add(node.props.accessibilityLabel as string);
  }
  return labels;
};

const buyLabels = (tree: ReactTestRenderer): string[] =>
  [...pressableLabels(tree)].filter((l) => l.startsWith('Buy'));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  seen = null;
  mockRecognizer.linked = true;
  mockRecognizer.capabilities = { ...READY_CAPABILITIES };
  mockRecognizer.languageStatus = { supported: true, localeInstalled: true };
  mockSession.status = 'idle';
});

// --- the provider, once there is something to ask about --------------------

describe('the provider with the switch on', () => {
  it('asks the store exactly the three things it needs', async () => {
    const store = reachableStore();
    const tree = await mount(
      <BillingProvider store={store}>
        <Probe />
      </BillingProvider>,
    );
    // the mirror image of "never talks to a store while monetisation is off":
    // that test cannot tell a correct guard from a store that is simply never
    // wired up, and this one can.
    expect(store.calls).toContain('isReachable');
    expect(store.calls).toContain('listProducts');
    expect(store.calls).toContain('queryEntitlement');
    expect(seen?.storeReachable).toBe(true);
    expect(seen?.products).toEqual(PRODUCTS);
    tree.unmount();
  });

  it('does not re-ask about a lifetime purchase', async () => {
    // shouldRecheck refuses to re-query a settled purchase, because the only
    // thing a flaky store can do to a lifetime record is take it away.
    const lifetime: EntitlementSnapshot = { plan: 'lifetime', goodUntil: null, checkedAt: 0, source: 'play' };
    await AsyncStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(lifetime));
    const store = reachableStore();
    const tree = await mount(
      <BillingProvider store={store}>
        <Probe />
      </BillingProvider>,
    );
    expect(store.calls).not.toContain('queryEntitlement');
    tree.unmount();
  });

  it('gates the coach and only the coach', async () => {
    const tree = await mount(
      <BillingProvider store={reachableStore()}>
        <Probe />
      </BillingProvider>,
    );
    // With nothing bought, the coach is locked...
    for (const feature of COACH_FEATURES) {
      expect(seen?.can(feature)).toBe(false);
    }
    // ...and every act of worship still is not. This is the assertion that
    // would catch somebody adding followAlong or the mushaf to the paid set:
    // gates.ts forbids it structurally, and this says the wiring agrees.
    for (const feature of FREE_FOREVER) {
      expect(seen?.can(feature)).toBe(true);
    }
    tree.unmount();
  });

  it('unlocks the coach for a subscriber, and keeps it through the offline grace', async () => {
    const lapsed: EntitlementSnapshot = {
      plan: 'annual',
      // expired two days ago, and the store has said nothing since
      goodUntil: Date.now() - 2 * DAY,
      checkedAt: Date.now() - 2 * DAY,
      source: 'play',
    };
    await AsyncStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(lapsed));
    const tree = await mount(
      <BillingProvider store={reachableStore()}>
        <Probe />
      </BillingProvider>,
    );
    expect(seen?.state).toEqual({ active: true, reason: 'grace', plan: 'annual' });
    for (const feature of COACH_FEATURES) {
      expect(seen?.can(feature)).toBe(true);
    }
    tree.unmount();
  });
});

// --- the upgrade screen, once it is allowed to sell ------------------------

const renderUpgrade = (store: BillingStore = reachableStore()): Promise<ReactTestRenderer> =>
  mount(
    <BillingProvider store={store}>
      <Upgrade />
    </BillingProvider>,
  );

describe('the upgrade screen with the switch on', () => {
  it('offers the three plans at the price the store gave, and no other price', async () => {
    const tree = await renderUpgrade();
    expect(buyLabels(tree).sort()).toEqual(['Buy Monthly', 'Buy One payment, forever', 'Buy Yearly']);
    expect(pressableLabels(tree).has('Restore purchases')).toBe(true);
    const rendered = text(tree);
    expect(rendered).toContain('MAD 199,00');
    /**
     * The pre-conversion US figure in plans.ts is not what anybody outside the
     * US would be charged, so the row's `usd()` fallback must be gone the moment
     * a real price exists.
     *
     * Asserted on the fallback's own sentence rather than on /\$\d+\.\d\d/,
     * because a dollar figure DOES survive here and it is not this screen's to
     * remove: PLANS[annual].note is the literal string "Works out at about $1.67
     * a month.", so a phone shown "MAD 199,00" is also shown a dollar
     * equivalent. That belongs to plans.ts. Flagged there, not papered over
     * here.
     */
    expect(rendered).not.toContain('US list price');
    // and the caveat is still on the screen, before the purchase rather than after
    expect(rendered).toContain('will not carry across');
    tree.unmount();
  });

  it('sells nothing to a phone that cannot recognise Arabic', async () => {
    // THE HOLE THIS FILE WAS WRITTEN FOR. The switch-off version of this test
    // passes even with the readiness clause deleted, because nothing is for sale
    // either way. Here the same device state has to be the only reason.
    mockRecognizer.languageStatus = { supported: false, detail: 'no Arabic model' };
    const tree = await renderUpgrade();
    expect(buyLabels(tree)).toEqual([]);
    expect(pressableLabels(tree).has('Restore purchases')).toBe(false);
    const rendered = text(tree);
    expect(rendered).toContain('cannot recognise Arabic');
    expect(rendered).toContain('nothing in the app is locked');
    // no price may be drawn next to a refusal
    expect(rendered).not.toContain('MAD 199,00');
    tree.unmount();
  });

  it('sells nothing in a build that cannot listen at all', async () => {
    mockRecognizer.linked = false;
    mockRecognizer.capabilities = null;
    mockRecognizer.languageStatus = null;
    const tree = await renderUpgrade();
    expect(buyLabels(tree)).toEqual([]);
    expect(text(tree)).toContain('cannot listen at all');
    tree.unmount();
  });

  it('still sells to a phone that only warrants a caution', async () => {
    // The distinction matters: a missing offline pack is a warning, not a
    // refusal, and a readiness check that blocked on it would refuse most phones.
    mockRecognizer.languageStatus = { supported: true, localeInstalled: false };
    const tree = await renderUpgrade();
    expect(buyLabels(tree)).toHaveLength(3);
    expect(text(tree)).toContain('No offline Arabic pack');
    tree.unmount();
  });

  it.each(['listening', 'paused'] as const)(
    'asks for nothing while a recitation is %s',
    async (status) => {
      // The other rule this file exists for, and the one with no test at all
      // before it: the app never asks for money while somebody is reciting. A
      // paused session counts — they stopped mid-page, they did not finish.
      mockSession.status = status;
      const tree = await renderUpgrade();
      expect(buyLabels(tree)).toEqual([]);
      expect(pressableLabels(tree).has('Restore purchases')).toBe(false);
      const rendered = text(tree);
      expect(rendered).toContain('middle of a recitation');
      expect(rendered).not.toContain('MAD 199,00');
      tree.unmount();
    },
  );

  it('explains a grace period instead of showing a subscriber a price', async () => {
    // The other side of the dormant-state test: once the switch is on, a plan
    // that could not be confirmed must be described as honoured-from-this-phone,
    // not silently dropped and not reported as an expiry.
    const lapsed: EntitlementSnapshot = {
      plan: 'annual',
      goodUntil: Date.now() - 2 * DAY,
      checkedAt: Date.now() - 2 * DAY,
      source: 'play',
    };
    await AsyncStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(lapsed));
    const tree = await renderUpgrade();
    const rendered = text(tree);
    expect(rendered).toContain('could not be confirmed with Google Play');
    expect(rendered).toContain('Nothing is locked');
    tree.unmount();
  });

  it('withholds the price rather than inventing one when the store is unreachable', async () => {
    const tree = await renderUpgrade(reachableStore({ isReachable: () => Promise.resolve(false) }));
    const rendered = text(tree);
    expect(rendered).toContain('Google Play cannot be reached');
    expect(rendered).not.toContain('MAD 199,00');
    // the US list price may only appear alongside the sentence that says it is
    // not what you would be charged
    expect(rendered).toContain('is the US list price before your');
    tree.unmount();
  });
});

// --- settings --------------------------------------------------------------

describe('the settings row with the switch on', () => {
  it('appears as a plain row and goes to the upgrade screen', async () => {
    const tree = await mount(
      <BillingProvider store={reachableStore()}>
        <Settings />
      </BillingProvider>,
    );
    const rendered = text(tree);
    expect(rendered).toContain('Unlock the coach');
    // it says what is NOT paid for, on the row itself, so the first mention of
    // money in this app is also the one that says worship stays free
    expect(rendered).toContain('stay free');

    const row = tree.root.find(
      (n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === 'Unlock the coach',
    );
    await act(async () => {
      (row.props.onPress as () => void)();
    });
    expect(mockPush).toHaveBeenCalledWith('/upgrade');
    tree.unmount();
  });

  it('shows the subscriber their plan instead of an offer', async () => {
    const lifetime: EntitlementSnapshot = { plan: 'lifetime', goodUntil: null, checkedAt: 0, source: 'play' };
    await AsyncStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(lifetime));
    const tree = await mount(
      <BillingProvider store={reachableStore()}>
        <Settings />
      </BillingProvider>,
    );
    const rendered = text(tree);
    expect(rendered).toContain('Coach — active');
    expect(rendered).not.toContain('Unlock the coach');
    tree.unmount();
  });
});
