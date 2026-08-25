/**
 * Every hadith of one book, Arabic with the English underneath.
 */
import { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { chapterOf, collectionById, hadithsOfChapter } from '../../../src/data/hadith';
import { HadithCard } from '../../../src/components/HadithCard';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { space } from '../../../src/theme/theme';

export default function ChapterScreen() {
  const params = useLocalSearchParams<{ collection?: string; chapter?: string }>();
  const { palette, fontStep } = useTheme();

  const collectionId = Number(params.collection ?? '1');
  const chapterId = Number(params.chapter ?? '1');
  const collection = collectionById(collectionId);
  const chapter = chapterOf(collectionId, chapterId);
  // 7,000 hadith are in memory once a collection is open; slicing one book out of
  // it is a filter, so keep it memoized rather than doing it on every render.
  const hadiths = useMemo(() => hadithsOfChapter(collectionId, chapterId), [collectionId, chapterId]);

  return (
    <FlatList
      data={hadiths}
      keyExtractor={(h) => String(h.number)}
      renderItem={({ item }) => <HadithCard hadith={item} palette={palette} fontStep={fontStep} />}
      contentContainerStyle={styles.list}
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      windowSize={5}
      removeClippedSubviews
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={[styles.arabic, { color: palette.ink }]}>{chapter?.arabicName ?? ''}</Text>
          <Text style={[styles.english, { color: palette.text }]}>{chapter?.englishName ?? ''}</Text>
          <Text style={[styles.meta, { color: palette.textMuted }]}>
            {collection?.englishTitle} · {hadiths.length} hadith
          </Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={[styles.meta, { color: palette.textMuted }]}>This book has no hadith bundled.</Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.md, paddingBottom: space.xxl, gap: space.sm },
  header: { alignItems: 'center', gap: 2, paddingBottom: space.sm },
  arabic: { fontFamily: 'Amiri_700Bold', fontSize: 22, writingDirection: 'rtl', textAlign: 'center' },
  english: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  meta: { fontSize: 11, textAlign: 'center' },
});
