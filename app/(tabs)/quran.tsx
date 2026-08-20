/**
 * Quran tab (spec §8): all 114 surahs, searchable, plus continue-where-you-
 * left-off and a juz / page jump.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ayahByGlobal, globalAyahOf, juzStartPage, surahs, TOTAL_JUZ, type SurahInfo } from '../../src/data/quran';
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
          <JuzStrip
            onJump={(juz) => {
              const page = juzStartPage(juz);
              setViewedPage(page);
              const first = ayahByGlobal(0);
              // find the surah/ayah that opens this juz for a correct seed
              const target = surahs.find((s) => s.juz === juz) ?? { number: first.surah };
              open(target.number);
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

function JuzStrip({ onJump, palette }: { onJump: (juz: number) => void; palette: Palette }) {
  return (
    <View style={styles.juzStrip}>
      <Text style={[styles.juzLabel, { color: palette.textMuted }]}>Jump to juz</Text>
      <View style={styles.juzRow}>
        {Array.from({ length: TOTAL_JUZ }, (_, i) => i + 1).map((juz) => (
          <Pressable
            key={juz}
            onPress={() => onJump(juz)}
            accessibilityRole="button"
            accessibilityLabel={`Juz ${juz}`}
            style={[styles.juz, { borderColor: palette.border, backgroundColor: palette.surface }]}
          >
            <Text style={[styles.juzText, { color: palette.text }]}>{juz}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  juzStrip: { marginBottom: space.sm },
  juzLabel: { fontSize: 11, marginBottom: space.xs, textTransform: 'uppercase', letterSpacing: 1 },
  juzRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  juz: {
    width: 34,
    height: 30,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  juzText: { fontSize: 12, fontWeight: '600' },
});
