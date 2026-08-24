/**
 * One mushaf page as a paper card (spec §6.1, §6.3, §7).
 *
 * Page boundaries AND line breaks are the real ones, imported from the QUL
 * QCF V2 (1421H) layout — the same data Tarteel renders. So this is the printed
 * page, not a plausible-looking approximation: 15 lines, the ayah markers where
 * the print puts them, and the surah bands that close a page with the text
 * beginning overleaf.
 *
 * Because the lines are given, the layout no longer has to discover them. One
 * measuring pass remains, and it measures something far more robust than line
 * breaks: the natural width of each fixed line. Widths scale linearly with font
 * size, so a single pass gives the exact scale at which the widest line fits the
 * page — no iteration, and a page is always exactly one screen.
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Animated, type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';

import { ayahDisplayWords, ayahByGlobal, globalAyahOf, surahInfo, wordInAyahOf } from '../data/quran';
import { linesOfPage, type MushafLine } from '../data/lines';
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

const MIN_SCALE = 0.3;
const MAX_SCALE = 1.6;
/** Slack so a rounding error cannot push the widest line past the margin. */
const SAFETY = 0.985;

/** Converged scales, cached so revisiting a page is instant. */
const scaleCache = new Map<string, number>();

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
  const lines = useMemo(() => linesOfPage(page), [page]);
  const missedSet = useMemo(() => new Set(slice.missed), [slice.missed]);
  const recitedSet = useMemo(() => new Set(slice.recited), [slice.recited]);

  const base = ayahTextSizes[fontStep];
  const [box, setBox] = useState({ w: 0, h: 0 });
  const cacheKey = `${page}:${fontStep}:${Math.round(box.w)}:${Math.round(box.h)}`;
  const [scale, setScale] = useState<number | null>(() => scaleCache.get(cacheKey) ?? null);

  const natural = useRef(new Map<number, number>());
  const lastKey = useRef(cacheKey);
  if (lastKey.current !== cacheKey) {
    lastKey.current = cacheKey;
    natural.current = new Map();
    setScale(scaleCache.get(cacheKey) ?? null);
  }

  const onBoxLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    setBox((current) =>
      Math.abs(current.w - w) > 1 || Math.abs(current.h - h) > 1
        ? { w: Math.round(w), h: Math.round(h) }
        : current,
    );
  }, []);

  const onLineLayout = useCallback(
    (i: number, event: LayoutChangeEvent) => {
      if (scaleCache.has(cacheKey)) return;
      natural.current.set(i, event.nativeEvent.layout.width);
      if (natural.current.size < lines.length) return;
      if (box.w <= 0 || box.h <= 0) return;

      // Widths scale linearly with font size, so the fit is exact in one step.
      let widest = 0;
      for (const w of natural.current.values()) widest = Math.max(widest, w);
      const byWidth = widest > 0 ? box.w / widest : MAX_SCALE;
      const byHeight = box.h / (lines.length * base.lineHeight);
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(byWidth, byHeight) * SAFETY));
      scaleCache.set(cacheKey, next);
      setScale(next);
    },
    [base.lineHeight, box.h, box.w, cacheKey, lines.length],
  );

  const fontSize = Math.max(8, Math.round(base.fontSize * (scale ?? 1)));
  const lineHeight = Math.max(12, Math.round(base.lineHeight * (scale ?? 1)));

  const stateOf = (index: number): WordState => {
    if (missedSet.has(index)) return 'missed';
    if (index === slice.current) return 'current';
    if (recitedSet.has(index) || index < cursor) return 'recited';
    return 'upcoming';
  };

  const renderLine = (line: MushafLine, i: number, measuring: boolean) => {
    if (line.kind === 'surah') {
      return (
        <View key={`s${i}`} style={styles.bandRow} onLayout={measuring ? (e) => onLineLayout(i, e) : undefined}>
          <SurahBand surah={line.surah} palette={palette} fontSize={fontSize} />
        </View>
      );
    }
    if (line.kind === 'basmala') {
      return (
        <View key={`b${i}`} style={styles.centeredRow}>
          <Text
            allowFontScaling={false}
            onLayout={measuring ? (e) => onLineLayout(i, e) : undefined}
            style={[styles.basmala, { color: palette.ink, fontSize, lineHeight }]}
          >
            بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ
          </Text>
        </View>
      );
    }

    const tokens = line.tokens.map((token) =>
      token.kind === 'marker' ? (
        <AyahMarker
          key={`m${token.ayah}-${i}`}
          number={token.ayah}
          palette={palette}
          fontSize={fontSize}
          lineHeight={lineHeight}
        />
      ) : (
        <AyahWord
          key={token.index}
          index={token.index}
          text={displayWordOf(token.index)}
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
      ),
    );

    if (measuring) {
      // measured at natural width, so the scale can be solved directly
      return (
        <View key={`a${i}`} style={styles.measureRow}>
          <View style={styles.naturalRow} onLayout={(e) => onLineLayout(i, e)}>
            {tokens}
          </View>
        </View>
      );
    }
    return (
      <View
        key={`a${i}`}
        style={[
          styles.line,
          { minHeight: lineHeight },
          // a centred line is centred in the print too: the last line of a surah
          { justifyContent: line.centered ? 'center' : 'space-between' },
        ]}
      >
        {tokens}
      </View>
    );
  };

  return (
    <View style={[styles.page, { width }]}>
      <View style={[styles.paper, { backgroundColor: palette.paper, borderColor: palette.paperEdge }]}>
        <View style={[styles.topRule, { backgroundColor: palette.accent }]} />

        <View style={[styles.ribbonTrack, { backgroundColor: palette.paperEdge }]}>
          <View
            style={[
              styles.ribbonFill,
              { backgroundColor: palette.accent, height: `${Math.round(slice.progress * 100)}%` },
            ]}
          />
        </View>

        <View style={styles.body} onLayout={onBoxLayout}>
          {scale === null ? (
            <View>{lines.map((line, i) => renderLine(line, i, true))}</View>
          ) : (
            <View style={styles.lines}>{lines.map((line, i) => renderLine(line, i, false))}</View>
          )}
        </View>

        <View style={[styles.pageBadge, { borderColor: palette.accent }]}>
          <Text style={[styles.pageBadgeText, { color: palette.textMuted }]}>{toArabicDigits(page)}</Text>
        </View>
      </View>
    </View>
  );
}

