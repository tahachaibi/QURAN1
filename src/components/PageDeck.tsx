/**
 * The mushaf as pages, never a scroll (spec §6.1).
 *
 * An inverted horizontal FlatList over ALL 604 pages, so swiping past a surah's
 * first page continues into the previous surah's last page and vice versa — the
 * Quran is continuous, so the reader is too. Inversion gives right-to-left paging
 * without fighting RTL layout.
 *
 * `getItemLayout` is supplied because every page is exactly one screen wide;
 * without it, scrollToIndex over 604 items is a guess.
 */
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { Animated, FlatList, type ListRenderItemInfo, StyleSheet, View } from 'react-native';

import { TOTAL_PAGES } from '../data/quran';
import { usePageSlice } from '../hooks/usePageSlice';
import type { SessionState } from '../engine/session';
import type { FontStep, Palette } from '../theme/theme';
import { MushafPage } from './MushafPage';

export interface PageDeckHandle {
  goToPage: (page: number, animated?: boolean) => void;
}

export interface PageDeckProps {
  session: SessionState;
  page: number;
  onPageChange: (page: number) => void;
  hidden: boolean;
  fontStep: FontStep;
  palette: Palette;
  reduceMotion: boolean;
  level: Animated.Value;
  hintLevelOf: (word: number) => 0 | 1 | 2;
  onWordPress: (index: number) => void;
  onWordLongPress: (index: number) => void;
  width: number;
}

const PAGES = Array.from({ length: TOTAL_PAGES }, (_, i) => i + 1);

export const PageDeck = forwardRef<PageDeckHandle, PageDeckProps>(function PageDeck(props, ref) {
  const {
    session,
    page,
    onPageChange,
    hidden,
    fontStep,
    palette,
    reduceMotion,
    level,
    hintLevelOf,
    onWordPress,
    onWordLongPress,
    width,
  } = props;

  const list = useRef<FlatList<number>>(null);
  const sliceFor = usePageSlice(session);

  useImperativeHandle(
    ref,
    () => ({
      goToPage: (target: number, animated = true) => {
        const index = clampIndex(target);
        list.current?.scrollToIndex({ index, animated: animated && !reduceMotion });
      },
    }),
    [reduceMotion],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<number> | null | undefined, index: number) => ({
      length: width,
      offset: width * index,
      index,
    }),
    [width],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<number>) => (
      <MushafPage
        page={item}
        slice={sliceFor(item)}
        hidden={hidden}
        fontStep={fontStep}
        palette={palette}
        reduceMotion={reduceMotion}
        level={level}
        cursor={session.cursor}
        hintLevelOf={hintLevelOf}
        onWordPress={onWordPress}
        onWordLongPress={onWordLongPress}
        width={width}
      />
    ),
    [
      sliceFor,
      hidden,
      fontStep,
      palette,
      reduceMotion,
      level,
      session.cursor,
      hintLevelOf,
      onWordPress,
      onWordLongPress,
      width,
    ],
  );

  const onMomentumScrollEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      const index = Math.round(event.nativeEvent.contentOffset.x / width);
      const next = clampPage(index + 1);
      if (next !== page) onPageChange(next);
    },
    [onPageChange, page, width],
  );

  const initialIndex = useMemo(() => clampIndex(page), [page]);

  return (
    <View style={styles.fill}>
      <FlatList
        ref={list}
        data={PAGES}
        // inverted gives right-to-left paging; the Quran reads that way
        inverted
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        initialScrollIndex={initialIndex}
        onMomentumScrollEnd={onMomentumScrollEnd}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        removeClippedSubviews
        decelerationRate="fast"
      />
    </View>
  );
});

const keyExtractor = (item: number): string => String(item);
const clampPage = (p: number): number => (p < 1 ? 1 : p > TOTAL_PAGES ? TOTAL_PAGES : p);
const clampIndex = (p: number): number => clampPage(p) - 1;

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
