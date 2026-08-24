/**
 * The surah screen: exactly two tabs, Listen | Read (spec §6.1).
 *
 * There is no Memorize tab — memorization is a MODE inside Read. And Read is not
 * a reader with a microphone bolted on; Read IS the recitation view.
 *
 * The route parameter seeds the FIRST page only. After that this screen is a
 * pure view of the global cursor (spec §2): reciting into another surah changes
 * the cursor, the deck follows, and this screen never navigates. That is why
 * there is no router call anywhere below.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import {
  ayahByGlobal,
  ayahWordRange,
  globalAyahOf,
  pageOf,
  pageWordRange,
  surahInfo,
  surahOf,
  wordIndexOf,
} from '../../src/data/quran';
import { PageDeck, type PageDeckHandle } from '../../src/components/PageDeck';
import { MistakeSheet } from '../../src/components/MistakeSheet';
import { SummaryCard, weakestAyahOf } from '../../src/components/SummaryCard';
import { DebugOverlay } from '../../src/components/DebugOverlay';
import {
  Chip,
  HeardPill,
  IconToggle,
  MicButton,
  OfflineBadge,
  StatsColumn,
} from '../../src/components/controls';
import { useRecitation, type ReadMode } from '../../src/context/RecitationProvider';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, space } from '../../src/theme/theme';
import { ListenPanel } from '../../src/components/ListenPanel';
import { loadProgress } from '../../src/data/storage';

type Tab = 'listen' | 'read';

/** The header auto-hides this long after listening starts (§6.4). */
const HEADER_HIDE_MS = 2000;

