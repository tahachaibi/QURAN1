/**
 * Listen tab entry point: pick a surah, then the surah screen's Listen tab does
 * the playback with the shared page renderer.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { surahs, type SurahInfo } from '../../src/data/quran';
import { BUILTIN_RECITERS, reciterLabel } from '../../src/data/audio';
import { loadCachedReciters } from '../../src/data/storage';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, space } from '../../src/theme/theme';

export default function ListenTab() {
  const { palette, prefs } = useTheme();
  const router = useRouter();
  // Read from the same cache the player fills, so the two agree on the name.
  const [known, setKnown] = useState<readonly typeof BUILTIN_RECITERS[number][]>(BUILTIN_RECITERS);
  useEffect(() => {
    void loadCachedReciters().then((c) => {
      if (c !== null) setKnown(c.reciters);
    });
  }, []);
  const chosen = known.find((r) => r.id === prefs.reciter) ?? known[0] ?? BUILTIN_RECITERS[0];

  const open = useCallback(
    (surah: number) => {
      router.push({ pathname: '/surah/[id]', params: { id: String(surah), tab: 'listen' } });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: SurahInfo }) => (
      <Pressable
        onPress={() => open(item.number)}
        accessibilityRole="button"
        accessibilityLabel={`Listen to ${item.transliteration}`}
        style={[styles.row, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        <Ionicons name="play-circle-outline" size={24} color={palette.primary} />
        <View style={styles.rowMain}>
          <Text style={[styles.translit, { color: palette.text }]}>{item.transliteration}</Text>
          <Text style={[styles.meta, { color: palette.textMuted }]}>{item.totalVerses} verses</Text>
        </View>
        <Text style={[styles.arabic, { color: palette.text }]}>{item.name}</Text>
      </Pressable>
    ),
    [open, palette],
  );

  return (
    <View style={styles.root}>
      {/* Which reciter is set, at a glance. The full searchable list lives in the
          player, so it is not duplicated as a wall of chips here. */}
      <View style={[styles.reciterBar, { borderColor: palette.border }]}>
        <Ionicons name="person-outline" size={15} color={palette.primary} />
        <Text style={[styles.reciterName, { color: palette.textMuted }]} numberOfLines={1}>
          {reciterLabel(chosen)}
        </Text>
      </View>
      <FlatList
        data={surahs}
        keyExtractor={(s) => String(s.number)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        initialNumToRender={12}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  reciterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.md,
    marginTop: space.sm,
    marginBottom: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: space.sm,
  },
  reciterName: { flex: 1, fontSize: 12, fontWeight: '600' },
  list: { paddingHorizontal: space.md, paddingBottom: space.xl, gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
  },
  rowMain: { flex: 1 },
  translit: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 11, marginTop: 1 },
  arabic: { fontFamily: 'Amiri_700Bold', fontSize: 20 },
});
