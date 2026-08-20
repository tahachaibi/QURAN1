/**
 * One mushaf page as a paper card (spec §6.1, §6.3, §7).
 *
 * Page BOUNDARIES are exact — they come from quran-meta's Hafs page list, which
 * scripts/verify-pages.mjs checks against a printed mushaf. Line breaks inside
 * the page are approximate: without per-word Madani line data the honest
 * fallback is to let the text wrap, which §3 permits explicitly. Words are
 * separate views because Arabic does not join across spaces, so nothing is lost
 * in shaping and everything is gained in per-word underlines, dots and taps.
 */
import { memo, useMemo } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import {
  ayahDisplayWords,
  ayahsOnPage,
  surahHasBasmalaHeader,
  surahInfo,
  surahsStartingOnPage,
  type Ayah,
} from '../data/quran';
import { ayahTextSizes, radius, space, type FontStep, type Palette } from '../theme/theme';
import type { PageSlice } from '../hooks/usePageSlice';
import { AyahWord, type WordState } from './AyahWord';

export interface MushafPageProps {
  page: number;
  slice: PageSlice;
  hidden: boolean;
  fontStep: FontStep;
  palette: Palette;
  reduceMotion: boolean;
  level: Animated.Value;
  /** furthest progress; everything below it reads as recited (§5.3) */
  cursor: number;
  hintLevelOf: (word: number) => 0 | 1 | 2;
  onWordPress: (index: number) => void;
  onWordLongPress: (index: number) => void;
  width: number;
}

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const toArabicDigits = (n: number): string =>
  String(n)
    .split('')
    .map((d) => ARABIC_DIGITS[Number(d)] ?? d)
    .join('');

function MushafPageImpl({
  page,
  slice,
  hidden,
  fontStep,
  palette,
  reduceMotion,
  level,
  cursor,
  hintLevelOf,
  onWordPress,
  onWordLongPress,
  width,
}: MushafPageProps) {
  const { fontSize, lineHeight } = ayahTextSizes[fontStep];
  const ayahs = useMemo(() => ayahsOnPage(page), [page]);
  const newSurahs = useMemo(() => surahsStartingOnPage(page), [page]);
  const missedSet = useMemo(() => new Set(slice.missed), [slice.missed]);
  const recitedSet = useMemo(() => new Set(slice.recited), [slice.recited]);

  const stateOf = (index: number): WordState => {
    if (missedSet.has(index)) return 'missed';
    if (index === slice.current) return 'current';
    if (recitedSet.has(index) || index < cursor) return 'recited';
    return 'upcoming';
  };

  return (
    <View style={[styles.page, { width }]}>
      <View
        style={[
          styles.paper,
          { backgroundColor: palette.paper, borderColor: palette.paperEdge },
        ]}
      >
        {/* gold rule along the top (§7) */}
        <View style={[styles.topRule, { backgroundColor: palette.accent }]} />

        {/* progress ribbon along the inner edge: a sense of place Tarteel
            does not give you (§6.3) */}
        <View style={[styles.ribbonTrack, { backgroundColor: palette.paperEdge }]}>
          <View
            style={[
              styles.ribbonFill,
              { backgroundColor: palette.accent, height: `${Math.round(slice.progress * 100)}%` },
            ]}
          />
        </View>

        <View style={styles.body}>
          {ayahs.map((ayah) => (
            <View key={`${ayah.surah}:${ayah.ayah}`} style={styles.ayahBlock}>
              {ayah.ayah === 1 && newSurahs.some((s) => s.number === ayah.surah) ? (
                <SurahHeader ayah={ayah} palette={palette} />
              ) : null}
              <View style={styles.wordRow}>
                {ayahDisplayWords(ayah).map((word, offset) => {
                  const index = ayah.wordStart + offset;
                  if (index < slice.from || index >= slice.to) return null;
                  return (
                    <AyahWord
                      key={index}
                      index={index}
                      text={word}
                      state={stateOf(index)}
                      hidden={hidden}
                      hintLevel={hintLevelOf(index)}
                      fontSize={fontSize}
                      lineHeight={lineHeight}
                      palette={palette}
                      reduceMotion={reduceMotion}
                      level={level}
                      onPress={onWordPress}
                      onLongPress={onWordLongPress}
                      accessibilityHint="Tap to move here, long press to start reciting from here"
                    />
                  );
                })}
                {ayah.wordEnd <= slice.to ? (
                  <AyahMarker number={ayah.ayah} palette={palette} fontSize={fontSize} />
                ) : null}
              </View>
            </View>
          ))}
        </View>

        {/* page number in a small circle at the bottom (§7) */}
        <View style={[styles.pageBadge, { borderColor: palette.accent }]}>
          <Text style={[styles.pageBadgeText, { color: palette.textMuted }]}>{toArabicDigits(page)}</Text>
        </View>
      </View>
    </View>
  );
}

function SurahHeader({ ayah, palette }: { ayah: Ayah; palette: Palette }) {
  return (
    <View style={[styles.surahHeader, { borderColor: palette.accent, backgroundColor: palette.accentSoft }]}>
      <Text style={[styles.surahHeaderText, { color: palette.primary }]}>
        سورة {surahNameOf(ayah.surah)}
      </Text>
      {surahHasBasmalaHeader(ayah.surah) ? (
        <Text style={[styles.basmala, { color: palette.ink }]}>
          بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ
        </Text>
      ) : null}
    </View>
  );
}

const surahNameOf = (n: number): string => surahInfo(n).name;

function AyahMarker({ number, palette, fontSize }: { number: number; palette: Palette; fontSize: number }) {
  return (
    <View style={[styles.marker, { borderColor: palette.accent, width: fontSize + 10, height: fontSize + 10 }]}>
      <Text style={[styles.markerText, { color: palette.accent, fontSize: fontSize * 0.5 }]}>
        {toArabicDigits(number)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  paper: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingTop: space.md,
    paddingBottom: space.xl,
    paddingHorizontal: space.md,
  },
  topRule: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    opacity: 0.7,
  },
  ribbonTrack: {
    position: 'absolute',
    top: space.md,
    bottom: space.xl,
    right: 2,
    width: 3,
    borderRadius: 2,
  },
  ribbonFill: {
    width: 3,
    borderRadius: 2,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  ayahBlock: {
    marginBottom: space.sm,
  },
  wordRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  surahHeader: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    marginBottom: space.md,
    alignItems: 'center',
  },
  surahHeaderText: {
    fontFamily: 'Amiri_700Bold',
    fontSize: 20,
  },
  basmala: {
    fontFamily: 'AmiriQuran_400Regular',
    fontSize: 20,
    marginTop: space.xs,
    lineHeight: 44,
  },
  marker: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  markerText: {
    fontFamily: 'Amiri_400Regular',
  },
  pageBadge: {
    position: 'absolute',
    bottom: space.sm,
    alignSelf: 'center',
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBadgeText: {
    fontFamily: 'Amiri_400Regular',
    fontSize: 14,
  },
});

export const MushafPage = memo(MushafPageImpl, (a, b) =>
  a.page === b.page &&
  a.slice === b.slice &&
  a.hidden === b.hidden &&
  a.fontStep === b.fontStep &&
  a.palette === b.palette &&
  a.reduceMotion === b.reduceMotion &&
  a.level === b.level &&
  a.cursor === b.cursor &&
  a.hintLevelOf === b.hintLevelOf &&
  a.onWordPress === b.onWordPress &&
  a.onWordLongPress === b.onWordLongPress &&
  a.width === b.width);