/** Display token for a global word index, via its ayah's tokenisation. */
function displayWordOf(index: number): string {
  const ayah = ayahByGlobal(globalAyahOf(index));
  return ayahDisplayWords(ayah)[wordInAyahOf(index)] ?? '';
}

/** The ornamental surah band a printed mushaf puts above a new surah. */
function SurahBand({ surah, palette, fontSize }: { surah: number; palette: Palette; fontSize: number }) {
  return (
    <View style={[styles.surahOuter, { borderColor: palette.accent, backgroundColor: palette.accentSoft }]}>
      <View style={[styles.surahInner, { borderColor: palette.accent }]}>
        <Text style={[styles.surahOrnament, { color: palette.accent, fontSize: fontSize * 0.5 }]}>❁</Text>
        <Text style={[styles.surahName, { color: palette.primary, fontSize: fontSize * 0.82 }]}>
          سورة {surahInfo(surah).name}
        </Text>
        <Text style={[styles.surahOrnament, { color: palette.accent, fontSize: fontSize * 0.5 }]}>❁</Text>
      </View>
    </View>
  );
}

/**
 * The ayah-end marker as the print draws it.
 *
 * U+06DD ARABIC END OF AYAH is an enclosing mark: the digits that follow it are
 * drawn INSIDE the ornament by the font itself. So the correct marker is one
 * text run — U+06DD followed by the Arabic-Indic digits — not a circle drawn in
 * flexbox with a number centred in it, which is what made the page read as an
 * app rather than a mushaf.
 */
function AyahMarker({
  number,
  palette,
  fontSize,
  lineHeight,
}: {
  number: number;
  palette: Palette;
  fontSize: number;
  lineHeight: number;
}) {
  return (
    <Text
      allowFontScaling={false}
      // shares the line's metrics so the ornament sits on the same baseline as
      // the words either side of it
      style={[styles.markerText, { color: palette.accent, fontSize, lineHeight }]}
    >
      {`\u06DD${toArabicDigits(number)}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.sm, paddingVertical: space.sm },
  paper: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingTop: space.md,
    paddingBottom: space.xl,
    paddingHorizontal: space.md,
  },
  topRule: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, opacity: 0.7 },
  ribbonTrack: {
    position: 'absolute',
    top: space.md,
    bottom: space.xl,
    right: 2,
    width: 3,
    borderRadius: 2,
  },
  ribbonFill: { width: 3, borderRadius: 2 },
  body: { flex: 1 },
  /** the 15 lines fill the page height, as the print's do */
  lines: { flex: 1, justifyContent: 'space-between' },
  line: { flexDirection: 'row-reverse', alignItems: 'flex-end' },
  measureRow: { flexDirection: 'row-reverse' },
  naturalRow: { flexDirection: 'row-reverse', alignItems: 'flex-end', alignSelf: 'flex-start' },
  bandRow: { alignItems: 'center' },
  centeredRow: { alignItems: 'center' },
  basmala: {
    fontFamily: 'KFGQPC-Hafs',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  surahOuter: { borderWidth: 1, borderRadius: radius.sm, padding: 3, alignSelf: 'stretch' },
  surahInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: space.md,
  },
  surahName: { fontFamily: 'Amiri_700Bold', writingDirection: 'rtl' },
  surahOrnament: {},
  markerText: {
    fontFamily: 'KFGQPC-Hafs',
    writingDirection: 'rtl',
    marginHorizontal: 1,
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
  pageBadgeText: { fontFamily: 'Amiri_400Regular', fontSize: 14 },
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
