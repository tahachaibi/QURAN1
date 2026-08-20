/**
 * Mistakes review that actually teaches (spec §6.5).
 *
 * A bottom sheet, not a screen and not a modal that loses your place: the page
 * stays mounted behind it, so dismissing a mistake never costs you your
 * position. Grouped by ayah with a count per ayah.
 */
import { memo, useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ayahDisplayWords, ayahByGlobal, globalAyahOf, wordInAyahOf, words } from '../data/quran';
import type { Mistake } from '../engine/mistakes';
import { radius, space, type Palette } from '../theme/theme';

export interface MistakeSheetProps {
  visible: boolean;
  mistakes: readonly Mistake[];
  palette: Palette;
  onClose: () => void;
  onDismiss: (word: number) => void;
  onGoToWord: (word: number) => void;
  onPractise: (word: number) => void;
  onPlayWord: (word: number) => void;
}

interface AyahGroup {
  globalAyah: number;
  label: string;
  items: Mistake[];
}

export const MistakeSheet = memo(function MistakeSheet({
  visible,
  mistakes,
  palette,
  onClose,
  onDismiss,
  onGoToWord,
  onPractise,
  onPlayWord,
}: MistakeSheetProps) {
  const groups = useMemo<AyahGroup[]>(() => {
    const byAyah = new Map<number, Mistake[]>();
    for (const m of mistakes) {
      const g = globalAyahOf(m.word);
      const list = byAyah.get(g);
      if (list === undefined) byAyah.set(g, [m]);
      else list.push(m);
    }
    return [...byAyah.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([globalAyah, items]) => {
        const ayah = ayahByGlobal(globalAyah);
        return { globalAyah, label: `${ayah.surah}:${ayah.ayah}`, items };
      });
  }, [mistakes]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: palette.overlay }]} onPress={onClose} accessibilityLabel="Close mistakes" />
      <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.handleRow}>
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
        </View>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]}>
            {mistakes.length === 0 ? 'Nothing to review' : `${mistakes.length} to review`}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={20} color={palette.textMuted} />
          </Pressable>
        </View>

        {mistakes.length === 0 ? (
          <Text style={[styles.empty, { color: palette.textMuted }]}>
            Your recitation matched the mushaf all the way through. Nothing here needs practice.
          </Text>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {groups.map((group) => (
              <View key={group.globalAyah} style={styles.group}>
                <View style={styles.groupHeader}>
                  <Text style={[styles.groupLabel, { color: palette.primary }]}>{group.label}</Text>
                  <Text style={[styles.groupCount, { color: palette.textMuted }]}>
                    {group.items.length} {group.items.length === 1 ? 'word' : 'words'}
                  </Text>
                </View>
                {group.items.map((mistake) => (
                  <MistakeRow
                    key={mistake.word}
                    mistake={mistake}
                    palette={palette}
                    onDismiss={onDismiss}
                    onGoToWord={onGoToWord}
                    onPractise={onPractise}
                    onPlayWord={onPlayWord}
                  />
                ))}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
});

function MistakeRow({
  mistake,
  palette,
  onDismiss,
  onGoToWord,
  onPractise,
  onPlayWord,
}: {
  mistake: Mistake;
  palette: Palette;
  onDismiss: (word: number) => void;
  onGoToWord: (word: number) => void;
  onPractise: (word: number) => void;
  onPlayWord: (word: number) => void;
}) {
  const ayah = ayahByGlobal(globalAyahOf(mistake.word));
  const display = ayahDisplayWords(ayah);
  const offset = wordInAyahOf(mistake.word);
  const correct = display[offset] ?? words[mistake.word];
  const before = display.slice(Math.max(0, offset - 2), offset).join(' ');
  const after = display.slice(offset + 1, offset + 3).join(' ');

  return (
    <Pressable
      onPress={() => onGoToWord(mistake.word)}
      onLongPress={() => onPractise(mistake.word)}
      accessibilityRole="button"
      accessibilityLabel={`Missed word ${correct} in ${ayah.surah}:${ayah.ayah}`}
      accessibilityHint="Tap to jump to this word on the page, long press to mark it for practice"
      style={[styles.row, { borderColor: palette.border }]}
    >
      <View style={styles.rowText}>
        {/* the correct word, large, gold-highlighted in its phrase context */}
        <Text style={[styles.phrase, { color: palette.textMuted }]} numberOfLines={2}>
          {after}{' '}
          <Text style={[styles.correct, { color: palette.ink, backgroundColor: palette.accentSoft }]}>
            {correct}
          </Text>{' '}
          {before}
        </Text>
        {mistake.heardInstead.length > 0 ? (
          <Text style={[styles.heard, { color: palette.error }]} numberOfLines={1}>
            heard: {mistake.heardInstead}
          </Text>
        ) : (
          <Text style={[styles.heard, { color: palette.textMuted }]}>nothing heard here</Text>
        )}
      </View>
      <View style={styles.rowActions}>
        <Pressable
          onPress={() => onPlayWord(mistake.word)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Play the correct recitation of this ayah"
        >
          <Ionicons name="play-circle-outline" size={26} color={palette.primary} />
        </Pressable>
        <Pressable
          onPress={() => onDismiss(mistake.word)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="I said it right"
          accessibilityHint="Removes this permanently and never flags this word again"
        >
          <Ionicons name="checkmark-circle-outline" size={26} color={palette.success} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '72%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: space.xl,
  },
  handleRow: { alignItems: 'center', paddingTop: space.sm },
  handle: { width: 38, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  title: { fontSize: 17, fontWeight: '700' },
  empty: { paddingHorizontal: space.md, paddingBottom: space.lg, fontSize: 14, lineHeight: 21 },
  list: { paddingHorizontal: space.md, paddingBottom: space.md },
  group: { marginBottom: space.md },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.xs,
  },
  groupLabel: { fontSize: 13, fontWeight: '700' },
  groupCount: { fontSize: 11 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.sm,
    marginBottom: space.sm,
  },
  rowText: { flex: 1 },
  phrase: {
    fontFamily: 'Amiri_400Regular',
    fontSize: 19,
    lineHeight: 42,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  correct: { fontSize: 23 },
  heard: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: 'Amiri_400Regular',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  rowActions: { gap: space.sm, alignItems: 'center' },
});
