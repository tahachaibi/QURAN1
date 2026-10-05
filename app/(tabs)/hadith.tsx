/**
 * Hadith tab: the two Sahih collections, and a search across both.
 *
 * Arabic here is set in Amiri, not the mushaf face. KFGQPC Uthmanic Script is
 * the Quran's typeface; using it for hadith would dress a narration as revelation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  collections,
  searchHadithPage,
  type HadithCollection,
  type HadithSearchPage,
} from '../../src/data/hadith';
import { adhkarCount, defaultTime } from '../../src/data/adhkar';
import { HadithCard } from '../../src/components/HadithCard';
import { useT } from '../../src/i18n/useT';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, space } from '../../src/theme/theme';

/** How many results a search shows; the footer says so when there were more. */
const SEARCH_LIMIT = 40;

/**
 * How long typing has to pause before the collections are scanned. A scan reads
 * fourteen thousand narrations on the JS thread; doing one per keystroke made
 * every letter of a rare word wait for the one before it.
 */
const SEARCH_DEBOUNCE_MS = 250;

const NO_RESULTS: HadithSearchPage = { hits: [], more: false };

/** 7276 → "7,276", the same on every phone, whatever its locale. */
const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export default function HadithTab() {
  const { palette, fontStep } = useTheme();
  const { t, arabic } = useT();
  const router = useRouter();
  const [query, setQuery] = useState('');
  /** the query the results belong to, which trails `query` while typing */
  const [searched, setSearched] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setSearched(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Searching scans the collections, so only do it once the query is worth it.
  const results = useMemo<HadithSearchPage>(
    () => (searched.trim().length < 2 ? NO_RESULTS : searchHadithPage(searched, { limit: SEARCH_LIMIT })),
    [searched],
  );
  const searching = query.trim().length >= 2;
  /** false while typing has not yet paused: "nothing matches" would be premature */
  const settled = searched === query;

  const renderCollection = useCallback(
    ({ item }: { item: HadithCollection }) => (
      <Pressable
        onPress={() => router.push({ pathname: '/hadith/[collection]', params: { collection: String(item.id) } })}
        accessibilityRole="button"
        accessibilityLabel={`${arabic ? item.arabicTitle : item.englishTitle}, ${t('{n} hadith', { n: item.total })}`}
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        <View style={styles.cardMain}>
          <Text style={[styles.cardArabic, { color: palette.ink }]}>{item.arabicTitle}</Text>
          {arabic ? null : <Text style={[styles.cardTitle, { color: palette.text }]}>{item.englishTitle}</Text>}
          <Text style={[styles.cardMeta, { color: palette.textMuted }]}>
            {/* The Arabic form is chosen by the number in {n}, so Arabic gets the
                number itself: a formatted "7,276" is not a number, and read as
                0 it picked "7,276 حديث" where 7276 takes "حديثًا". */}
            {arabic ? item.arabicAuthor : item.englishAuthor} ·{' '}
            {t('{n} hadith', { n: arabic ? item.total : grouped(item.total) })} ·{' '}
            {t('{n} books', { n: item.chapters.length })}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
      </Pressable>
    ),
    [palette, router, t, arabic],
  );

  return (
    <View style={styles.root}>
      <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Ionicons name="search" size={16} color={palette.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('Search both collections, Arabic or English')}
          placeholderTextColor={palette.textMuted}
          style={[styles.searchInput, { color: palette.text }]}
          accessibilityLabel={t('Search hadith')}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Clear search')}>
            <Ionicons name="close-circle" size={18} color={palette.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {searching ? (
        <FlatList
          data={results.hits}
          keyExtractor={(h) => `${h.collectionId}-${h.number}`}
          renderItem={({ item }) => (
            <HadithCard hadith={item} palette={palette} fontStep={fontStep} showSource />
          )}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={6}
          ListEmptyComponent={
            settled ? (
              <Text style={[styles.empty, { color: palette.textMuted }]}>
                {t('Nothing matches that in Bukhari or Muslim.')}
              </Text>
            ) : null
          }
          ListFooterComponent={
            // A cut list has to say it was cut, or a common word reads as
            // "these are all the hadith that mention it".
            settled && results.more ? (
              <Text style={[styles.empty, { color: palette.textMuted }]}>
                {t('Showing the first {n} matches. Add a word to narrow it.', { n: results.hits.length })}
              </Text>
            ) : null
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
             *
             * Everything on it is drawn in the colours the palette pairs with
             * primary. Hard-coded white and the gold accent read well on the
             * dark green of the day palette, but the night palette's primary is
             * a light green, where white measured 2.0:1 and the gold 1.2:1.
             */
            <Pressable
              onPress={() => router.push('/adhkar')}
              accessibilityRole="button"
              accessibilityLabel={t('Adhkar of the morning and evening')}
              style={[styles.card, { backgroundColor: palette.primary, borderColor: palette.accent }]}
            >
              <Ionicons name="partly-sunny-outline" size={22} color={palette.accentSoft} />
              <View style={styles.cardMain}>
                <Text style={[styles.cardTitle, { color: palette.paper }]}>{t('Adhkar · morning & evening')}</Text>
                <Text style={[styles.cardMeta, { color: palette.accentSoft }]}>
                  {defaultTime() === 'morning'
                    ? t('{n} to say this morning', { n: adhkarCount(defaultTime()) })
                    : t('{n} to say this evening', { n: adhkarCount(defaultTime()) })}{' '}
                  {/* Not "every one from Bukhari, Muslim or the Qur'an": most
                      of the du'as are matched to no narration and cite only
                      islambook.com, which the adhkar screen itself says. */}
                  · {t('each with its source')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={palette.accentSoft} />
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
