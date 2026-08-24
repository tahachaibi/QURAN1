/**
 * The Listen tab (spec §8).
 *
 * Rebuilt as a purpose-built player. The first version embedded the full mushaf
 * page renderer in the top half of the screen, which was the wrong shape for it:
 * squeezed into half the height the page fit its type down to nothing and left a
 * large empty card. A player wants one ayah, large and legible, not a whole page
 * at a third of the size.
 *
 * Follow-along is kept, and kept honest: playing an ayah moves the SAME global
 * cursor the recitation engine uses, so the Read view is already in the right
 * place when you switch to it.
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

import { ayahByGlobal, ayahsOnPage, globalAyahOf, surahInfo, TOTAL_AYAHS } from '../data/quran';
import {
  ayahAudioUrl,
  bitrateCandidates,
  reciterById,
  reciterLabel,
  searchReciters,
  type Reciter,
} from '../data/audio';
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
  const [globalAyah, setGlobalAyah] = useState(() => globalAyahOf(cursor) + 1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const sound = useRef<Audio.Sound | null>(null);
  /** bitrate proven to work for this reciter, once discovered */
  const provenBitrate = useRef(new Map<string, number>());

  const ayah = useMemo(() => ayahByGlobal(Math.max(0, globalAyah - 1)), [globalAyah]);
  const surah = surahInfo(ayah.surah);
  const onPage = useMemo(() => ayahsOnPage(ayah.page).length, [ayah.page]);
  const { fontSize, lineHeight } = ayahTextSizes[fontStep];

  const unload = useCallback(async () => {
    const current = sound.current;
    sound.current = null;
    if (current !== null) await current.unloadAsync().catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      void unload();
    },
    [unload],
  );

  const play = useCallback(
    async (target: number) => {
      if (target < 1 || target > TOTAL_AYAHS) return;
      await unload();
      setOffline(false);
      setLoading(true);
      setGlobalAyah(target);
      setProgress(0);
      onFollowWord(ayahByGlobal(target - 1).wordStart);

      // Try the proven bitrate first, then the candidates. A wrong bitrate is a
      // 404, not a playback failure, so this is what makes the reciter list work
      // without a bitrate table I cannot verify from here.
      const proven = provenBitrate.current.get(reciter);
      const candidates = proven === undefined ? bitrateCandidates(reciter) : [proven];
      for (const bitrate of candidates) {
        try {
          const { sound: created } = await Audio.Sound.createAsync(
            { uri: ayahAudioUrl(target, reciter, bitrate) },
            { shouldPlay: true },
          );
          provenBitrate.current.set(reciter, bitrate);
          sound.current = created;
          setPlaying(true);
          setLoading(false);
          created.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
            if (!status.isLoaded) return;
            if (status.durationMillis !== undefined && status.durationMillis > 0) {
              setProgress(Math.min(1, status.positionMillis / status.durationMillis));
            }
            if (status.didJustFinish) void play(target + 1);
          });
          return;
        } catch {
          // wrong bitrate or unreachable; try the next
        }
      }
      setLoading(false);
      setPlaying(false);
      setOffline(true);
    },
    [onFollowWord, reciter, unload],
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
    void play(globalAyah);
  }, [globalAyah, play, playing]);

  const pickReciter = useCallback(
    (id: string) => {
      onReciterChange(id);
      setPickerOpen(false);
      void unload().then(() => {
        setPlaying(false);
        setProgress(0);
      });
    },
    [onReciterChange, unload],
  );

  return (
    <View style={styles.root}>
      {/* the ayah being played, large and legible */}
      <ScrollView contentContainerStyle={styles.textWrap} showsVerticalScrollIndicator={false}>
        <Text style={[styles.surahLabel, { color: palette.textMuted }]}>
          {surah.transliteration} · {ayah.surah}:{ayah.ayah} · {onPage} on this page
        </Text>
        <Text
          allowFontScaling={false}
          style={[styles.ayahText, { color: palette.ink, fontSize, lineHeight }]}
        >
          {ayah.text} {toArabicDigits(ayah.ayah)}
        </Text>
      </ScrollView>

      <View style={[styles.controls, { borderColor: palette.border }]}>
        {offline ? (
          <OfflineBadge palette={palette} label="Could not reach the audio for this reciter" />
        ) : null}

        {/* progress */}
        <View style={[styles.progressTrack, { backgroundColor: palette.border }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: palette.accent, width: `${Math.round(progress * 100)}%` },
            ]}
          />
        </View>

        <View style={styles.transport}>
          <Pressable
            onPress={() => void play(globalAyah - 1)}
            accessibilityRole="button"
            accessibilityLabel="Previous ayah"
            hitSlop={12}
          >
            <Ionicons name="play-skip-back" size={26} color={palette.text} />
          </Pressable>

          <Pressable
            onPress={toggle}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause' : 'Play'}
            style={[styles.play, { backgroundColor: palette.primary }]}
          >
            {loading ? (
              <ActivityIndicator color={palette.paper} />
            ) : (
              <Ionicons name={playing ? 'pause' : 'play'} size={28} color={palette.paper} />
            )}
          </Pressable>

          <Pressable
            onPress={() => void play(globalAyah + 1)}
            accessibilityRole="button"
            accessibilityLabel="Next ayah"
            hitSlop={12}
          >
            <Ionicons name="play-skip-forward" size={26} color={palette.text} />
          </Pressable>
        </View>

        {/* one row, not a wall of chips: the full list lives behind it */}
        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Reciter: ${reciterLabel(reciterById(reciter))}. Tap to change`}
          style={[styles.reciterRow, { backgroundColor: palette.surface, borderColor: palette.border }]}
        >
          <Ionicons name="person-outline" size={16} color={palette.primary} />
          <View style={styles.reciterMain}>
            <Text style={[styles.reciterName, { color: palette.text }]} numberOfLines={1}>
              {reciterLabel(reciterById(reciter))}
            </Text>
            <Text style={[styles.reciterArabic, { color: palette.textMuted }]} numberOfLines={1}>
              {reciterById(reciter).arabicName}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
        </Pressable>
      </View>

      <ReciterPicker
        visible={pickerOpen}
        current={reciter}
        palette={palette}
        onClose={() => setPickerOpen(false)}
        onPick={pickReciter}
      />
    </View>
  );
}

function ReciterPicker({
  visible,
  current,
  palette,
  onClose,
  onPick,
}: {
  visible: boolean;
  current: string;
  palette: Palette;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchReciters(query), [query]);

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
            <Text style={[styles.pickerArabic, { color: palette.textMuted }]}>
              {item.arabicName}
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
          <Text style={[styles.sheetTitle, { color: palette.text }]}>Reciter</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={20} color={palette.textMuted} />
          </Pressable>
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
  textWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  surahLabel: { fontSize: 12, textAlign: 'center', marginBottom: space.md },
  ayahText: {
    fontFamily: 'KFGQPC-Hafs',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  controls: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    gap: space.md,
  },
  progressTrack: { height: 3, borderRadius: 2, overflow: 'hidden' },
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
