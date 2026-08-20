/**
 * One mushaf page as a paper card (spec §6.1, §6.3, §7).
 *
 * Page BOUNDARIES are exact — they come from quran-meta's Hafs page list, which
 * scripts/verify-pages.mjs checks against a printed mushaf.
 *
 * Layout is a two-pass measure-then-justify, which is what makes this read like
 * a mushaf rather than a list of centred verses:
 *
 *   Pass 1  every word of the page flows through ONE wrapping container, so
 *           ayahs run continuously into each other with their markers inline —
 *           a mushaf does not start a new line per verse. Each word reports its
 *           y position, which tells us which line it landed on.
 *   Pass 2  each measured line is re-rendered as its own row with
 *           `space-between`, stretching it to both edges. That is inter-word
 *           justification, done in flexbox so per-word underlines, mistake dots
 *           and tap targets all survive.
 *
 * `textAlign: 'justify'` would have been one line of code (RN maps it to
 * Layout.JUSTIFICATION_MODE_INTER_WORD on API 26+), but it only works inside a
 * single <Text>, and Android supports neither textDecorationColor nor
 * textDecorationStyle — so every word state would have collapsed into one
 * indistinguishable underline.
 *
 * Font size is fitted to the page's own density and the lines are distributed
 * down the full height, so a page is always exactly one screen: no scrolling.
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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

type Token =
  | { kind: 'word'; key: string; index: number; text: string }
  | { kind: 'marker'; key: string; ayah: number };

/**
 * Characters on a typical Madani page, tashkeel included. Used only to scale the
 * font so a dense page still fits one screen; page boundaries never move.
 */
const REFERENCE_CHARS = 820;
const MIN_SCALE = 0.66;
const MAX_SCALE = 1.18;

