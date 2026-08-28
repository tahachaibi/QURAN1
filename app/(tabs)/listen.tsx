/**
 * Listen tab entry point: pick a surah, then the surah screen's Listen tab does
 * the playback with the shared page renderer.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { surahs, type SurahInfo } from '../../src/data/quran';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, space } from '../../src/theme/theme';

export default function ListenTab() {
  const { palette } = useTheme();
  const router = useRouter();

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
      {/* No reciter bar here. It named the current reciter without letting anyone
          change it, so it was a label pretending to be a control — the searchable
          list lives in the player, where choosing actually happens. */}
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
