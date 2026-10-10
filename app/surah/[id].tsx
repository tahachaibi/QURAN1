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
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
  TOTAL_WORDS,
  wordIndexOf,
  words,
} from '../../src/data/quran';
import { useLead } from '../../src/hooks/useLead';
import { PageDeck, type PageDeckHandle } from '../../src/components/PageDeck';
import { MistakeSheet } from '../../src/components/MistakeSheet';
import { SummaryCard, weakestAyahOf } from '../../src/components/SummaryCard';
import { exportFixture } from '../../src/engine/exportFixture';
import { DebugOverlay } from '../../src/components/DebugOverlay';
import {
  Chip,
  HeardPill,
  IconToggle,
  micAction,
  MicButton,
  OfflineBadge,
  StatsColumn,
} from '../../src/components/controls';
import { useRecitation, useRecitationDebug, type ReadMode } from '../../src/context/RecitationProvider';
import type { SelfReportKind } from '../../src/engine/hifz';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, space } from '../../src/theme/theme';
import { ListenPanel } from '../../src/components/ListenPanel';
import { loadProgress } from '../../src/data/storage';
import { useT } from '../../src/i18n/useT';
import { recognizerErrorText } from '../../src/recognition/errorText';

type Tab = 'listen' | 'read';

/** For a recognizer that cannot say when it last heard a voice (tests). */
const NEVER = (): number => 0;

/** The header folds away this soon after listening starts (§6.4). */
const HEADER_HIDE_MS = 800;
/** ...and this long after a tap on the page brought it back while listening. */
const HEADER_PEEK_MS = 3000;
/**
 * Height of the status strip under the page. One chip or one line of heard
 * text; see the strip itself for why it is fixed rather than sized to content.
 */
const STATUS_STRIP_HEIGHT = 44;

