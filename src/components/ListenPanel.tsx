/**
 * The Listen tab (spec §8).
 *
 * Plays WHOLE SURAHS. Chaining one file per ayah put a gap and a fresh request
 * at every verse, which is not how anyone listens to the Quran.
 *
 * The reciter list is fetched from the API on first use and cached, because the
 * list is keyed by folder name and a wrong folder is a silent 404 — see
 * src/data/audio.ts. Until that lands, the small bundled list is used, and the UI
 * says which one you are looking at rather than pretending the short list is all
 * there is.
 *
 * One honest loss versus ayah-by-ayah: with a single surah file there are no ayah
 * boundaries to highlight, so there is no per-ayah follow-along here. Restoring it
 * needs the ayah timestamps QUL publishes alongside its gapless audio; the player
 * still moves the shared cursor to the surah's start, so Read opens in the right
 * place.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Audio, InterruptionModeAndroid, type AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';

import { surahInfo, surahWordRange, TOTAL_SURAHS } from '../data/quran';
import {
  BUILTIN_RECITERS,
  fetchReciters,
  reciterLabel,
  searchReciters,
  surahAudioUrl,
  type Reciter,
} from '../data/audio';
import { loadCachedReciters, saveCachedReciters } from '../data/storage';
import { ayahTextSizes, radius, space, type FontStep, type Palette } from '../theme/theme';
import { OfflineBadge } from './controls';
import { useT } from '../i18n/useT';

export interface ListenPanelProps {
  palette: Palette;
  reciter: string;
  onReciterChange: (id: string) => void;
  /** move the shared cursor, so Read opens where Listen left off */
  onFollowWord: (word: number) => void;
  /**
   * The surah that was TAPPED in the Listen tab — the route's, not the cursor's.
   *
   * This used to be read off the shared cursor, which on a fresh launch is
   * Al-Fatiha and after any recitation is wherever that ended, and was captured
   * before the screen's seed had moved it. So tapping Ya-Sin opened a player
   * showing, and playing, Al-Fatiha: the surah list did nothing at all.
   */
  initialSurah: number;
  fontStep: FontStep;
  /**
   * Hand the provider a way to silence this player, which it calls when a
   * recitation starts: the reciter's voice fed into the recognizer would be
   * followed as if it were yours (§4). Pass null to unregister.
   */
  registerPlaybackStopper?: (stop: (() => void) | null) => void;
}

/**
 * Arabic for the recitation styles the bundled list uses and the API commonly
 * returns. A style with no entry is left out of the Arabic interface rather
 * than shown in English; it is a detail, and the reciter's name still says who
 * it is. A map rather than translating the value itself, because the dictionary test can only
 * vouch for literals.
 */
const ARABIC_STYLE: Readonly<Record<string, string>> = {
  studio: 'تسجيل استوديو',
  'with children': 'مع الأطفال',
  murattal: 'مرتّل',
  mujawwad: 'مجوّد',
  muallim: 'معلّم',
};

const styleLabel = (style: string | undefined, arabic: boolean): string | undefined => {
  if (style === undefined || style.length === 0) return undefined;
  return arabic ? ARABIC_STYLE[style.toLowerCase()] : style;
};

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const toArabicDigits = (n: number): string =>
  String(n)
    .split('')
    .map((d) => ARABIC_DIGITS[Number(d)] ?? d)
    .join('');

