/**
 * Quran tab (spec §8): all 114 surahs, searchable, plus continue-where-you-
 * left-off and a juz / page jump.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  ayahByGlobal,
  globalAyahOf,
  hizbStart,
  juzStart,
  surahs,
  TOTAL_HIZB,
  TOTAL_JUZ,
  type SurahInfo,
} from '../../src/data/quran';
import { lastPosition } from '../../src/data/storage';
import { useRecitation } from '../../src/context/RecitationProvider';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, space, type Palette } from '../../src/theme/theme';

export default function QuranScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const { seekTo, setViewedPage } = useRecitation();
  const [query, setQuery] = useState('');
  const [resume, setResume] = useState<{ surah: number; cursor: number } | null>(null);

  useEffect(() => {
    void lastPosition().then(setResume);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return surahs;
    return surahs.filter(
      (s) =>
        s.transliteration.toLowerCase().includes(q) ||
        s.translation.toLowerCase().includes(q) ||
        s.name.includes(query.trim()) ||
        String(s.number) === q,
    );
  }, [query]);

  const open = useCallback(
    (surah: number, ayah = 1) => {
      router.push({ pathname: '/surah/[id]', params: { id: String(surah), ayah: String(ayah) } });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: SurahInfo }) => (
      <Pressable
        onPress={() => open(item.number)}
        accessibilityRole="button"
        accessibilityLabel={`${item.transliteration}, ${item.translation}, ${item.totalVerses} verses, ${item.type}`}
        style={[styles.row, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        <View style={[styles.numberBadge, { borderColor: palette.accent }]}>
          <Text style={[styles.number, { color: palette.primary }]}>{item.number}</Text>
        </View>
        <View style={styles.rowMain}>
          <Text style={[styles.translit, { color: palette.text }]}>{item.transliteration}</Text>
          <Text style={[styles.translation, { color: palette.textMuted }]}>
            {item.translation} · {item.totalVerses} verses · {item.type === 'meccan' ? 'Meccan' : 'Medinan'}
          </Text>
        </View>
        <Text style={[styles.arabic, { color: palette.text }]}>{item.name}</Text>
      </Pressable>
    ),
    [open, palette],
  );

  return (
    <View style={styles.root}>
      <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Ionicons name="search" size={16} color={palette.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search surah name, meaning or number"
          placeholderTextColor={palette.textMuted}
          style={[styles.searchInput, { color: palette.text }]}
          accessibilityLabel="Search surahs"
        />
      </View>

      {resume !== null ? (
        <Pressable
          onPress={() => {
            const ayah = ayahByGlobal(globalAyahOf(resume.cursor));
            seekTo(resume.cursor);
            open(ayah.surah, ayah.ayah);
          }}
          accessibilityRole="button"
          accessibilityLabel="Continue where you left off"
          style={[styles.resume, { backgroundColor: palette.primary }]}
        >
          <Ionicons name="play" size={16} color={palette.paper} />
          <Text style={[styles.resumeText, { color: palette.paper }]}>
            Continue {describe(resume.cursor)}
          </Text>
        </Pressable>
      ) : null}

      <FlatList
        data={filtered}
        keyExtractor={(s) => String(s.number)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <GoToRow
            onJumpJuz={(juz) => {
              const start = juzStart(juz);
              seekTo(start.word);
              setViewedPage(start.page);
              open(start.surah, start.ayah);
            }}
            onJumpHizb={(hizb) => {
              const start = hizbStart(hizb);
              seekTo(start.word);
              setViewedPage(start.page);
              open(start.surah, start.ayah);
            }}
            palette={palette}
          />
        }
        initialNumToRender={12}
        windowSize={7}
      />
    </View>
  );
}

function describe(cursor: number): string {
  const ayah = ayahByGlobal(globalAyahOf(cursor));
  return `${surahs[ayah.surah - 1].transliteration} ${ayah.surah}:${ayah.ayah}`;
}

/**
 * Two doors, "Go to juz" and "Go to hizb", each opening a small panel with a
 * number field.
 *
 * They replace a grid of thirty numbered squares, which filled the top third of
 * the screen to serve a tap most people make rarely, and could not have grown to
 * sixty for hizb without swallowing the surah list entirely.
 */
