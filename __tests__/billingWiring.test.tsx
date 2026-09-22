/**
 * The paid tier as it is actually wired into the app.
 *
 * The entitlement arithmetic is already pinned in billing.test.ts. What is
 * pinned here is everything around it that a person would notice:
 *
 *  - the provider never makes anybody wait, never asks a store that does not
 *    exist, and never writes a record that did not change;
 *  - a cancelled purchase and an unreachable store leave a subscriber alone;
 *  - the upgrade screen tells the truth about what this phone can hear and what
 *    the coach cannot judge, BEFORE it mentions a price;
 *  - and with MONETISATION_ENABLED false — every build today — none of it is
 *    visible. No row in settings, no price, no buy button, nothing locked.
 *
 * The recognizer, the theme and the router are mocked because none of them is
 * what is under test here; AsyncStorage is NOT mocked away, because "did this
 * write actually happen" is half the point.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import Settings from '../app/settings';
import Upgrade, { priceOf, recitationReadiness, usd } from '../app/upgrade';
import { BillingProvider, useBilling, type BillingContextValue } from '../src/billing/BillingProvider';
import { COACH_FEATURES, FREE_FOREVER } from '../src/billing/gates';
import { NOT_ENTITLED, type EntitlementSnapshot } from '../src/billing/entitlement';
import { MONETISATION_ENABLED } from '../src/billing/plans';
import type { BillingStore, PurchaseOutcome, StoreProduct } from '../src/billing/store';
import type { StoreAnswer } from '../src/billing/entitlement';
import { lightPalette } from '../src/theme/theme';

const ENTITLEMENT_KEY = 'qh:entitlement:v1';
const DAY = 86_400_000;

// --- mocks -----------------------------------------------------------------

/**
 * The real AsyncStorage needs a native module. Its own in-memory jest mock is
 * used rather than mocking src/data/storage, because "was this record actually
 * written, and only when it changed" is one of the things under test.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/** mutated per test; the prefix is what lets jest.mock's factory see it */
const mockRecognizer = {
  linked: true,
  capabilities: {
    sdkInt: 34,
    recognitionAvailable: true,
    onDeviceAvailable: true,
    segmentedAvailable: true,
    strategy: 'SEGMENTED' as const,
    segmentedProven: true,
  } as Record<string, unknown> | null,
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

/** a store that counts what it was asked, so "never asked" is provable */
function countingStore(over: Partial<BillingStore> = {}): BillingStore & { calls: string[] } {
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
      return Promise.resolve<readonly StoreProduct[]>([]);
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

async function mountProvider(store: BillingStore): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <BillingProvider store={store}>
        <Probe />
        <Text>children rendered</Text>
      </BillingProvider>,
    );
  });
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

const buttonsLabelled = (tree: ReactTestRenderer, match: RegExp): unknown[] =>
  tree.root.findAll(
    (n) =>
      typeof n.props.onPress === 'function' &&
      typeof n.props.accessibilityLabel === 'string' &&
      match.test(n.props.accessibilityLabel),
  );

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  seen = null;
  mockRecognizer.linked = true;
  mockRecognizer.capabilities = {
    sdkInt: 34,
    recognitionAvailable: true,
    onDeviceAvailable: true,
    segmentedAvailable: true,
    strategy: 'SEGMENTED',
    segmentedProven: true,
  };
  mockRecognizer.languageStatus = { supported: true, localeInstalled: true };
  mockSession.status = 'idle';
});

// --- the provider ----------------------------------------------------------