export default function SurahScreen() {
  const params = useLocalSearchParams<{ id?: string; ayah?: string; tab?: string }>();
  const router = useRouter();
  const { palette, fontStep, reduceMotion, prefs, setPrefs } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const recitation = useRecitation();

  const {
    session,
    recognizer,
    level,
    mode,
    setMode,
    viewedPage,
    setViewedPage,
    awayFromPlace,
    returnToMyPlace,
    hintLevelOf,
    requestHint,
    start,
    stop,
    resumeSession,
    resetStats,
    seekTo,
    dismissMistake,
    elapsedMs,
    summary,
    dismissSummary,
    logSummaryToTracker,
    interruption,
    clearInterruption,
    silenceTimedOut,
    captureFixture,
    setRange,
    range,
    practiseRange,
    registerPlaybackStopper,
  } = recitation;

  const seedSurah = clampSurah(Number(params.id ?? '1'));
  const seedAyah = params.ayah === undefined ? 1 : Number(params.ayah);

  // The entry point decides: Listen tab -> listening, Quran tab -> reading.
  // Showing both choices on the surah screen was redundant with the tab bar.
  const [tab, setTab] = useState<Tab>(params.tab === 'listen' ? 'listen' : 'read');
  const [headerVisible, setHeaderVisible] = useState(true);
  const [mistakesOpen, setMistakesOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [selecting, setSelecting] = useState<number | null>(null);
  const deck = useRef<PageDeckHandle>(null);
  const seeded = useRef(false);

  const listening = session.status === 'listening';

  // --- seed the cursor once, from the route, or from where we left off (§6.7)
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const explicit = params.ayah !== undefined;
    void loadProgress().then((progress) => {
      const saved = progress[String(seedSurah)];
      const word =
        explicit || saved === undefined
          ? wordIndexOf(seedSurah, Number.isFinite(seedAyah) ? seedAyah : 1)
          : saved.cursor;
      seekTo(word);
      setViewedPage(pageOf(word));
      deck.current?.goToPage(pageOf(word), false);
    });
  }, [params.ayah, seedAyah, seedSurah, seekTo, setViewedPage]);

  // --- auto page-turn: the deck follows the voice (§6.1) ---
  const cursorPage = pageOf(session.livePos);
  useEffect(() => {
    if (!listening) return;
    if (viewedPage !== cursorPage) return;
    deck.current?.goToPage(cursorPage, !reduceMotion);
  }, [cursorPage, listening, reduceMotion, viewedPage]);

  // --- the text is the interface: hide the header while listening (§6.4) ---
  useEffect(() => {
    if (!listening) {
      setHeaderVisible(true);
      return undefined;
    }
    const id = setTimeout(() => setHeaderVisible(false), HEADER_HIDE_MS);
    return () => clearTimeout(id);
  }, [listening]);

  // The surah shown in the header comes from the PAGE IN VIEW, not the route.
  // Swiping into another surah relabels the header; it does not navigate.
  const viewedSurah = surahOf(pageWordRange(viewedPage)[0]);
  const info = surahInfo(viewedSurah);
  const liveAyah = ayahByGlobal(globalAyahOf(session.livePos));

  const onWordPress = useCallback(
    (index: number) => {
      if (mode === 'hidden' && !session.matched.has(index)) {
        // in Hidden mode a tap is the hint ladder, not a seek (§6.2)
        requestHint(index);
        return;
      }
      if (selecting !== null) {
        setRange({ from: Math.min(selecting, index), to: Math.max(selecting, index) });
        setSelecting(null);
        return;
      }
      seekTo(index);
    },
    [mode, requestHint, seekTo, selecting, session.matched, setRange],
  );

  const onWordLongPress = useCallback(
    (index: number) => {
      // long press = start reciting from here (§6.7)
      start(index);
    },
    [start],
  );

  const modeOptions = useMemo(
    () =>
      [
        {
          value: 'follow' as ReadMode,
          icon: 'eye-outline' as const,
          label: 'Follow mode',
          hint: 'Everything visible; recited words settle into full ink',
        },
        {
          value: 'hidden' as ReadMode,
          icon: 'eye-off-outline' as const,
          label: 'Hidden mode',
          hint: 'Words are concealed and revealed as you recite them',
        },
      ],
    [],
  );

  const onToggleMic = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  /**
   * First run lands here via router.replace from onboarding, so there is no
   * history to pop and the back arrow did nothing at all. Fall back to the tab
   * this screen belongs to.
   */
  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(tab === 'listen' ? '/(tabs)/listen' : '/(tabs)/quran');
  }, [router, tab]);

  const nextHintTarget = session.livePos;

  const bottomPad = Math.max(insets.bottom, space.sm);

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        {headerVisible ? (
          <View style={styles.header}>
            <Pressable
              onPress={goBack}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={24} color={palette.text} />
            </Pressable>
            <View style={styles.headerCentre}>
              <Text style={[styles.headerArabic, { color: palette.text }]}>{info.name}</Text>
              <Text style={[styles.headerLatin, { color: palette.textMuted }]}>
                {info.transliteration} · page {viewedPage} · juz {liveAyah.juz}
              </Text>
            </View>
            <Pressable
              onPress={() => router.push('/settings')}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <Ionicons name="options-outline" size={22} color={palette.text} />
            </Pressable>
          </View>
        ) : null}

      </SafeAreaView>

      {/* One tap anywhere brings the header back (§6.4) */}
      <Pressable style={styles.deck} onPress={() => setHeaderVisible(true)} accessible={false}>
        {tab === 'read' ? (
          <PageDeck
            ref={deck}
            session={session}
            page={viewedPage}
            onPageChange={setViewedPage}
            hidden={mode === 'hidden'}
            fontStep={fontStep}
            palette={palette}
            reduceMotion={reduceMotion}
            level={level}
            hintLevelOf={hintLevelOf}
            onWordPress={onWordPress}
            onWordLongPress={onWordLongPress}
            width={width}
          />
        ) : (
          <ListenPanel
            palette={palette}
            reciter={prefs.reciter}
            onReciterChange={(reciter) => setPrefs({ reciter })}
            onFollowWord={seekTo}
            cursor={session.livePos}
            fontStep={fontStep}
          />
        )}
      </Pressable>

      {/* floating affordances, all inside the bottom third */}
      {/* Recitation notices belong to the Read view. In Listen they sat on top of
          the reciter row, which is what made them feel like they never left. */}
      <View
        style={[styles.floating, { bottom: bottomPad + 96 }]}
        pointerEvents="box-none"
      >
       {tab === 'read' ? (
        <>
        {awayFromPlace ? (
          <Chip
            label={`Return to my place · ${liveAyah.surah}:${liveAyah.ayah}`}
            icon="return-down-back-outline"
            tone="accent"
            palette={palette}
            onPress={() => {
              returnToMyPlace();
              deck.current?.goToPage(pageOf(session.livePos), !reduceMotion);
            }}
            accessibilityHint="Scrolls back to the page your voice is on"
          />
        ) : null}

        {interruption !== null ? (
          <Chip
            label={`Paused: ${interruption}. Tap to resume`}
            icon="play"
            tone="accent"
            palette={palette}
            onPress={() => {
              clearInterruption();
              resumeSession();
            }}
          />
        ) : null}

        {silenceTimedOut ? (
          <Chip label="Still there? Tap to carry on" icon="ear-outline" tone="accent" palette={palette} onPress={resumeSession} />
        ) : null}

        {range !== null ? (
          <Chip
            label={`Practising ${rangeLabel(range.from, range.to)} · tap to clear`}
            icon="repeat"
            tone="accent"
            palette={palette}
            onPress={() => setRange(null)}
          />
        ) : null}

        {selecting !== null ? (
          <Chip label="Now tap the last word of the range" icon="hand-left-outline" palette={palette} onPress={() => setSelecting(null)} />
        ) : null}

        {recognizer.status === 'unavailable' ? (
          <OfflineBadge palette={palette} label="Recitation needs the dev-client build" />
        ) : null}

        {/* A dead recognizer used to fail in complete silence: the microphone
            opened, the level meter moved, and nothing was ever recognised, with
            no indication why. Every one of these states is now visible. */}
        {recognizer.status === 'error' && recognizer.lastError !== null ? (
          <Chip
            label={recognizer.lastError.message}
            icon="alert-circle-outline"
            tone="error"
            palette={palette}
            onPress={() => router.push('/settings')}
            accessibilityHint="Opens settings, where you can change the recognizer locale"
          />
        ) : null}

        {listening && !recognizer.heardSomething ? (
          <Chip
            label="Listening — nothing recognised yet"
            icon="ellipsis-horizontal"
            palette={palette}
            onPress={() => setTranscriptOpen(true)}
            accessibilityHint="The microphone is open but the recognizer has not returned any words yet"
          />
        ) : null}

        {recognizer.offlineDropped ? (
          <Chip
            label="No offline Arabic — recognising online"
            icon="cloud-outline"
            palette={palette}
            onPress={() => void recognizer.requestLanguagePack()}
            accessibilityHint="Downloads the on-device Arabic model so recitation stays on your phone"
          />
        ) : null}

        {recognizer.languageStatus !== null &&
        recognizer.languageStatus.supported &&
        recognizer.languageStatus.localeInstalled === false ? (
          <Chip
            label="Install Arabic offline pack"
            icon="cloud-download-outline"
            tone="accent"
            palette={palette}
            onPress={() => void recognizer.requestLanguagePack()}
            accessibilityHint="Downloads the on-device Arabic model so recitation works without a network"
          />
        ) : null}

        </>
       ) : null}

        <HeardPill
          text={session.lastHeard}
          expanded={transcriptOpen}
          onToggle={() => setTranscriptOpen((v) => !v)}
          transcript={session.sessionHeard.slice(-40)}
          palette={palette}
          reduceMotion={reduceMotion}
        />

        {prefs.showDebugOverlay ? (
          <DebugOverlay session={session} recognizer={recognizer} palette={palette} captureFixture={captureFixture} />
        ) : null}
      </View>

      <View
        style={[
          styles.bottomBar,
          { paddingBottom: bottomPad, backgroundColor: palette.background, borderColor: palette.border },
        ]}
      >
        <StatsColumn
          elapsedMs={elapsedMs}
          mistakeCount={session.mistakes.length}
          onReset={resetStats}
          onOpenMistakes={() => setMistakesOpen(true)}
          palette={palette}
        />

        <View style={styles.bottomActions}>
          {tab === 'read' ? (
            <IconToggle options={modeOptions} value={mode} onChange={setMode} palette={palette} />
          ) : null}

          {mode === 'hidden' && tab === 'read' ? (
            <Pressable
              onPress={() => requestHint(nextHintTarget)}
              accessibilityRole="button"
              accessibilityLabel="Hint"
              accessibilityHint="First tap shows the word's first letter, second tap shows the whole word"
              style={[styles.hintButton, { borderColor: palette.accent, backgroundColor: palette.accentSoft }]}
            >
              <Ionicons name="bulb-outline" size={18} color={palette.primary} />
              <Text style={[styles.hintLabel, { color: palette.primary }]}>
                {hintLevelOf(nextHintTarget) === 0 ? 'Hint' : hintLevelOf(nextHintTarget) === 1 ? 'Reveal' : 'Shown'}
              </Text>
            </Pressable>
          ) : tab === 'read' ? (
            <Pressable
              onPress={() => setSelecting(session.livePos)}
              accessibilityRole="button"
              accessibilityLabel="Practise an ayah range"
              accessibilityHint="Select a first and last word to loop"
              style={[styles.hintButton, { borderColor: palette.border }]}
            >
              <Ionicons name="repeat" size={18} color={palette.textMuted} />
            </Pressable>
          ) : null}

          <MicButton
            listening={listening}
            level={level}
            onPress={onToggleMic}
            palette={palette}
            reduceMotion={reduceMotion}
            disabled={recognizer.status === 'unavailable'}
          />
        </View>
      </View>

      <MistakeSheet
        visible={mistakesOpen}
        mistakes={session.mistakes}
        palette={palette}
        onClose={() => setMistakesOpen(false)}
        onDismiss={dismissMistake}
        onGoToWord={(word) => {
          setMistakesOpen(false);
          setViewedPage(pageOf(word));
          deck.current?.goToPage(pageOf(word), !reduceMotion);
        }}
        onPractise={(word) => {
          const ayah = ayahByGlobal(globalAyahOf(word));
          const [from, to] = ayahWordRange(ayah.surah, ayah.ayah);
          practiseRange(from, to - 1);
          setMistakesOpen(false);
        }}
        onPlayWord={(word) => {
          // Audio is whole surahs now, so there is no single-ayah file to play.
          // Jump to the word on the page instead of opening a player that would
          // start the surah from the beginning.
          setMistakesOpen(false);
          setViewedPage(pageOf(word));
          deck.current?.goToPage(pageOf(word), !reduceMotion);
        }}
      />

      <SummaryCard
        summary={summary}
        palette={palette}
        onClose={dismissSummary}
        onLog={() => {
          void logSummaryToTracker().then(dismissSummary);
        }}
        onPractise={() => {
          if (summary !== null) {
            // Prefer the ayah the hifz scheduler graded lowest; fall back to the
            // first word that needed a hint.
            const weakest = weakestAyahOf(summary);
            const target =
              weakest !== null
                ? ayahByGlobal(weakest)
                : summary.hintedWords.length > 0
                  ? ayahByGlobal(globalAyahOf(summary.hintedWords[0]))
                  : null;
            if (target !== null) {
              const [from, to] = ayahWordRange(target.surah, target.ayah);
              practiseRange(from, to - 1);
            }
          }
          dismissSummary();
        }}
      />
    </View>
  );
}

function rangeLabel(from: number, to: number): string {
  const a = ayahByGlobal(globalAyahOf(from));
  const b = ayahByGlobal(globalAyahOf(to));
  return a.surah === b.surah && a.ayah === b.ayah
    ? `${a.surah}:${a.ayah}`
    : `${a.surah}:${a.ayah}–${b.ayah}`;
}

const clampSurah = (n: number): number => (Number.isFinite(n) && n >= 1 && n <= 114 ? Math.floor(n) : 1);

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeTop: {},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  headerCentre: { alignItems: 'center' },
  headerArabic: { fontFamily: 'Amiri_700Bold', fontSize: 22 },
  headerLatin: { fontSize: 11, marginTop: 1 },
  deck: { flex: 1 },
  floating: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    alignItems: 'flex-start',
    gap: space.sm,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bottomActions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  hintButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  hintLabel: { fontSize: 13, fontWeight: '600' },
});