export default function SurahScreen() {
  const params = useLocalSearchParams<{ id?: string; ayah?: string; tab?: string }>();
  const router = useRouter();
  const { palette, fontStep, reduceMotion, prefs, setPrefs } = useTheme();
  const { t, tr, arabic } = useT();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const recitation = useRecitation();
  // Debug-only and per-partial, so it is read from its own context; see
  // useRecitationDebug for why it is not in the shared one.
  const { partialGapMs } = useRecitationDebug();

  const {
    session,
    recognizer,
    level,
    mode,
    setMode,
    viewedPage,
    setViewedPage,
    returnToMyPlace,
    hintLevelOf,
    requestHint,
    start,
    stop,
    resumeSession,
    resetStats,
    seekTo,
    dismissMistake,
    undismissMistake,
    summary,
    dismissSummary,
    logSummaryToTracker,
    interruption,
    clearInterruption,
    silenceTimedOut,
    captureFixture,
    micPermission,
    openAppSettings,
    setRange,
    range,
    practiseRange,
    commitSelfReport,
    registerPlaybackStopper,
  } = recitation;

  const seedSurah = clampSurah(Number(params.id ?? '1'));
  const seedAyah = params.ayah === undefined ? 1 : Number(params.ayah);

  // The entry point decides: Listen tab -> listening, Quran tab -> reading.
  // Showing both choices on the surah screen was redundant with the tab bar.
  const [tab, setTab] = useState<Tab>(params.tab === 'listen' ? 'listen' : 'read');
  const [headerVisible, setHeaderVisible] = useState(true);
  const [mistakesOpen, setMistakesOpen] = useState(false);
  const [mistakeFocus, setMistakeFocus] = useState<number | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [selecting, setSelecting] = useState<number | null>(null);
  /** what the "I read this" commit just did; clears itself like the other notices */
  const [selfReportNote, setSelfReportNote] = useState<string | null>(null);
  const deck = useRef<PageDeckHandle>(null);
  const seeded = useRef(false);

  const listening = session.status === 'listening';
  const paused = session.status === 'paused';

  /**
   * The latest session, selection and start/stop, for callbacks that must not
   * change identity.
   *
   * The word callbacks go to every word on every mounted page, and both the
   * page and the word memo compare them by identity. Built on
   * `session.matched`, `session.mistakes` and a `start` that itself changes
   * with the cursor, they were new functions on every recognised word, so each
   * word repainted about three pages of words instead of one (§5.7). Read
   * through refs, they keep one identity for as long as the mode does.
   */
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const selectingRef = useRef(selecting);
  selectingRef.current = selecting;
  const startRef = useRef(start);
  startRef.current = start;
  const stopRef = useRef(stop);
  stopRef.current = stop;

  /**
   * Leaving the screen ends the recitation.
   *
   * The session lives in the provider, above the router, so popping this
   * screen left the microphone transcribing with nothing on screen to show it
   * or stop it: the screen kept awake, Android's microphone dot lit, and the
   * adhan held back for as long as the room stayed loud enough to keep the
   * silence timeout from firing. On unmount rather than on blur, so opening
   * Settings on top does not end it, while Back — the arrow, the replace path
   * and the hardware key, which pops the screen without going through goBack —
   * does. Stopped, not paused: a paused session nobody can see is the same
   * problem, quieter. stop() builds the summary as usual; it is shown when a
   * surah is next opened rather than lost.
   */
  useEffect(
    () => () => {
      const status = sessionRef.current.status;
      if (status === 'listening' || status === 'paused') stopRef.current();
    },
    [],
  );

  // --- seed the cursor once, from the route, or from where we left off (§6.7)
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const explicit = params.ayah !== undefined;
    /**
     * A LIVE session owns the cursor (§2), so a remount must not re-seed from
     * storage. This screen can be unmounted and remounted mid-session by the
     * tab bar, and the saved position is now written on a flush interval rather
     * than per recited word — so restoring from it would drag a live cursor
     * back to wherever the last flush happened to land. Follow the cursor that
     * is already there instead. An explicit route ayah still wins: that is
     * somebody asking to be taken somewhere.
     */
    if (!explicit && session.status !== 'idle') {
      setViewedPage(pageOf(session.cursor));
      deck.current?.goToPage(pageOf(session.cursor), false);
      return;
    }
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
  }, [params.ayah, seedAyah, seedSurah, seekTo, session.cursor, session.status, setViewedPage]);

  // --- the underline a beat ahead of the recognizer (src/engine/lead.ts) ---
  const lead = useLead({
    session,
    words,
    limit: range === null ? TOTAL_WORDS : range.to + 1,
    lastVoiceAt: recognizer.lastVoiceAt ?? NEVER,
    enabled: prefs.leadUnderline,
  });

  // --- auto page-turn: the deck follows the voice (§6.1) ---
  const cursorPage = pageOf(session.livePos);
  const followedPage = useRef(cursorPage);
  useEffect(() => {
    if (!listening) return;
    if (viewedPage !== cursorPage) return;
    // Slide to the next page; a jump across the mushaf goes straight there,
    // instead of scrolling through every page in between.
    const near = Math.abs(cursorPage - followedPage.current) <= 1;
    followedPage.current = cursorPage;
    deck.current?.goToPage(cursorPage, near && !reduceMotion);
  }, [cursorPage, listening, reduceMotion, viewedPage]);

  // --- the text is the interface: hide the header while listening (§6.4) ---
  // Keyed on headerVisible too: a tap on the page brings the header back for
  // the Back button, and it used to stay for the rest of the recitation,
  // since nothing hid it again until listening stopped.
  const listeningSince = useRef(0);
  useEffect(() => {
    if (listening) listeningSince.current = Date.now();
  }, [listening]);
  useEffect(() => {
    if (!listening) {
      setHeaderVisible(true);
      return undefined;
    }
    if (!headerVisible) return undefined;
    const justStarted = Date.now() - listeningSince.current < HEADER_HIDE_MS + 200;
    const id = setTimeout(() => setHeaderVisible(false), justStarted ? HEADER_HIDE_MS : HEADER_PEEK_MS);
    return () => clearTimeout(id);
  }, [listening, headerVisible]);

  // The surah shown in the header comes from the PAGE IN VIEW, not the route.
  // Swiping into another surah relabels the header; it does not navigate.
  const viewedSurah = surahOf(pageWordRange(viewedPage)[0]);
  const info = surahInfo(viewedSurah);
  const liveAyah = ayahByGlobal(globalAyahOf(session.livePos));
  /**
   * The juz of the page in view, beside that page's number. It was the juz of
   * the VOICE position, so browsing away from your place printed "page 300 ·
   * juz 1". Taken from the page's LAST word: four pages hold the end of one
   * juz and the start of the next (62, 121, 201, 502), and the printed mushaf
   * and juzStartPage both count those as the later juz.
   */
  const pageJuz = ayahByGlobal(globalAyahOf(pageWordRange(viewedPage)[1] - 1)).juz;
  /**
   * "Return to my place" is for a voice that is live, or paused and coming
   * back. The provider's flag holds for any status but idle, and a session
   * never returns to idle once stopped, so after the first recitation every
   * ordinary page swipe raised the chip over the page.
   */
  const awayFromPlace = (listening || paused) && viewedPage !== pageOf(session.livePos);

  const onWordPress = useCallback(
    (index: number) => {
      const current = sessionRef.current;
      const selection = selectingRef.current;
      if (selection === null && current.mistakes.some((m) => m.word === index)) {
        // a word with a red dot: tapping it answers "what did I do wrong here"
        setMistakeFocus(index);
        setMistakesOpen(true);
        return;
      }
      // In Hidden mode a tap on a CONCEALED word is the hint ladder, not a seek
      // (§6.2). Everything below the cursor is already shown in full, matched
      // or not (a seeded position, a jump), and a tap there is a seek like
      // anywhere else; as a hint it filed a word the reciter never needed help
      // with under "Needed a hint", "Shaky" and that ayah's grade.
      if (mode === 'hidden' && index >= current.cursor && !current.matched.has(index)) {
        requestHint(index);
        return;
      }
      if (selection !== null) {
        // practiseRange, not the bare setter: it also puts the cursor on the
        // range's FIRST word. With the bare setter, a last word tapped before
        // your position left the cursor at the range's end, so the mic began
        // aligning from the wrong end of the very passage being practised.
        practiseRange(Math.min(selection, index), Math.max(selection, index));
        setSelecting(null);
        return;
      }
      seekTo(index);
    },
    [mode, practiseRange, requestHint, seekTo],
  );

  const onWordLongPress = useCallback((index: number) => {
    // long press = start reciting from here (§6.7)
    startRef.current(index);
  }, []);

  const modeOptions = useMemo(
    () =>
      [
        {
          value: 'follow' as ReadMode,
          icon: 'eye-outline' as const,
          label: t('Follow mode'),
          hint: t('Everything visible; recited words settle into full ink'),
        },
        {
          value: 'hidden' as ReadMode,
          icon: 'eye-off-outline' as const,
          label: t('Hidden mode'),
          hint: t('Words are concealed and revealed as you recite them'),
        },
      ],
    [t],
  );

  const onToggleMic = useCallback(() => {
    const action = micAction(session.status);
    if (action === 'stop') stop();
    else if (action === 'resume') resumeSession();
    else start();
  }, [resumeSession, session.status, start, stop]);

  /**
   * The reset icon is 13 px beside the timer, and what it wipes — the time,
   * the matched words, the mistakes since the last checkpoint — cannot be
   * brought back. A stray tap mid-recitation is the likeliest way to reach
   * it, so it asks first.
   */
  const confirmReset = useCallback(() => {
    Alert.alert(t('Reset session stats?'), t('This clears the time and mistakes for this session.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Reset'), style: 'destructive', onPress: resetStats },
    ]);
  }, [resetStats, t]);

  /**
   * The non-voice way into the revision deck, from the page itself.
   *
   * Which claim it records comes from the mode you are already in, so there is
   * no extra choice to make: Hidden mode conceals the text and reveals it as
   * you recall, which is revision from memory; Follow mode has the words in
   * front of you, which is reading. Neither is a matched recitation and the
   * deck says so either way — the mode only decides how much of a claim the
   * reciter is making.
   */
  const selfReportKind: SelfReportKind = mode === 'hidden' ? 'revised' : 'read';
  const selfReportRange = useMemo((): [number, number] => {
    if (range !== null) return [range.from, range.to];
    // pageWordRange is [from, to); commitSelfReport wants an inclusive last word
    const [from, to] = pageWordRange(viewedPage);
    return [from, to - 1];
  }, [range, viewedPage]);

  const onSelfReport = useCallback(() => {
    const [from, to] = selfReportRange;
    void commitSelfReport(selfReportKind, from, to).then((added) => {
      setSelfReportNote(
        added === 0
          ? t('Already in your revision schedule from earlier today.')
          : added === 1
            ? t('1 ayah added to revision, as read rather than heard.')
            : t('{n} ayahs added to revision, as read rather than heard.', { n: added }),
      );
    });
  }, [commitSelfReport, selfReportKind, selfReportRange, t]);

  useEffect(() => {
    if (selfReportNote === null) return undefined;
    const id = setTimeout(() => setSelfReportNote(null), 5000);
    return () => clearTimeout(id);
  }, [selfReportNote]);

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
  /**
   * The bottom bar's real height, so the floating notice sits ON the status
   * strip. A guessed 96 px put it 12 px up inside the page.
   */
  const [barHeight, setBarHeight] = useState<number | null>(null);
  const floatingBottom =
    tab === 'read' ? (barHeight ?? bottomPad + 84) + STATUS_STRIP_HEIGHT : bottomPad;

  /**
   * ONE notice at a time, the most urgent. They float over the foot of the
   * page, and stacked they covered its last line — the very thing the status
   * strip was built to stop — with the ones that stay up for good (a practice
   * range, the offline pack) adding a chip each. Most urgent first: something
   * is broken, then something needs an answer, then where you are, then the
   * standing reminders. Read view only: in Listen they sat on the reciter row.
   */
  let notice: ReactNode = null;
  if (recognizer.status === 'unavailable') {
    notice = <OfflineBadge palette={palette} label={t('Recitation needs the dev-client build')} />;
  } else if (recognizer.status === 'error' && recognizer.lastError !== null) {
    // A dead recognizer used to fail in complete silence: the microphone
    // opened, the level meter moved, and nothing was ever recognised, with no
    // indication why. Every one of these states is now visible.
    notice = (
      <Chip
        label={recognizerErrorText(recognizer.lastError, t)}
        icon="alert-circle-outline"
        tone="error"
        palette={palette}
        onPress={() => router.push('/settings')}
        accessibilityHint={t('Opens settings, where you can change the recognizer locale')}
      />
    );
  } else if (micPermission === 'denied' || micPermission === 'blocked') {
    // The microphone was refused, and this is the only place the user finds
    // out. Before this the button opened the recogniser, the Kotlin failed,
    // and the message named a settings screen the app never offered to open.
    //
    // Two states, not one: 'denied' can still be asked for, so tapping the
    // mic again is the fix and the chip just says so. 'blocked' cannot —
    // Android stops showing the dialog after a second refusal — so the chip
    // opens the system settings page instead, because offering "Allow" there
    // would be a button that does nothing.
    notice = (
      <Chip
        label={
          micPermission === 'blocked'
            ? t('Microphone blocked — open settings')
            : t('Microphone needed to follow along')
        }
        icon="mic-off-outline"
        tone="accent"
        palette={palette}
        onPress={micPermission === 'blocked' ? openAppSettings : () => start()}
        accessibilityHint={
          micPermission === 'blocked'
            ? t('Opens this app’s permissions in Android settings, the only way to turn the microphone back on')
            : t('Asks for microphone access again so follow-along can listen')
        }
      />
    );
  } else if (interruption !== null) {
    notice = (
      <Chip
        label={t('Paused: {reason}. Tap to resume', { reason: tr(interruption) })}
        icon="play"
        tone="accent"
        palette={palette}
        onPress={() => {
          clearInterruption();
          resumeSession();
        }}
      />
    );
  } else if (silenceTimedOut) {
    notice = (
      <Chip label={t('Still there? Tap to carry on')} icon="ear-outline" tone="accent" palette={palette} onPress={resumeSession} />
    );
  } else if (selecting !== null) {
    notice = (
      <Chip label={t('Now tap the last word of the range')} icon="hand-left-outline" palette={palette} onPress={() => setSelecting(null)} />
    );
  } else if (listening && !recognizer.heardSomething) {
    notice = (
      <Chip
        label={t('Listening — nothing recognized yet')}
        icon="ellipsis-horizontal"
        palette={palette}
        onPress={() => setTranscriptOpen(true)}
        accessibilityHint={t('The microphone is open but the recognizer has not returned any words yet')}
      />
    );
  } else if (awayFromPlace) {
    notice = (
      <Chip
        label={t('Return to my place · {ref}', { ref: `${liveAyah.surah}:${liveAyah.ayah}` })}
        icon="return-down-back-outline"
        tone="accent"
        palette={palette}
        onPress={() => {
          returnToMyPlace();
          deck.current?.goToPage(pageOf(session.livePos), !reduceMotion);
        }}
        accessibilityHint={t('Scrolls back to the page your voice is on')}
      />
    );
  } else if (range !== null) {
    notice = (
      <Chip
        label={t('Practicing {range} · tap to clear', { range: rangeLabel(range.from, range.to) })}
        icon="repeat"
        tone="accent"
        palette={palette}
        onPress={() => setRange(null)}
      />
    );
  } else if (recognizer.languageNotice !== null) {
    // a passing note from the recognizer (e.g. the offline pack just arrived);
    // it clears itself after a few seconds
    notice = <Chip label={tr(recognizer.languageNotice)} icon="information-circle-outline" palette={palette} />;
  } else if (recognizer.languagePack !== null) {
    // the offline pack on its way, asked for by the app itself
    notice = (
      <Chip
        label={
          recognizer.languagePack.state === 'scheduled'
            ? t('The Arabic offline pack will download soon')
            : t('Downloading the Arabic offline pack… {n}%', { n: recognizer.languagePack.percent })
        }
        icon="cloud-download-outline"
        palette={palette}
      />
    );
  } else if (recognizer.offlineDropped) {
    notice = (
      <Chip
        label={t('No offline Arabic — recognizing online')}
        icon="cloud-outline"
        palette={palette}
        onPress={() => void recognizer.requestLanguagePack()}
        accessibilityHint={t('Downloads the on-device Arabic model so recitation stays on your phone')}
      />
    );
  } else if (
    recognizer.languageStatus !== null &&
    recognizer.languageStatus.supported &&
    recognizer.languageStatus.localeInstalled === false
  ) {
    notice = (
      <Chip
        label={t('Install Arabic offline pack')}
        icon="cloud-download-outline"
        tone="accent"
        palette={palette}
        onPress={() => void recognizer.requestLanguagePack()}
        accessibilityHint={t('Downloads the on-device Arabic model so recitation works without a network')}
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        {/*
          Collapsed, not just faded, while reciting: its ~65 dp go to the page.
          It used to keep that space invisible, because handing it over made
          the page blank for a measuring pass; MushafPage now keeps its text
          on screen at the old size while it re-fits, so the space can go to
          the Quran instead of sitting empty above it. A tap brings it back.
        */}
        <View style={[styles.header, !headerVisible && styles.headerCollapsed]}>
          <Pressable
            onPress={goBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('Back')}
          >
            <Ionicons name="chevron-back" size={24} color={palette.text} />
          </Pressable>
          <View style={styles.headerCentre}>
            <Text style={[styles.headerArabic, { color: palette.text }]}>{info.name}</Text>
            <Text style={[styles.headerLatin, { color: palette.textMuted }]}>
              {arabic
                ? t('page {page} · juz {juz}', { page: viewedPage, juz: pageJuz })
                : `${info.transliteration} · ${t('page {page} · juz {juz}', { page: viewedPage, juz: pageJuz })}`}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/settings')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('Settings')}
          >
            <Ionicons name="options-outline" size={22} color={palette.text} />
          </Pressable>
        </View>
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
            underlineAt={lead}
          />
        ) : (
          <ListenPanel
            palette={palette}
            reciter={prefs.reciter}
            onReciterChange={(reciter) => setPrefs({ reciter })}
            onFollowWord={seekTo}
            initialSurah={seedSurah}
            fontStep={fontStep}
            registerPlaybackStopper={registerPlaybackStopper}
          />
        )}
      </Pressable>

      {/*
        The status strip: reserved space OUTSIDE the page, for the two things
        that are on screen nearly all the time.

        Both used to float over the mushaf in the absolute overlay below, and
        both covered its last line — reported from a real phone with a
        screenshot of "هُمُ ٱلْمُفْلِحُونَ" hidden behind them. The heard
        text is there for the whole of a recitation, and the "I read page"
        action is there whenever the microphone is off, so between them the
        bottom line of every page was covered almost all the time.

        FIXED height, and rendered even when empty. That is the point: the page
        is fitted to the box it is given, so a strip that appeared only while
        reciting would re-fit the page — and change its type size — every time
        the microphone started or stopped. Constant space, constant page. The
        cost is that the page is a little shorter for good, which is the right
        price for never covering a word of it.

        Read view only. In Listen the heard text is a transcript of the
        microphone, which has nothing to do with playing a reciter; it sat on
        the reciter card there and garbled its label.
      */}
      {tab === 'read' ? (
        <View style={[styles.statusStrip, { backgroundColor: palette.background }]}>
          {listening ? (
            <HeardPill
              text={session.lastHeard}
              expanded={false}
              onToggle={() => setTranscriptOpen(true)}
              transcript={session.sessionHeardRaw.slice(-40)}
              palette={palette}
              reduceMotion={reduceMotion}
            />
          ) : selfReportNote !== null ? (
            <Chip
              label={selfReportNote}
              icon="checkmark-circle-outline"
              palette={palette}
              onPress={() => setSelfReportNote(null)}
            />
          ) : (
            // Offered only when the microphone is off. While somebody is
            // reciting, the recogniser is already the evidence and a second,
            // weaker way to claim the same page would only compete with it.
            <Chip
              label={
                range !== null
                  ? selfReportKind === 'revised'
                    ? t('I revised {range} — add it', { range: rangeLabel(range.from, range.to) })
                    : t('I read {range} — add it', { range: rangeLabel(range.from, range.to) })
                  : selfReportKind === 'revised'
                    ? t('I revised page {page} — add it', { page: viewedPage })
                    : t('I read page {page} — add it', { page: viewedPage })
              }
              icon="book-outline"
              palette={palette}
              onPress={onSelfReport}
              accessibilityHint={t('Adds these ayahs to your revision schedule without the microphone, marked as read rather than verified')}
            />
          )}
        </View>
      ) : null}

      {/* floating affordances, all inside the bottom third */}
      <View style={[styles.floating, { bottom: floatingBottom }]} pointerEvents="box-none">
        {tab === 'read' ? notice : null}

        {/* Only the EXPANDED transcript floats, and only because it was asked
            for: somebody tapped the line below to read what was heard. The
            collapsed line lives in the status strip, off the page. */}
        {tab === 'read' && transcriptOpen ? (
          <HeardPill
            text={session.lastHeard}
            expanded
            onToggle={() => setTranscriptOpen(false)}
            transcript={session.sessionHeardRaw.slice(-40)}
            palette={palette}
            reduceMotion={reduceMotion}
          />
        ) : null}

        {prefs.showDebugOverlay ? (
          <DebugOverlay
            session={session}
            recognizer={recognizer}
            palette={palette}
            partialGapMs={partialGapMs}
            captureFixture={captureFixture}
          />
        ) : null}
      </View>

      {/*
        The bottom bar is the RECITATION's controls, so it belongs to Read.
        On the Listen screen the mic recorded over the reciter — the stopper
        that was meant to pause playback had stopped being registered — and
        followed someone else's voice, and every notice that could explain a
        refused microphone or a failed recognizer is Read-only, so it failed
        in silence there. Listen keeps only the inset the bar used to pad.
      */}
      {tab === 'read' ? (
        <View
          onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
          style={[
            styles.bottomBar,
            { paddingBottom: bottomPad, backgroundColor: palette.background, borderColor: palette.border },
          ]}
        >
          <StatsColumn
            listening={session.status === 'listening'}
            startedAt={session.startedAt}
            baseMs={session.elapsedMs}
            mistakeCount={session.mistakes.length}
            onReset={confirmReset}
            onOpenMistakes={() => {
              setMistakeFocus(null);
              setMistakesOpen(true);
            }}
            palette={palette}
          />

          <View style={styles.bottomActions}>
            <IconToggle options={modeOptions} value={mode} onChange={setMode} palette={palette} />

            {mode === 'hidden' ? (
              <Pressable
                onPress={() => requestHint(nextHintTarget)}
                accessibilityRole="button"
                accessibilityLabel={t('Hint')}
                accessibilityHint={t("First tap shows the word's first letter, second tap shows the whole word")}
                style={[styles.hintButton, { borderColor: palette.accent, backgroundColor: palette.accentSoft }]}
              >
                <Ionicons name="bulb-outline" size={18} color={palette.primary} />
                <Text style={[styles.hintLabel, { color: palette.primary }]}>
                  {hintLevelOf(nextHintTarget) === 0 ? t('Hint') : hintLevelOf(nextHintTarget) === 1 ? t('Reveal') : t('Shown')}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => setSelecting(session.livePos)}
                accessibilityRole="button"
                accessibilityLabel={t('Practice an ayah range')}
                accessibilityHint={t('Starts at your current word; then tap the last word of the range')}
                style={[styles.hintButton, { borderColor: palette.border }]}
              >
                <Ionicons name="repeat" size={18} color={palette.textMuted} />
              </Pressable>
            )}

            <MicButton
              listening={listening}
              paused={paused}
              level={level}
              onPress={onToggleMic}
              palette={palette}
              reduceMotion={reduceMotion}
              disabled={recognizer.status === 'unavailable'}
            />
          </View>
        </View>
      ) : (
        <View style={{ height: bottomPad }} />
      )}

      <MistakeSheet
        visible={mistakesOpen}
        mistakes={session.mistakes}
        focusWord={mistakeFocus}
        palette={palette}
        onClose={() => {
          setMistakesOpen(false);
          setMistakeFocus(null);
        }}
        onDismiss={dismissMistake}
        onUndismiss={undismissMistake}
        onGoToWord={(word) => {
          setMistakesOpen(false);
          setViewedPage(pageOf(word));
          deck.current?.goToPage(pageOf(word), !reduceMotion);
        }}
        onPractise={(word) => {
          const ayah = ayahByGlobal(globalAyahOf(word));
          const [from, to] = ayahWordRange(ayah.surah, ayah.ayah);
          practiseRange(from, to - 1);
          // The deck only moves when told to; practiseRange relabels the page
          // but cannot turn it, and with the mic off nothing else would.
          deck.current?.goToPage(pageOf(from), !reduceMotion);
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
        onExport={() => void exportFixture(captureFixture(), t('Save recitation log'))}
        onAddByHand={() => {
          onSelfReport();
          dismissSummary();
        }}
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
              deck.current?.goToPage(pageOf(from), !reduceMotion);
            }
          }
          dismissSummary();
        }}
      />
    </View>
  );
}

/**
 * "2:255", "2:255–257", or "1:7–2:3". A selection can cross a surah — it
 * survives a swipe onto the next page — and the end's surah used to be
 * dropped, so 1:7 to 2:3 read "1:7–3", naming an ayah that was not in it.
 */
function rangeLabel(from: number, to: number): string {
  const a = ayahByGlobal(globalAyahOf(from));
  const b = ayahByGlobal(globalAyahOf(to));
  if (a.surah !== b.surah) return `${a.surah}:${a.ayah}–${b.surah}:${b.ayah}`;
  return a.ayah === b.ayah ? `${a.surah}:${a.ayah}` : `${a.surah}:${a.ayah}–${b.ayah}`;
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
  headerCollapsed: { display: 'none' },
  headerCentre: { alignItems: 'center' },
  headerArabic: { fontFamily: 'Amiri_700Bold', fontSize: 22 },
  headerLatin: { fontSize: 11, marginTop: 1 },
  deck: { flex: 1 },
  statusStrip: {
    height: STATUS_STRIP_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
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