describe('BillingProvider', () => {
  it('renders its children before it knows anything', () => {
    // Synchronous first pass, deliberately not awaited: an app that waited on a
    // storage read to draw the mushaf would be a worse bug than any billing one.
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <BillingProvider store={countingStore()}>
          <Probe />
          <Text>children rendered</Text>
        </BillingProvider>,
      );
    });
    expect(text(tree)).toContain('children rendered');
    expect(seen?.loaded).toBe(false);
    expect(seen?.snapshot).toEqual(NOT_ENTITLED);
    tree.unmount();
  });

  it('picks up a snapshot already on the device', async () => {
    const lifetime: EntitlementSnapshot = { plan: 'lifetime', goodUntil: null, checkedAt: 0, source: 'play' };
    await AsyncStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(lifetime));
    const tree = await mountProvider(countingStore());
    expect(seen?.loaded).toBe(true);
    expect(seen?.state).toEqual({ active: true, reason: 'lifetime', plan: 'lifetime' });
    tree.unmount();
  });

  it('never talks to a store while monetisation is off', async () => {
    // Not "does not show the result of" — does not ask. There is no store, no
    // price and nothing locked, so a query would be a network call for nothing.
    const store = countingStore();
    const tree = await mountProvider(store);
    expect(MONETISATION_ENABLED).toBe(false);
    expect(store.calls).toEqual([]);
    expect(seen?.storeReachable).toBeNull();
    expect(seen?.products).toEqual([]);
    tree.unmount();
  });

  it('locks nothing while monetisation is off', async () => {
    const tree = await mountProvider(countingStore());
    for (const feature of [...FREE_FOREVER, ...COACH_FEATURES]) {
      expect(seen?.can(feature)).toBe(true);
    }
    tree.unmount();
  });

  it('writes nothing to storage when the store says nothing', async () => {
    // applyStoreAnswer returns the previous snapshot by identity on 'unknown',
    // and this is the test that says the provider USES that rather than
    // re-serialising an unchanged record every time the phone wakes up.
    const before: EntitlementSnapshot = { plan: 'annual', goodUntil: Date.now() + 100 * DAY, checkedAt: Date.now(), source: 'play' };
    await AsyncStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(before));
    const tree = await mountProvider(countingStore());
    // the seeding write above is on the same mock, so the count starts here
    const setItem = AsyncStorage.setItem as jest.Mock;
    setItem.mockClear();

    let answer: StoreAnswer | undefined;
    await act(async () => {
      answer = await seen!.restore();
    });

    expect(answer).toEqual({ kind: 'unknown' });
    expect(setItem).not.toHaveBeenCalled();
    expect(seen?.snapshot).toEqual(before);
    tree.unmount();
  });

  it('persists a purchase the store confirms', async () => {
    const store = countingStore({
      purchase: () => Promise.resolve<PurchaseOutcome>({ kind: 'purchased', plan: 'lifetime', expiresAt: null }),
    });
    const tree = await mountProvider(store);

    await act(async () => {
      await seen!.buy('lifetime');
    });

    expect(seen?.state.active).toBe(true);
    const stored = JSON.parse((await AsyncStorage.getItem(ENTITLEMENT_KEY)) ?? 'null') as EntitlementSnapshot;
    expect(stored.plan).toBe('lifetime');
    expect(stored.goodUntil).toBeNull();
    tree.unmount();
  });

  it('a cancelled purchase takes nothing away', async () => {
    // The user tapped Buy, looked at the price and closed the sheet. That says
    // nothing about the subscription they already have.
    const before: EntitlementSnapshot = { plan: 'annual', goodUntil: Date.now() + 100 * DAY, checkedAt: Date.now(), source: 'play' };
    await AsyncStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(before));
    const tree = await mountProvider(countingStore());
    const setItem = AsyncStorage.setItem as jest.Mock;
    setItem.mockClear();

    let outcome: PurchaseOutcome | undefined;
    await act(async () => {
      outcome = await seen!.buy('lifetime');
    });

    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(seen?.state.active).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('survives a billing library that throws', async () => {
    const store = countingStore({
      purchase: () => Promise.reject(new Error('BillingClient not connected')),
      restore: () => Promise.reject(new Error('BillingClient not connected')),
    });
    const tree = await mountProvider(store);

    let outcome: PurchaseOutcome | undefined;
    let answer: StoreAnswer | undefined;
    await act(async () => {
      outcome = await seen!.buy('annual');
      answer = await seen!.restore();
    });

    expect(outcome?.kind).toBe('failed');
    // the message has to say what did NOT happen, because the user just tapped Buy
    expect(outcome?.kind === 'failed' && outcome.detail).toContain('Nothing was charged');
    // a thrown restore is silence, never "you own nothing"
    expect(answer).toEqual({ kind: 'unknown' });
    expect(seen?.snapshot).toEqual(NOT_ENTITLED);
    tree.unmount();
  });
});

