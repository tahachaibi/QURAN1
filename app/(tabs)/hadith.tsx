/**
 * Hadith tab: the two Sahih collections, and a search across both.
 *
 * Arabic here is set in Amiri, not the mushaf face. KFGQPC Uthmanic Script is
 * the Quran's typeface; using it for hadith would dress a narration as revelation.
 */
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { collections, searchHadith, type Hadith, type HadithCollection } from '../../src/data/hadith';
import { adhkarCount, defaultTime } from '../../src/data/adhkar';
import { HadithCard } from '../../src/components/HadithCard';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, space } from '../../src/theme/theme';

export default function HadithTab() {
  const { palette, fontStep } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');

  // Searching scans the collections, so only do it once the query is worth it.
  const results = useMemo<Hadith[]>(
    () => (query.trim().length < 2 ? [] : searchHadith(query, { limit: 40 })),
    [query],
  );
  const searching = query.trim().length >= 2;

  const renderCollection = useCallback(
    ({ item }: { item: HadithCollection }) => (
      <Pressable
        onPress={() => router.push({ pathname: '/hadith/[collection]', params: { collection: String(item.id) } })}
        accessibilityRole="button"
        accessibilityLabel={`${item.englishTitle}, ${item.total} hadith`}
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        <View style={styles.cardMain}>
          <Text style={[styles.cardArabic, { color: palette.ink }]}>{item.arabicTitle}</Text>
          <Text style={[styles.cardTitle, { color: palette.text }]}>{item.englishTitle}</Text>
          <Text style={[styles.cardMeta, { color: palette.textMuted }]}>
            {item.englishAuthor} · {item.total.toLocaleString()} hadith · {item.chapters.length} books
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
      </Pressable>
    ),
    [palette, router],
  );

  return (
    <View style={styles.root}>
      <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Ionicons name="search" size={16} color={palette.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search both collections, Arabic or English"
          placeholderTextColor={palette.textMuted}
          style={[styles.searchInput, { color: palette.text }]}
          accessibilityLabel="Search hadith"
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={palette.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {searching ? (
        <FlatList
          data={results}
          keyExtractor={(h) => `${h.collectionId}-${h.number}`}
          renderItem={({ item }) => (
            <HadithCard hadith={item} palette={palette} fontStep={fontStep} showSource />
          )}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={6}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              Nothing matches that in Bukhari or Muslim.
            </Text>
          }
        />
      ) : (
        <FlatList
          data={collections as HadithCollection[]}
          keyExtractor={(c) => String(c.id)}
          renderItem={renderCollection}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            /**
             * Above the collections rather than inside them: the adhkar are a
             * thing you DO at a time of day, not a book you browse, and burying
             * them one level down would mean nobody reciting them twice a day
             * ever finds them.
             */
            <Pressable
              onPress={() => router.push('/adhkar')}
              accessibilityRole="button"
              accessibilityLabel="Adhkar of the morning and evening"
              style={[styles.card, { backgroundColor: palette.primary, borderColor: palette.accent }]}
            >
              <Ionicons name="partly-sunny-outline" size={22} color={palette.accent} />
              <View style={styles.cardMain}>
                <Text style={[styles.cardTitle, { color: '#FFFFFF' }]}>Adhkar · morning & evening</Text>
                <Text style={[styles.cardMeta, { color: palette.accentSoft }]}>
                  {adhkarCount(defaultTime())} to say {defaultTime() === 'morning' ? 'this morning' : 'this evening'} ·
                  every one quoted from Bukhari, Muslim or the Qur'an
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={palette.accent} />
            </Pressable>
          }
        />
      )}
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
  list: { paddingHorizontal: space.md, paddingBottom: space.xxl, gap: space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
  },
  cardMain: { flex: 1, gap: 2 },
  cardArabic: { fontFamily: 'Amiri_700Bold', fontSize: 22, writingDirection: 'rtl' },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardMeta: { fontSize: 11 },
  empty: { textAlign: 'center', fontSize: 13, padding: space.lg },
});
