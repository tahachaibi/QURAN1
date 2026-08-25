/**
 * The books (kutub) of one collection.
 */
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { collectionById, searchChapters, type HadithChapter } from '../../../src/data/hadith';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { radius, space } from '../../../src/theme/theme';

export default function CollectionScreen() {
  const params = useLocalSearchParams<{ collection?: string }>();
  const { palette } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const collectionId = Number(params.collection ?? '1');
  const collection = collectionById(collectionId);
  const chapters = useMemo(() => searchChapters(collectionId, query), [collectionId, query]);

  const renderItem = useCallback(
    ({ item }: { item: HadithChapter }) => (
      <Pressable
        onPress={() =>
          router.push({
            pathname: '/hadith/[collection]/[chapter]',
            params: { collection: String(collectionId), chapter: String(item.id) },
          })
        }
        accessibilityRole="button"
        accessibilityLabel={`${item.englishName}, ${item.count} hadith`}
        style={[styles.row, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        <Text style={[styles.index, { color: palette.primary, borderColor: palette.accent }]}>{item.id}</Text>
        <View style={styles.rowMain}>
          <Text style={[styles.arabic, { color: palette.ink }]} numberOfLines={1}>
            {item.arabicName}
          </Text>
          <Text style={[styles.english, { color: palette.textMuted }]} numberOfLines={1}>
            {item.englishName} · {item.count}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
      </Pressable>
    ),
    [collectionId, palette, router],
  );

  if (collection === undefined) {
    return (
      <View style={styles.root}>
        <Text style={[styles.empty, { color: palette.textMuted }]}>That collection is not bundled.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Ionicons name="search" size={16} color={palette.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search books"
          placeholderTextColor={palette.textMuted}
          style={[styles.searchInput, { color: palette.text }]}
          accessibilityLabel="Search books of this collection"
        />
      </View>
      <FlatList
        data={chapters}
        keyExtractor={(c) => String(c.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={14}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: palette.textMuted }]}>No book matches that.</Text>
        }
      />
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
    paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  list: { paddingHorizontal: space.md, paddingBottom: space.xxl, gap: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  index: {
    fontSize: 11,
    fontWeight: '700',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  rowMain: { flex: 1 },
  arabic: { fontFamily: 'Amiri_700Bold', fontSize: 17, writingDirection: 'rtl' },
  english: { fontSize: 11, marginTop: 1 },
  empty: { textAlign: 'center', fontSize: 13, padding: space.lg },
});