// --- can this phone do the thing being sold --------------------------------

describe('recitationReadiness', () => {
  const caps = (over: Record<string, unknown> = {}) =>
    ({
      sdkInt: 34,
      recognitionAvailable: true,
      onDeviceAvailable: true,
      segmentedAvailable: true,
      strategy: 'SEGMENTED',
      segmentedProven: true,
      ...over,
    }) as never;

  it('blocks a build with no speech module in it', () => {
    const r = recitationReadiness({ linked: false, capabilities: null, languageStatus: null });
    expect(r.level).toBe('blocked');
    expect(r.detail).toContain('dev-client');
  });

  it('blocks a phone with no recognition service', () => {
    const r = recitationReadiness({
      linked: true,
      capabilities: caps({ recognitionAvailable: false }),
      languageStatus: { supported: true } as never,
    });
    expect(r.level).toBe('blocked');
  });

  it('blocks a phone whose recognizer has no Arabic', () => {
    const r = recitationReadiness({
      linked: true,
      capabilities: caps(),
      languageStatus: { supported: false, detail: 'ar not listed' } as never,
    });
    expect(r.level).toBe('blocked');
    expect(r.detail).toContain('ar not listed');
  });

  it('never reads "ready" from an unanswered question', () => {
    // The capabilities arrive asynchronously. "Not asked yet" and "asked, and
    // it is fine" must not look the same to somebody about to pay.
    expect(recitationReadiness({ linked: true, capabilities: null, languageStatus: null }).level).toBe('caution');
    expect(
      recitationReadiness({ linked: true, capabilities: caps(), languageStatus: null }).level,
    ).toBe('caution');
  });

  it('warns when the Arabic pack is missing, without refusing', () => {
    const r = recitationReadiness({
      linked: true,
      capabilities: caps(),
      languageStatus: { supported: true, localeInstalled: false } as never,
    });
    // online recognition genuinely works, so this is a warning and not a refusal
    expect(r.level).toBe('caution');
    expect(r.detail).toContain('network');
  });

  it('is ready only when recognition and the Arabic pack are both there', () => {
    const r = recitationReadiness({
      linked: true,
      capabilities: caps(),
      languageStatus: { supported: true, localeInstalled: true } as never,
    });
    expect(r.level).toBe('ready');
  });
});

describe('prices', () => {
  it('prefers the store price and refuses to invent one', () => {
    const products: StoreProduct[] = [{ planId: 'annual', sku: 'coach_annual', price: 'MAD 199,00' }];
    expect(priceOf('annual', products)).toBe('MAD 199,00');
    // no product means no price — plans.ts holds a pre-conversion US figure,
    // which is not what anybody outside the US would be charged
    expect(priceOf('lifetime', products)).toBeNull();
    expect(usd(1999)).toBe('$19.99');
  });
});

// --- the upgrade screen ----------------------------------------------------

async function renderUpgrade(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <BillingProvider store={countingStore()}>
        <Upgrade />
      </BillingProvider>,
    );
  });
  return tree;
}

