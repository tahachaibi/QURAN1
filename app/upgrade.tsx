/**
 * The upgrade screen — one of exactly three places this app may mention money
 * (src/billing/gates.ts PAYWALL_SITES), and the only one that names a price.
 *
 * Two things on this screen matter more than how it looks.
 *
 * It refuses to sell to a phone that cannot do the thing being sold. What is for
 * sale is the app's reading of the user's recitation, and that reading depends on
 * an Android speech recognizer that can handle Arabic. Plenty of devices cannot:
 * no recognition service, no Arabic model, or a build with the native module
 * missing entirely. `recitationReadiness` below turns what the recognizer reports
 * into one of three answers, and on `blocked` there are no buy buttons at all —
 * not disabled ones with an explanation, none. Taking money from a phone that
 * cannot hear Arabic is a refund, a one-star review, and a worse thing than
 * having sold nothing.
 *
 * And it says what the coach does NOT know. It follows WHICH word you said, not
 * HOW you said it: there is no tajweed judgement anywhere in this codebase, and
 * the word-level thresholds in the matcher genuinely treat some near-identical
 * words as equal (docs/decisions.md, "Known weaknesses I did not paper over").
 * Selling somebody a verdict on their Quran without disclosing that is the
 * ethical hole in charging for this at all, so the disclosure is on the purchase
 * screen, above the prices, in the same type size as everything else.
 *
 * With MONETISATION_ENABLED false — which is every build today — this screen
 * stays reachable by route so it can be worked on, and shows no prices, no buy
 * buttons and no restore action. Nothing anywhere else in the app links to it.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { LanguageStatus, SpeechCapabilities } from '../modules/expo-arabic-speech';
import { useBilling } from '../src/billing/BillingProvider';
import {
  LIFETIME_CAVEAT,
  NEVER_PROMISE,
  PLANS,
  planById,
  type Plan,
  type PlanId,
} from '../src/billing/plans';
import type { StoreProduct } from '../src/billing/store';
import { useRecitation } from '../src/context/RecitationProvider';
import { useTheme } from '../src/theme/ThemeProvider';
import { radius, space } from '../src/theme/theme';

/**
 * Can this device actually do what is being sold?
 *
 * Pure and exported so it can be tested without a phone, because the honest
 * answer here is the difference between a product and a refund.
 *
 *  - `blocked`  there is no path to Arabic recognition on this device or in this
 *               build. Nothing may be sold.
 *  - `caution`  it should work, but something is missing or unknown, and the user
 *               is told before paying rather than after.
 *  - `ready`    recognition is present and the Arabic model is installed.
 *
 * Anything unknown is `caution`, never `ready`. The recognizer reports its
 * capabilities asynchronously, so "not established yet" and "established as
 * fine" must not be allowed to look the same to a person about to pay.
 */
export type ReadinessLevel = 'blocked' | 'caution' | 'ready';

export interface Readiness {
  level: ReadinessLevel;
  headline: string;
  detail: string;
}

export function recitationReadiness(input: {
  linked: boolean;
  capabilities: SpeechCapabilities | null;
  languageStatus: LanguageStatus | null;
}): Readiness {
  const { linked, capabilities, languageStatus } = input;

  if (!linked) {
    return {
      level: 'blocked',
      headline: 'This build cannot listen at all.',
      detail:
        'The speech module is not linked into this binary, which is what happens in Expo Go. Install a dev-client build and open this screen again.',
    };
  }

  if (capabilities !== null && !capabilities.recognitionAvailable) {
    return {
      level: 'blocked',
      headline: 'This phone has no speech recognition service.',
      detail:
        'Android reports no recognizer available, so nothing can follow your recitation here. Installing Google app / Speech Services from Play sometimes provides one. Until it does, there is nothing on this screen worth buying.',
    };
  }

  if (languageStatus !== null && !languageStatus.supported) {
    return {
      level: 'blocked',
      headline: 'This phone cannot recognise Arabic.',
      detail:
        (languageStatus.detail ?? 'The recognizer does not list Arabic among the languages it supports.') +
        ' The coach has nothing to work from on this device, so it is not for sale here.',
    };
  }

  if (capabilities === null || languageStatus === null) {
    return {
      level: 'caution',
      headline: 'Not checked on this device yet.',
      detail:
        'The app has not yet established what this phone can hear. Start a recitation once, check Settings › Recognizer on this device, and come back — do not pay for a coach that has never followed your voice.',
    };
  }

  if (languageStatus.localeInstalled !== true) {
    return {
      level: 'caution',
      headline: 'No offline Arabic pack on this phone.',
      detail:
        'Recognition will work, but it goes out to the network for every phrase: slower, and useless with no signal. Settings offers to install the Arabic pack, and it is worth doing before paying for anything.',
    };
  }

  return {
    level: 'ready',
    headline: 'Arabic recognition is working on this device.',
    detail: 'Recognition is available and the Arabic pack is installed on this phone.',
  };
}