function GoToRow({
  onJumpJuz,
  onJumpHizb,
  palette,
}: {
  onJumpJuz: (juz: number) => void;
  onJumpHizb: (hizb: number) => void;
  palette: Palette;
}) {
  const [open, setOpen] = useState<'juz' | 'hizb' | null>(null);

  return (
    <View style={styles.goWrap}>
      <View style={styles.goRow}>
        <GoButton
          label="Go to juz"
          icon="bookmark-outline"
          active={open === 'juz'}
          onPress={() => setOpen((was) => (was === 'juz' ? null : 'juz'))}
          palette={palette}
        />
        <GoButton
          label="Go to hizb"
          icon="bookmarks-outline"
          active={open === 'hizb'}
          onPress={() => setOpen((was) => (was === 'hizb' ? null : 'hizb'))}
          palette={palette}
        />
      </View>

      {open === 'juz' ? (
        <NumberPanel
          placeholder={`Juz number, 1 to ${TOTAL_JUZ}`}
          max={TOTAL_JUZ}
          onGo={(n) => {
            setOpen(null);
            onJumpJuz(n);
          }}
          palette={palette}
        />
      ) : null}

      {open === 'hizb' ? (
        <NumberPanel
          placeholder={`Hizb number, 1 to ${TOTAL_HIZB}`}
          max={TOTAL_HIZB}
          onGo={(n) => {
            setOpen(null);
            onJumpHizb(n);
          }}
          palette={palette}
        />
      ) : null}
    </View>
  );
}

function GoButton({
  label,
  icon,
  active,
  onPress,
  palette,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  palette: Palette;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: active }}
      accessibilityLabel={label}
      style={[
        styles.goButton,
        {
          backgroundColor: active ? palette.primary : palette.surface,
          borderColor: active ? palette.primary : palette.border,
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={active ? '#FFFFFF' : palette.primary} />
      <Text style={[styles.goText, { color: active ? '#FFFFFF' : palette.text }]}>{label}</Text>
      <Ionicons
        name={active ? 'chevron-up' : 'chevron-down'}
        size={14}
        color={active ? '#FFFFFF' : palette.textMuted}
      />
    </Pressable>
  );
}

/** A number field that only accepts a number in range, and says so when it does not. */
function NumberPanel({
  placeholder,
  max,
  onGo,
  palette,
}: {
  placeholder: string;
  max: number;
  onGo: (n: number) => void;
  palette: Palette;
}) {
  const [value, setValue] = useState('');
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= max;

  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.panelRow}>
        <TextInput
          value={value}
          onChangeText={(next) => setValue(next.replace(/[^0-9]/g, '').slice(0, 3))}
          placeholder={placeholder}
          placeholderTextColor={palette.textMuted}
          keyboardType="number-pad"
          returnKeyType="go"
          onSubmitEditing={() => valid && onGo(n)}
          accessibilityLabel={placeholder}
          style={[styles.panelInput, { color: palette.text, borderColor: palette.border }]}
        />
        <Pressable
          onPress={() => valid && onGo(n)}
          disabled={!valid}
          accessibilityRole="button"
          accessibilityLabel="Go"
          style={[
            styles.panelGo,
            { backgroundColor: valid ? palette.primary : palette.border },
          ]}
        >
          <Ionicons name="arrow-forward" size={18} color={valid ? '#FFFFFF' : palette.textMuted} />
        </Pressable>
      </View>
      {value.length > 0 && !valid ? (
        <Text style={[styles.panelNote, { color: palette.error }]}>
          Enter a number from 1 to {max}.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  goWrap: { gap: space.sm, marginBottom: space.sm },
  goRow: { flexDirection: 'row', gap: space.sm },
  goButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
  },
  goText: { fontSize: 13, fontWeight: '700' },
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.sm,
    gap: space.xs,
  },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  panelInput: {
    flex: 1,
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 10,
  },
  panelGo: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelNote: { fontSize: 11, lineHeight: 16 },
  root: { flex: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    margin: space.md,
    marginBottom: space.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.md,
    marginBottom: space.sm,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 11,
  },
  resumeText: { fontSize: 14, fontWeight: '700' },
  list: { paddingHorizontal: space.md, paddingBottom: space.xl, gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
  },
  numberBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: { fontSize: 12, fontWeight: '700' },
  rowMain: { flex: 1 },
  translit: { fontSize: 15, fontWeight: '600' },
  translation: { fontSize: 11, marginTop: 1 },
  arabic: { fontFamily: 'Amiri_700Bold', fontSize: 20 },
});
