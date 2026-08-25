/**
 * One hadith: the Arabic, then its English translation underneath.
 *
 * Amiri, not the mushaf face — KFGQPC Uthmanic Script is the Quran's typeface and
 * setting a narration in it would dress it as revelation.
 */
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Hadith } from '../data/hadith';
import { collectionById } from '../data/hadith';
import { ayahTextSizes, radius, space, type FontStep, type Palette } from '../theme/theme';

export interface HadithCardProps {
  hadith: Hadith;
  palette: Palette;
  fontStep: FontStep;
  /** name the collection on the card, for search results spanning both */
  showSource?: boolean;
}

export const HadithCard = memo(function HadithCard({
  hadith,
  palette,
  fontStep,
  showSource,
}: HadithCardProps) {
  const { fontSize } = ayahTextSizes[fontStep];
  const arabicSize = Math.round(fontSize * 0.72);
  const collection = showSource === true ? collectionById(hadith.collectionId) : undefined;

  return (
    <View style={[styles.card, { backgroundColor: palette.paper, borderColor: palette.paperEdge }]}>
      <View style={styles.header}>
        <Text style={[styles.number, { color: palette.accent, borderColor: palette.accent }]}>
          {hadith.number}
        </Text>
        {collection !== undefined ? (
          <Text style={[styles.source, { color: palette.textMuted }]} numberOfLines={1}>
            {collection.englishTitle}
          </Text>
        ) : null}
      </View>

      <Text
        allowFontScaling={false}
        style={[styles.arabic, { color: palette.ink, fontSize: arabicSize, lineHeight: arabicSize * 1.9 }]}
      >
        {hadith.arabic}
      </Text>

      <View style={[styles.rule, { backgroundColor: palette.border }]} />

      {hadith.narrator.length > 0 ? (
        <Text style={[styles.narrator, { color: palette.primary }]}>{hadith.narrator}</Text>
      ) : null}
      <Text style={[styles.english, { color: palette.textMuted }]}>{hadith.english}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  number: {
    fontSize: 11,
    fontWeight: '700',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  source: { flex: 1, fontSize: 11 },
  arabic: {
    fontFamily: 'Amiri_400Regular',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  rule: { height: StyleSheet.hairlineWidth },
  narrator: { fontSize: 12, fontWeight: '700' },
  english: { fontSize: 14, lineHeight: 21 },
});