/** US list price, formatted. Only ever shown with the caveat next to it. */
export const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/**
 * The price to put next to a buy button.
 *
 * The store's own formatted price when there is one, and otherwise null — which
 * the row renders as "no price yet" rather than as the US figure. plans.ts is
 * explicit that its numbers are a pre-conversion proposal; presenting them as
 * what the user will be charged would be false in most of the markets this app
 * is built for.
 */
export function priceOf(plan: PlanId, products: readonly StoreProduct[]): string | null {
  return products.find((p) => p.planId === plan)?.price ?? null;
}

export default function Upgrade() {
  const { palette } = useTheme();
  const { recognizer, session } = useRecitation();
  const { monetisationEnabled, products, state, storeReachable, busy, restore } = useBilling();
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);

  const readiness = recitationReadiness({
    linked: recognizer.linked,
    capabilities: recognizer.capabilities,
    languageStatus: recognizer.languageStatus,
  });

  /**
   * The app does not ask for money while somebody is reciting.
   *
   * This screen is only reachable from settings or the tracker, but the session
   * lives above the router, so it is entirely possible to arrive here with the
   * microphone open. A paused session counts: the user stopped mid-page, they did
   * not finish.
   */
  const reciting = session.status === 'listening' || session.status === 'paused';

  const sellable = monetisationEnabled && readiness.level !== 'blocked' && !reciting;

  const onRestore = (): void => {
    void restore().then((answer) => {
      setRestoreMessage(
        answer.kind === 'entitled'
          ? 'Restored. The coach is unlocked on this device.'
          : answer.kind === 'notEntitled'
            ? 'Google Play has no purchase for the account signed in on this phone. If you bought it with a different Google account, sign in with that one.'
            : 'Could not reach Google Play. Nothing was changed — whatever you already had is untouched. Try again when you have a connection.',
      );
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.lede, { color: palette.text }]}>
        The Quran, the mushaf, following along with your voice, prayer times, the adhan and the adhkar are
        free, and stay free. What can be paid for is the app&apos;s record of what you recited and what it
        concluded about it: your revision schedule, your mistake history, the ayahs it thinks are weakest,
        and a backup of all of it.
      </Text>

      {/* Device honesty first, above any price. */}
      <View
        style={[
          styles.banner,
          {
            backgroundColor: readiness.level === 'ready' ? palette.successSoft : palette.errorSoft,
            borderColor: readiness.level === 'ready' ? palette.success : palette.error,
          },
        ]}
      >
        <Text
          style={[
            styles.bannerHeadline,
            { color: readiness.level === 'ready' ? palette.success : palette.error },
          ]}
        >
          {readiness.headline}
        </Text>
        <Text style={[styles.bannerDetail, { color: palette.text }]}>{readiness.detail}</Text>
        {readiness.level === 'blocked' ? (
          <Text style={[styles.bannerDetail, { color: palette.text }]}>
            Nothing is offered for sale on this device, and nothing in the app is locked.
          </Text>
        ) : null}
      </View>

      {/* What it does not know. Above the prices, on purpose. */}
      <Section title="What the coach does not know" palette={palette}>
        <Text style={[styles.body, { color: palette.text }]}>
          It follows <Text style={styles.strong}>which</Text> word you said, not{' '}
          <Text style={styles.strong}>how</Text> you said it. It does not grade tajweed, it has no opinion
          on your makharij or your madd, and a green page means the words arrived in the right order — not
          that you recited them well.
        </Text>
        <Text style={[styles.body, { color: palette.text }]}>
          It also mishears. The word-matching thresholds accept a single letter&apos;s difference, so these
          pairs compare as equal today:
        </Text>
        {/*
          Quranic words, so they are drawn in ordinary ink even though they sit
          inside a caveat — the rule against red on Quran text does not have an
          exception for bad news.
        */}
        <Text style={[styles.pairs, { color: palette.text }]}>
          يوم / قوم {'   '}العالمين / الظالمين {'   '}الحمد / الحميد
        </Text>
        <Text style={[styles.body, { color: palette.textMuted }]}>
          In practice the aligner prevents most of it — once it is locked on, your voice is only compared
          against the next few expected words. But a mistake row can be the recognizer&apos;s fault rather
          than yours, the app says so when it can tell, and you can always mark a word &ldquo;I said it
          right&rdquo;. The pairs above are recorded in docs/decisions.md rather than left to be discovered.
        </Text>
        <Text style={[styles.body, { color: palette.textMuted }]}>
          None of this has yet been verified on a real device against a real reciter
          (docs/acceptance-log.md). That is why nothing here is for sale.
        </Text>
      </Section>

      {reciting ? (
        <Text style={[styles.body, { color: palette.textMuted }]}>
          You are in the middle of a recitation. This screen does not ask for anything while you are — go
          back to the page, and it will still be here afterwards.
        </Text>
      ) : null}

      {sellable ? (
        <Section title="Plans" palette={palette}>
          {PLANS.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              price={priceOf(plan.id, products)}
              palette={palette}
              disabled={busy || storeReachable !== true}
            />
          ))}
          <Text style={[styles.body, { color: palette.textMuted }]}>{LIFETIME_CAVEAT}</Text>
          {storeReachable !== true ? (
            <Text style={[styles.body, { color: palette.textMuted }]}>
              Google Play cannot be reached from this phone right now, so nothing can be bought. Nothing is
              locked either.
            </Text>
          ) : null}
        </Section>
      ) : (
        <Section title="Plans" palette={palette}>
          {/*
            Dormant, not hidden: the route exists so this screen can be built and
            tested, but with the master switch off it must not carry a price, a
            button, or anything that reads as an offer.
          */}
          <Text style={[styles.body, { color: palette.text }]}>
            There is nothing to buy. Every feature in this app is available to you right now, including the
            revision schedule and the mistake history. The paid tier is built but switched off until the
            recitation tracking has been verified on real devices.
          </Text>
          <Text style={[styles.body, { color: palette.textMuted }]}>{LIFETIME_CAVEAT}</Text>
        </Section>
      )}

      <Section title="What this app will never do" palette={palette}>
        {NEVER_PROMISE.map((line) => (
          <Text key={line} style={[styles.body, { color: palette.text }]}>
            {line}
          </Text>
        ))}
      </Section>

      <Section title="If you cannot afford it" palette={palette}>
        <Text style={[styles.body, { color: palette.text }]}>
          Ask. A promo code can be redeemed in the Google Play app — look for &ldquo;Redeem code&rdquo;
          under payments and subscriptions — and it unlocks the same thing a payment does. Nobody should be
          kept out of their own revision schedule because of $3.
        </Text>
        <Text style={[styles.body, { color: palette.textMuted }]}>
          A code granted by hand inside the app is remembered only on this phone, so reinstalling loses it;
          a Play promo code does not, because Google holds the record.
        </Text>
      </Section>

      {sellable ? (
        <Section title="Already paid?" palette={palette}>
          <Pressable
            onPress={onRestore}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Restore purchases"
            accessibilityState={{ disabled: busy }}
            style={[styles.button, { backgroundColor: busy ? palette.border : palette.primary }]}
          >
            <Text style={[styles.buttonLabel, { color: palette.paper }]}>Restore purchases</Text>
          </Pressable>
          <Text style={[styles.body, { color: palette.textMuted }]}>
            Your purchase belongs to your Google account, not to this app — there is no account here to log
            into. Reinstalling, or signing in on another Android phone, should bring it back.
          </Text>
          {restoreMessage !== null ? (
            <Text style={[styles.body, { color: palette.text }]}>{restoreMessage}</Text>
          ) : null}
        </Section>
      ) : null}

      {/*
        Gated on the master switch as well as on the snapshot. A device can hold
        an 'active' record while monetisation is off — a leftover from a dev
        build, or a restored backup — and with the switch off `can()` already
        answers yes to everything, so telling that user they have an active plan
        would contradict the paragraph above it ("every feature is available to
        you right now") and imply the free build is the paid one.
      */}
      {monetisationEnabled && state.active ? (
        <Text style={[styles.body, { color: palette.textMuted }]}>
          {state.reason === 'grace'
            ? `Your ${planLabel(state.plan)} could not be confirmed with Google Play recently, so it is being honoured from this phone's own record. Nothing is locked.`
            : `Active: ${planLabel(state.plan)}.`}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const planLabel = (plan: PlanId): string => planById(plan)?.label ?? plan;

// --- small building blocks (same shapes as app/settings.tsx) ---

type Palette = ReturnType<typeof useTheme>['palette'];

function Section({
  title,
  palette,
  children,
}: {
  title: string;
  palette: Palette;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.textMuted }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        {children}
      </View>
    </View>
  );
}

function PlanRow({
  plan,
  price,
  palette,
  disabled,
}: {
  plan: Plan;
  price: string | null;
  palette: Palette;
  disabled: boolean;
}) {
  const { buy, busy } = useBilling();
  const [outcome, setOutcome] = useState<string | null>(null);

  const onBuy = (): void => {
    void buy(plan.id).then((result) => {
      // A cancelled sheet gets no message at all: the user closed it, they know.
      setOutcome(
        result.kind === 'purchased'
          ? 'Done. Jazak Allahu khayran.'
          : result.kind === 'cancelled'
            ? null
            : result.detail,
      );
    });
  };

  return (
    <View style={styles.planRow}>
      <View style={styles.planText}>
        <Text style={[styles.planLabel, { color: palette.text }]}>{plan.label}</Text>
        <Text style={[styles.body, { color: palette.textMuted }]}>{plan.note}</Text>
        {price === null ? (
          <Text style={[styles.body, { color: palette.textMuted }]}>
            No price from Google Play yet. {usd(plan.usdCents)} is the US list price before your
            country&apos;s conversion, so it is not what you would be charged.
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onBuy}
        disabled={disabled || busy}
        accessibilityRole="button"
        accessibilityLabel={`Buy ${plan.label}`}
        accessibilityState={{ disabled: disabled || busy }}
        style={[styles.button, { backgroundColor: disabled || busy ? palette.border : palette.primary }]}
      >
        <Text style={[styles.buttonLabel, { color: palette.paper }]}>{price ?? '—'}</Text>
      </Pressable>
      {outcome !== null ? <Text style={[styles.body, { color: palette.text }]}>{outcome}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.md, gap: space.md, paddingBottom: space.xxl },
  lede: { fontSize: 14, lineHeight: 21 },
  section: { gap: space.xs },
  sectionTitle: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.sm,
  },
  banner: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.xs,
  },
  bannerHeadline: { fontSize: 14, fontWeight: '700' },
  bannerDetail: { fontSize: 13, lineHeight: 19 },
  body: { fontSize: 13, lineHeight: 19 },
  strong: { fontWeight: '700' },
  pairs: { fontSize: 18, lineHeight: 30, writingDirection: 'rtl', textAlign: 'center' },
  planRow: { gap: space.xs },
  planText: { gap: 2 },
  planLabel: { fontSize: 14, fontWeight: '700' },
  button: { borderRadius: radius.pill, paddingVertical: 12, alignItems: 'center' },
  buttonLabel: { fontSize: 14, fontWeight: '700' },
});