export function ListenPanel({
  palette,
  reciter,
  onReciterChange,
  onFollowWord,
  initialSurah,
  fontStep,
  registerPlaybackStopper,
}: ListenPanelProps) {
  const { t, arabic } = useT();
  const reciterName = (r: Reciter) => (arabic ? (r.arabicName ?? reciterLabel(r)) : reciterLabel(r));
  const [surah, setSurah] = useState(() => initialSurah);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [reciters, setReciters] = useState<readonly Reciter[]>(BUILTIN_RECITERS);
  const [listSource, setListSource] = useState<'builtin' | 'cached' | 'live'>('builtin');
  const [refreshing, setRefreshing] = useState(false);
  /**
   * Whether the last refresh failed — a flag, not the error's text. The text
   * was the exception's own message ("Network request failed", "reciter list:
   * HTTP 503"), English in an Arabic interface on the most ordinary path an
   * offline-first app has. The sentence shown is ours and translated, and being
   * built at render it follows a language switch too.
   */
  const [listFailed, setListFailed] = useState(false);
  const sound = useRef<Audio.Sound | null>(null);
  /**
   * Which play() call is the live one.
   *
   * Loading a stream takes from a moment to several seconds, and while it does
   * `sound.current` is still empty. Without this, leaving the screen mid-load
   * found nothing to unload, and the sound then started with no screen left to
   * stop it — auto-advancing through the Quran in the background until the app
   * was killed. Two quick taps on Next, or Play pressed while loading, likewise
   * left two surahs playing at once with only one of them reachable. Every
   * play() takes a number; anything that supersedes it (another play, a new
   * reciter, leaving) bumps the number, and a load that finishes for a number
   * that is no longer current unloads itself instead of playing.
   */
  const playToken = useRef(0);

  /**
   * Keep playing when the screen locks or the app is backgrounded.
   *
   * Set once, before anything is loaded: expo-av applies the audio mode to
   * sounds created after it, so doing this lazily at play time leaves the first
   * surah playing under the default mode, which stops at the lock screen.
   */
  useEffect(() => {
    void Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      allowsRecordingIOS: false,
    }).catch(() => undefined);
  }, []);

  const info = surahInfo(surah);
  const { fontSize } = ayahTextSizes[fontStep];
  const current = useMemo(
    () => reciters.find((r) => r.id === reciter) ?? reciters[0] ?? BUILTIN_RECITERS[0],
    [reciter, reciters],
  );

  // --- the reciter list: cache first, then refresh in the background ---
  const refresh = useCallback(
    async (explicit: boolean) => {
      if (explicit) setRefreshing(true);
      setListFailed(false);
      try {
        const live = await fetchReciters();
        setReciters(live);
        setListSource('live');
        void saveCachedReciters(live);
      } catch {
        // Offline or unparseable: keep whatever list we already have, but SAY so.
        // Failing silently here is what left the picker showing five reciters
        // with no explanation.
        setListFailed(true);
      } finally {
        if (explicit) setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void loadCachedReciters().then((cached) => {
      if (cancelled || cached === null) return;
      setReciters(cached.reciters);
      setListSource('cached');
    });
    void refresh(false);
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const unload = useCallback(async () => {
    const active = sound.current;
    sound.current = null;
    if (active !== null) await active.unloadAsync().catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      // supersede any load still in flight, so it unloads itself on arrival
      playToken.current++;
      void unload();
    },
    [unload],
  );

  const play = useCallback(
    async (target: number) => {
      if (target < 1 || target > TOTAL_SURAHS) return;
      const token = ++playToken.current;
      await unload();
      if (token !== playToken.current) return;
      setFailed(false);
      setLoading(true);
      setSurah(target);
      setPosition(0);
      setDuration(0);
      // move the shared cursor so Read opens on this surah
      onFollowWord(surahWordRange(target)[0]);
      try {
        // Loaded paused and started only once it is known to still be wanted:
        // a superseded load must never make a sound, not even briefly.
        const { sound: created } = await Audio.Sound.createAsync(
          { uri: surahAudioUrl(target, current.path) },
          { shouldPlay: false },
        );
        if (token !== playToken.current) {
          await created.unloadAsync().catch(() => undefined);
          return;
        }
        sound.current = created;
        created.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (!status.isLoaded || token !== playToken.current) return;
          setPosition(status.positionMillis);
          if (status.durationMillis !== undefined) setDuration(status.durationMillis);
          if (!status.didJustFinish) return;
          if (target < TOTAL_SURAHS) {
            void play(target + 1);
            return;
          }
          // An-Nas has finished and there is nothing after it. Without this the
          // button went on saying Pause over a finished sound, and play() on a
          // finished sound does not restart it. stopAsync rewinds AND clears
          // shouldPlay; a bare seek to 0 would start An-Nas again by itself
          // under a button that said Play.
          setPlaying(false);
          void created.stopAsync().catch(() => undefined);
        });
        await created.playAsync();
        if (token === playToken.current) setPlaying(true);
      } catch {
        if (token === playToken.current) {
          setFailed(true);
          setPlaying(false);
        }
      } finally {
        if (token === playToken.current) setLoading(false);
      }
    },
    [current.path, onFollowWord, unload],
  );

  /**
   * The provider calls this when a recitation starts. Registered by the player
   * that exists, and unregistered with it, so the provider never holds a
   * stopper for a screen that has gone.
   */
  useEffect(() => {
    if (registerPlaybackStopper === undefined) return undefined;
    registerPlaybackStopper(() => {
      void sound.current?.pauseAsync().catch(() => undefined);
      setPlaying(false);
    });
    return () => registerPlaybackStopper(null);
  }, [registerPlaybackStopper]);

  const toggle = useCallback(() => {
    if (playing) {
      void sound.current?.pauseAsync().catch(() => undefined);
      setPlaying(false);
      return;
    }
    if (sound.current !== null) {
      void sound.current.playAsync().catch(() => undefined);
      setPlaying(true);
      return;
    }
    void play(surah);
  }, [play, playing, surah]);

  const pickReciter = useCallback(
    (id: string) => {
      onReciterChange(id);
      setPickerOpen(false);
      // a surah still loading for the old reciter must not start afterwards
      playToken.current++;
      setLoading(false);
      void unload().then(() => {
        setPlaying(false);
        setPosition(0);
        setDuration(0);
      });
    },
    [onReciterChange, unload],
  );

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <Text allowFontScaling={false} style={[styles.surahArabic, { color: palette.ink, fontSize: fontSize * 1.5 }]}>
          {info.name}
        </Text>
        {arabic ? null : <Text style={[styles.surahLatin, { color: palette.text }]}>{info.transliteration}</Text>}
        <Text style={[styles.surahMeta, { color: palette.textMuted }]}>
          {arabic ? '' : `${info.translation} · `}
          {t('{n} verses', { n: info.totalVerses })} · {info.type === 'meccan' ? t('Meccan') : t('Medinan')}
        </Text>
      </View>

      <View style={[styles.controls, { borderColor: palette.border }]}>
        {failed ? (
          <OfflineBadge palette={palette} label={t('No audio for {name} — try another reciter', { name: reciterName(current) })} />
        ) : null}

        <View style={styles.timeRow}>
          <Text style={[styles.time, { color: palette.textMuted }]}>{formatTime(position)}</Text>
          <View style={[styles.progressTrack, { backgroundColor: palette.border }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: palette.accent, width: `${Math.round(progress * 100)}%` },
              ]}
            />
          </View>
          <Text style={[styles.time, { color: palette.textMuted }]}>
            {duration > 0 ? formatTime(duration) : '--:--'}
          </Text>
        </View>

        <View style={styles.transport}>
          {/* Disabled at the two ends rather than tappable into nothing: play(0)
              and play(115) return without a sound or a word. */}
          <Pressable
            onPress={() => void play(surah - 1)}
            disabled={surah <= 1}
            accessibilityRole="button"
            accessibilityLabel={t('Previous surah')}
            accessibilityState={{ disabled: surah <= 1 }}
            hitSlop={12}
          >
            <Ionicons name="play-skip-back" size={26} color={surah <= 1 ? palette.textMuted : palette.text} />
          </Pressable>

          <Pressable
            onPress={toggle}
            accessibilityRole="button"
            accessibilityLabel={playing ? t('Pause') : t('Play {name}', { name: arabic ? info.name : info.transliteration })}
            style={[styles.play, { backgroundColor: palette.primary }]}
          >
            {loading ? (
              <ActivityIndicator color={palette.paper} />
            ) : (
              <Ionicons name={playing ? 'pause' : 'play'} size={28} color={palette.paper} />
            )}
          </Pressable>

          <Pressable
            onPress={() => void play(surah + 1)}
            disabled={surah >= TOTAL_SURAHS}
            accessibilityRole="button"
            accessibilityLabel={t('Next surah')}
            accessibilityState={{ disabled: surah >= TOTAL_SURAHS }}
            hitSlop={12}
          >
            <Ionicons
              name="play-skip-forward"
              size={26}
              color={surah >= TOTAL_SURAHS ? palette.textMuted : palette.text}
            />
          </Pressable>
        </View>

        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('Reciter: {name}. Tap to change', { name: reciterName(current) })}
          style={[styles.reciterRow, { backgroundColor: palette.surface, borderColor: palette.border }]}
        >
          <Ionicons name="person-outline" size={16} color={palette.primary} />
          <View style={styles.reciterMain}>
            <Text style={[styles.reciterName, { color: palette.text }]} numberOfLines={1}>
              {reciterName(current)}
            </Text>
            <Text style={[styles.reciterArabic, { color: palette.textMuted }]} numberOfLines={1}>
              {arabic ? t('Reciters available: {n}', { n: reciters.length }) : (current.arabicName ?? `${reciters.length} reciters`)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
        </Pressable>
      </View>

      <ReciterPicker
        visible={pickerOpen}
        current={current.id}
        reciters={reciters}
        source={listSource}
        failed={listFailed}
        refreshing={refreshing}
        onRefresh={() => void refresh(true)}
        palette={palette}
        onClose={() => setPickerOpen(false)}
        onPick={pickReciter}
      />
    </View>
  );
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function ReciterPicker({
  visible,
  current,
  reciters,
  source,
  failed,
  refreshing,
  onRefresh,
  palette,
  onClose,
  onPick,
}: {
  visible: boolean;
  current: string;
  reciters: readonly Reciter[];
  source: 'builtin' | 'cached' | 'live';
  failed: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  palette: Palette;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const { t, arabic } = useT();
  const results = useMemo(() => searchReciters(reciters, query), [query, reciters]);

  const renderItem = useCallback(
    ({ item }: { item: Reciter }) => {
      const selected = item.id === current;
      const style = styleLabel(item.style, arabic);
      return (
        <Pressable
          onPress={() => onPick(item.id)}
          accessibilityRole="radio"
          accessibilityState={{ selected }}
          accessibilityLabel={reciterLabel(item)}
          style={[
            styles.pickerRow,
            { borderColor: palette.border, backgroundColor: selected ? palette.accentSoft : 'transparent' },
          ]}
        >
          <View style={styles.pickerMain}>
            <Text style={[styles.pickerName, { color: palette.text }]}>
              {arabic ? (item.arabicName ?? item.name) : item.name}
            </Text>
            <Text style={[styles.pickerArabic, { color: palette.textMuted }]} numberOfLines={1}>
              {arabic ? (item.arabicName === undefined ? item.path : item.name) : (item.arabicName ?? item.path)}
              {style === undefined ? '' : ` · ${style}`}
            </Text>
          </View>
          {selected ? <Ionicons name="checkmark" size={20} color={palette.primary} /> : null}
        </Pressable>
      );
    },
    [current, onPick, palette, arabic],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: palette.overlay }]}
        onPress={onClose}
        accessibilityLabel={t('Close reciter list')}
      />
      <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.handleRow}>
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
        </View>
        <View style={styles.sheetHeader}>
          <View>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>{t('Reciter')}</Text>
            <Text
              style={[styles.sheetSub, { color: failed ? palette.error : palette.textMuted }]}
              numberOfLines={2}
            >
              {failed
                ? t('{n} shown — {error}', { n: reciters.length, error: t('could not load the reciter list') })
                : `${t('{n} available', { n: reciters.length })}${source === 'builtin' ? ` · ${t('built-in, tap refresh for all')}` : ''}${source === 'cached' ? ` · ${t('saved list')}` : ''}`}
            </Text>
          </View>
          <View style={styles.sheetActions}>
            <Pressable
              onPress={onRefresh}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('Refresh the reciter list')}
              disabled={refreshing}
            >
              {refreshing ? (
                <ActivityIndicator color={palette.primary} />
              ) : (
                <Ionicons name="refresh" size={19} color={palette.primary} />
              )}
            </Pressable>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Close')}>
              <Ionicons name="close" size={20} color={palette.textMuted} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.search, { borderColor: palette.border }]}>
          <Ionicons name="search" size={16} color={palette.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('Search by name, Arabic name or style')}
            placeholderTextColor={palette.textMuted}
            style={[styles.searchInput, { color: palette.text }]}
            accessibilityLabel={t('Search reciters')}
          />
        </View>

        <FlatList
          data={results}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={[styles.empty, { color: palette.textMuted }]}>{t('No reciter matches that.')}</Text>
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    gap: space.xs,
  },
  surahArabic: { fontFamily: 'KFGQPC-Hafs', writingDirection: 'rtl', textAlign: 'center' },
  surahLatin: { fontSize: 20, fontWeight: '700', marginTop: space.sm },
  surahMeta: { fontSize: 12, textAlign: 'center' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  time: { fontSize: 11, fontVariant: ['tabular-nums'], minWidth: 38 },
  controls: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    gap: space.md,
  },
  progressTrack: { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2 },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl },
  play: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  reciterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  reciterMain: { flex: 1 },
  reciterName: { fontSize: 14, fontWeight: '600' },
  reciterArabic: { fontSize: 12, fontFamily: 'Amiri_400Regular', writingDirection: 'rtl' },
  backdrop: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '75%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  handleRow: { alignItems: 'center', paddingTop: space.sm },
  handle: { width: 38, height: 4, borderRadius: 2 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  sheetSub: { fontSize: 11, marginTop: 1 },
  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.md,
    marginBottom: space.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.md,
    marginBottom: space.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  pickerMain: { flex: 1 },
  pickerName: { fontSize: 14, fontWeight: '600' },
  pickerArabic: { fontSize: 12, fontFamily: 'Amiri_400Regular', writingDirection: 'rtl' },
  empty: { textAlign: 'center', fontSize: 13, padding: space.lg },
});