describe('the upgrade screen', () => {
  it('offers nothing at all while monetisation is off', async () => {
    const tree = await renderUpgrade();
    const rendered = text(tree);
    expect(buttonsLabelled(tree, /^Buy/)).toHaveLength(0);
    expect(buttonsLabelled(tree, /Restore/)).toHaveLength(0);
    expect(rendered).toContain('There is nothing to buy');
    // no price anywhere: the only "$" allowed on this screen is the one in the
    // sentence about not being able to afford it
    expect(rendered).not.toMatch(/\$\d+\.\d\d/);
    tree.unmount();
  });

  it('does not call a leftover record "active" while nothing is for sale', async () => {
    // A device can hold an entitlement record with the switch off — a dev build,
    // or a restored backup. With monetisation off `can()` already answers yes to
    // everything, so an "Active: Yearly." line would contradict the paragraph
    // that says every feature is available anyway, and would read as if the free
    // build were the paid one.
    const stored: EntitlementSnapshot = { plan: 'annual', goodUntil: Date.now() + 100 * DAY, checkedAt: Date.now(), source: 'play' };
    await AsyncStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(stored));
    const tree = await renderUpgrade();
    const rendered = text(tree);
    expect(rendered).not.toContain('Active:');
    expect(rendered).toContain('There is nothing to buy');
    tree.unmount();
  });

  it('says what the coach does not know, before anything about money', async () => {
    const tree = await renderUpgrade();
    const rendered = text(tree);
    expect(rendered).toContain('does not grade tajweed');
    expect(rendered).toContain('العالمين');
    expect(rendered).toContain('docs/decisions.md');
    // and the limits come before the plans in the tree, not in a footnote
    expect(rendered.indexOf('does not grade tajweed')).toBeLessThan(rendered.indexOf('Plans'));
    tree.unmount();
  });

  it('carries the lifetime caveat before any purchase, not after', async () => {
    const tree = await renderUpgrade();
    expect(text(tree)).toContain('will not carry across');
    tree.unmount();
  });

  it('tells a student how to get it for nothing', async () => {
    const tree = await renderUpgrade();
    const rendered = text(tree);
    expect(rendered).toContain('Redeem code');
    // and is honest that an in-app grant does not survive a reinstall
    expect(rendered).toContain('reinstalling loses it');
    tree.unmount();
  });

  it('refuses to sell to a phone that cannot hear Arabic', async () => {
    mockRecognizer.languageStatus = { supported: false, detail: 'no Arabic model' };
    const tree = await renderUpgrade();
    const rendered = text(tree);
    expect(rendered).toContain('cannot recognise Arabic');
    expect(rendered).toContain('nothing in the app is locked');
    expect(buttonsLabelled(tree, /^Buy/)).toHaveLength(0);
    tree.unmount();
  });

  it('never draws a Quranic word in red', async () => {
    // The mishearing caveat lists real Quran words inside a warning. The rule
    // against red on Quran text has no exception for bad news.
    const tree = await renderUpgrade();
    const arabic = /[؀-ۿ]/;
    const flatten = (style: unknown): Record<string, unknown>[] =>
      Array.isArray(style) ? style.flatMap(flatten) : style !== null && typeof style === 'object' ? [style as Record<string, unknown>] : [];
    const offenders = tree.root.findAll(
      (n) =>
        typeof n.type === 'function' &&
        flatten(n.props.style).some((s) => s.color === lightPalette.error) &&
        arabic.test(JSON.stringify(n.props.children ?? '')),
    );
    expect(offenders).toHaveLength(0);
    tree.unmount();
  });
});

// --- settings --------------------------------------------------------------

describe('settings', () => {
  it('shows no paywall row while monetisation is off', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <BillingProvider store={countingStore()}>
          <Settings />
        </BillingProvider>,
      );
    });
    const rendered = text(tree);
    expect(rendered).not.toContain('Unlock the coach');
    expect(rendered).not.toContain('Coach — active');
    expect(buttonsLabelled(tree, /coach/i)).toHaveLength(0);
    // and nothing navigated anywhere
    expect(mockPush).not.toHaveBeenCalled();
    // the settings screen it replaced is still intact
    expect(rendered).toContain('Recognizer locale');
    tree.unmount();
  });
});