/** Measured line assignments, cached so revisiting a page is instant. */
const lineCache = new Map<string, number[]>();

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
  const ayahs = useMemo(() => ayahsOnPage(page), [page]);
  const newSurahs = useMemo(() => surahsStartingOnPage(page), [page]);
  const missedSet = useMemo(() => new Set(slice.missed), [slice.missed]);
  const recitedSet = useMemo(() => new Set(slice.recited), [slice.recited]);

  /** Every word and ayah marker on the page, in reading order, continuous. */
  const tokens = useMemo<Token[]>(() => {
    const out: Token[] = [];
    for (const ayah of ayahs) {
      ayahDisplayWords(ayah).forEach((text, offset) => {
        const index = ayah.wordStart + offset;
        if (index < slice.from || index >= slice.to) return;
        out.push({ kind: 'word', key: `w${index}`, index, text });
      });
      if (ayah.wordEnd <= slice.to) {
        out.push({ kind: 'marker', key: `m${ayah.surah}-${ayah.ayah}`, ayah: ayah.ayah });
      }
    }
    return out;
  }, [ayahs, slice.from, slice.to]);

  /** Fit the type to this page's density so the page never needs scrolling. */
  const { fontSize, lineHeight } = useMemo(() => {
    const base = ayahTextSizes[fontStep];
    let chars = 0;
    for (const t of tokens) if (t.kind === 'word') chars += t.text.length;
    const raw = Math.sqrt(REFERENCE_CHARS / Math.max(1, chars));
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, raw));
    return {
      fontSize: Math.round(base.fontSize * scale),
      lineHeight: Math.round(base.lineHeight * scale),
    };
  }, [fontStep, tokens]);

  const cacheKey = `${page}:${fontStep}:${width}:${slice.from}:${slice.to}`;
  const [lines, setLines] = useState<number[] | null>(() => lineCache.get(cacheKey) ?? null);
  const measured = useRef(new Map<number, number>());

  // Reset when the page or the type changes: old measurements describe a
  // different layout and would group the wrong words together.
  const lastKey = useRef(cacheKey);
  if (lastKey.current !== cacheKey) {
    lastKey.current = cacheKey;
    measured.current = new Map();
    const cached = lineCache.get(cacheKey) ?? null;
    setLines(cached);
  }

  const onTokenLayout = useCallback(
    (i: number, event: LayoutChangeEvent) => {
      if (lineCache.has(cacheKey)) return;
      measured.current.set(i, Math.round(event.nativeEvent.layout.y));
      if (measured.current.size < tokens.length) return;
      // Every token has reported: turn y positions into line numbers.
      const ys = [...new Set([...measured.current.values()])].sort((a, b) => a - b);
      const lineOf = tokens.map((_, index) => ys.indexOf(measured.current.get(index) ?? 0));
      lineCache.set(cacheKey, lineOf);
      setLines(lineOf);
    },
    [cacheKey, tokens],
  );

  const stateOf = (index: number): WordState => {
    if (missedSet.has(index)) return 'missed';
    if (index === slice.current) return 'current';
    if (recitedSet.has(index) || index < cursor) return 'recited';
    return 'upcoming';
  };

  const renderToken = (token: Token, i: number, measuring: boolean) => {
    const onLayout = measuring ? (e: LayoutChangeEvent) => onTokenLayout(i, e) : undefined;
    if (token.kind === 'marker') {
      return (
        <View key={token.key} onLayout={onLayout}>
          <AyahMarker number={token.ayah} palette={palette} fontSize={fontSize} />
        </View>
      );
    }
    return (
      <View key={token.key} onLayout={onLayout}>
        <AyahWord
          index={token.index}
          text={token.text}
          state={stateOf(token.index)}
          hidden={hidden}
          hintLevel={hintLevelOf(token.index)}
          fontSize={fontSize}
          lineHeight={lineHeight}
          palette={palette}
          reduceMotion={reduceMotion}
          level={level}
          onPress={onWordPress}
          onLongPress={onWordLongPress}
          accessibilityHint="Tap to move here, long press to start reciting from here"
        />
      </View>
    );
  };

  /** Group tokens by their measured line. */
  const grouped = useMemo<Token[][]>(() => {
    if (lines === null) return [];
    const out: Token[][] = [];
    tokens.forEach((token, i) => {
      const line = lines[i] ?? 0;
      if (out[line] === undefined) out[line] = [];
      out[line].push(token);
    });
    return out.filter((l) => l !== undefined && l.length > 0);
  }, [lines, tokens]);

  return (
    <View style={[styles.page, { width }]}>
      <View style={[styles.paper, { backgroundColor: palette.paper, borderColor: palette.paperEdge }]}>
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
          {newSurahs.map((s) => (
            <SurahHeader key={s.number} ayah={ayahs.find((a) => a.surah === s.number) ?? ayahs[0]} palette={palette} />
          ))}

          {lines === null ? (
            // Pass 1: one continuous wrap, measuring where each word lands.
            <View style={styles.measure}>
              {tokens.map((token, i) => renderToken(token, i, true))}
            </View>
          ) : (
            // Pass 2: one row per measured line, stretched to both edges.
            <View style={styles.lines}>
              {grouped.map((line, li) => (
                <View
                  key={li}
                  style={[
                    styles.line,
                    // the final line of a page is short, so it sits flush to the
                    // right margin instead of being stretched across the page
                    { justifyContent: li === grouped.length - 1 ? 'flex-start' : 'space-between' },
                  ]}
                >
                  {line.map((token) => renderToken(token, 0, false))}
                </View>
              ))}
            </View>
          )}
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
  const size = Math.round(fontSize * 0.86);
  return (
    <View style={[styles.marker, { borderColor: palette.accent, width: size, height: size }]}>
      <Text style={[styles.markerText, { color: palette.accent, fontSize: Math.round(fontSize * 0.42) }]}>
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
  },
  measure: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  /** lines spread down the full height of the page, as a mushaf's do */
  lines: {
    flex: 1,
    justifyContent: 'space-evenly',
  },
  line: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
  },
  surahHeader: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    marginBottom: space.sm,
    alignItems: 'center',
  },
  surahHeaderText: {
    fontFamily: 'Amiri_700Bold',
    fontSize: 20,
  },
  basmala: {
    fontFamily: 'Amiri_400Regular',
    fontSize: 20,
    marginTop: space.xs,
    lineHeight: 44,
  },
  marker: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 3,
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
