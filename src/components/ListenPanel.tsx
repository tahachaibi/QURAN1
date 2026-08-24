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
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';

import { surahInfo, surahWordRange, surahOf, TOTAL_SURAHS } from '../data/quran';
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

export interface ListenPanelProps {
  palette: Palette;
  reciter: string;
  onReciterChange: (id: string) => void;
  /** move the shared cursor, so Read opens where Listen left off */
  onFollowWord: (word: number) => void;
  /** where the cursor is now, to pick the starting ayah */
  cursor: number;
  fontStep: FontStep;
}

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
  cursor,
  fontStep,
}: ListenPanelProps) {
  const [surah, setSurah] = useState(() => surahOf(cursor));
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [reciters, setReciters] = useState<readonly Reciter[]>(BUILTIN_RECITERS);
  const [listSource, setListSource] = useState<'builtin' | 'cached' | 'live'>('builtin');
  const [refreshing, setRefreshing] = useState(false);
  const sound = useRef<Audio.Sound | null>(null);

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
      try {
        const live = await fetchReciters();
        setReciters(live);
        setListSource('live');
        void saveCachedReciters(live);
      } catch {
        // offline or unparseable: whatever we already have stays
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
      void unload();
    },
    [unload],
  );

  const play = useCallback(
    async (target: number) => {
      if (target < 1 || target > TOTAL_SURAHS) return;
      await unload();
      setFailed(false);
      setLoading(true);
      setSurah(target);
      setPosition(0);
      setDuration(0);
      // move the shared cursor so Read opens on this surah
      onFollowWord(surahWordRange(target)[0]);
      try {
        const { sound: created } = await Audio.Sound.createAsync(
          { uri: surahAudioUrl(target, current.path) },
          { shouldPlay: true },
        );
        sound.current = created;
        setPlaying(true);
        created.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (!status.isLoaded) return;
          setPosition(status.positionMillis);
          if (status.durationMillis !== undefined) setDuration(status.durationMillis);
          if (status.didJustFinish) void play(target + 1);
        });
      } catch {
        setFailed(true);
        setPlaying(false);
      } finally {
        setLoading(false);
      }
    },
    [current.path, onFollowWord, unload],
  );

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
        <Text style={[styles.surahLatin, { color: palette.text }]}>{info.transliteration}</Text>
        <Text style={[styles.surahMeta, { color: palette.textMuted }]}>
          {info.translation} · {info.totalVerses} verses ·{' '}
          {info.type === 'meccan' ? 'Meccan' : 'Medinan'}
        </Text>
      </View>

      <View style={[styles.controls, { borderColor: palette.border }]}>
        {failed ? (
          <OfflineBadge palette={palette} label={`No audio for ${current.name} — try another reciter`} />
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
          <Pressable
            onPress={() => void play(surah - 1)}
            accessibilityRole="button"
            accessibilityLabel="Previous surah"
            hitSlop={12}
          >
            <Ionicons name="play-skip-back" size={26} color={palette.text} />
          </Pressable>

          <Pressable
            onPress={toggle}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause' : `Play ${info.transliteration}`}
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
            accessibilityRole="button"
            accessibilityLabel="Next surah"
            hitSlop={12}
          >
            <Ionicons name="play-skip-forward" size={26} color={palette.text} />
          </Pressable>
        </View>

        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Reciter: ${reciterLabel(current)}. Tap to change`}
          style={[styles.reciterRow, { backgroundColor: palette.surface, borderColor: palette.border }]}
        >
          <Ionicons name="person-outline" size={16} color={palette.primary} />
          <View style={styles.reciterMain}>
            <Text style={[styles.reciterName, { color: palette.text }]} numberOfLines={1}>
              {reciterLabel(current)}
            </Text>
            <Text style={[styles.reciterArabic, { color: palette.textMuted }]} numberOfLines={1}>
              {current.arabicName ?? `${reciters.length} reciters`}
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
  refreshing: boolean;
  onRefresh: () => void;
  palette: Palette;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchReciters(reciters, query), [query, reciters]);

  const renderItem = useCallback(
    ({ item }: { item: Reciter }) => {
      const selected = item.id === current;
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
            <Text style={[styles.pickerName, { color: palette.text }]}>{item.name}</Text>
            <Text style={[styles.pickerArabic, { color: palette.textMuted }]} numberOfLines={1}>
              {item.arabicName ?? item.path}
              {item.style === undefined ? '' : ` · ${item.style}`}
            </Text>
          </View>
          {selected ? <Ionicons name="checkmark" size={20} color={palette.primary} /> : null}
        </Pressable>
      );
    },
    [current, onPick, palette],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: palette.overlay }]}
        onPress={onClose}
        accessibilityLabel="Close reciter list"
      />
      <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.handleRow}>
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
        </View>
        <View style={styles.sheetHeader}>
          <View>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>Reciter</Text>
            <Text style={[styles.sheetSub, { color: palette.textMuted }]}>
              {reciters.length} available
              {source === 'builtin' ? ' · built-in list, tap refresh for all' : ''}
              {source === 'cached' ? ' · saved list' : ''}
            </Text>
          </View>
          <View style={styles.sheetActions}>
            <Pressable
              onPress={onRefresh}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Refresh the reciter list"
              disabled={refreshing}
            >
              {refreshing ? (
                <ActivityIndicator color={palette.primary} />
              ) : (
                <Ionicons name="refresh" size={19} color={palette.primary} />
              )}
            </Pressable>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={palette.textMuted} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.search, { borderColor: palette.border }]}>
          <Ionicons name="search" size={16} color={palette.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name, Arabic name or style"
            placeholderTextColor={palette.textMuted}
            style={[styles.searchInput, { color: palette.text }]}
            accessibilityLabel="Search reciters"
          />
        </View>

        <FlatList
          data={results}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={[styles.empty, { color: palette.textMuted }]}>No reciter matches that.</Text>
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
