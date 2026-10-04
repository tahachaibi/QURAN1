/**
 * Mistakes review that actually teaches (spec §6.5).
 *
 * A bottom sheet, not a screen and not a modal that loses your place: the page
 * stays mounted behind it, so dismissing a mistake never costs you your
 * position. Grouped by ayah with a count per ayah.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ayahDisplayWords, ayahByGlobal, globalAyahOf, surahInfo, wordInAyahOf, words } from '../data/quran';
import { describeHint, explainMistake } from '../engine/mistakeExplain';
import { surahName } from '../i18n/names';
import { useT } from '../i18n/useT';
import type { Mistake } from '../engine/mistakes';
import { radius, space, type Palette } from '../theme/theme';

export interface MistakeSheetProps {
  visible: boolean;
  mistakes: readonly Mistake[];
  palette: Palette;
  onClose: () => void;
  onDismiss: (word: number) => void;
  /**
   * Take a dismissal back. "I said it right" is permanent and sits next to
   * "Show on page"; when this is given, the sheet offers Undo for a few seconds
   * after it, handing back the mistake so it can return to the list.
   */
  onUndismiss?: (mistake: Mistake) => void;
  onGoToWord: (word: number) => void;
  onPractise: (word: number) => void;
  onPlayWord: (word: number) => void;
  /**
   * A mistake the reader tapped on the page. Its card comes first, outlined,
   * so tapping a red dot answers "what did I do wrong here" without a hunt.
   */
  focusWord?: number | null;
}

/** How long Undo stays offered after "I said it right", ms. */
export const UNDO_DISMISS_MS = 6000;

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
  onUndismiss,
  onGoToWord,
  onPractise,
  onPlayWord,
  focusWord = null,
}: MistakeSheetProps) {
  const { t } = useT();
  const [undoable, setUndoable] = useState<Mistake | null>(null);
  const dismiss = useCallback(
    (word: number) => {
      const mistake = mistakes.find((m) => m.word === word);
      onDismiss(word);
      if (onUndismiss !== undefined && mistake !== undefined) setUndoable(mistake);
    },
    [mistakes, onDismiss, onUndismiss],
  );
  useEffect(() => {
    if (undoable === null) return undefined;
    const timer = setTimeout(() => setUndoable(null), UNDO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [undoable]);
  useEffect(() => {
    if (!visible) setUndoable(null);
  }, [visible]);
  const focused = focusWord === null ? undefined : mistakes.find((m) => m.word === focusWord);
  const groups = useMemo<AyahGroup[]>(() => {
    const byAyah = new Map<number, Mistake[]>();
    for (const m of mistakes) {
      if (m.word === focusWord) continue;
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
  }, [mistakes, focusWord]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: palette.overlay }]} onPress={onClose} accessibilityLabel={t('Close mistakes')} />
      <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.handleRow}>
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
        </View>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]}>
            {mistakes.length === 0 ? t('Nothing to review') : t('{n} to review', { n: mistakes.length })}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Close')}>
            <Ionicons name="close" size={20} color={palette.textMuted} />
          </Pressable>
        </View>

        {undoable !== null && onUndismiss !== undefined ? (
          <View style={[styles.undoBar, { backgroundColor: palette.accentSoft, borderColor: palette.border }]}>
            <Text style={[styles.undoText, { color: palette.text }]}>
              {t('«{word}» will not be checked again.', { word: words[undoable.word] ?? '' })}
            </Text>
            <Pressable
              onPress={() => {
                onUndismiss(undoable);
                setUndoable(null);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('Undo')}
              accessibilityHint={t('Checks this word again and puts the mistake back')}
            >
              <Text style={[styles.undoAction, { color: palette.primary }]}>{t('Undo')}</Text>
            </Pressable>
          </View>
        ) : null}

        {mistakes.length === 0 ? (
          <Text style={[styles.empty, { color: palette.textMuted }]}>
            {t('Your recitation matched the mushaf all the way through. Nothing here needs practice.')}
          </Text>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {focused !== undefined ? (
              <View style={styles.group}>
                <Text style={[styles.groupLabel, { color: palette.primary, marginBottom: space.xs }]}>{t('The word you tapped')}</Text>
                <MistakeRow
                  mistake={focused}
                  focused
                  palette={palette}
                  onDismiss={dismiss}
                  onGoToWord={onGoToWord}
                  onPractise={onPractise}
                  onPlayWord={onPlayWord}
                />
              </View>
            ) : null}
            {groups.map((group) => (
              <View key={group.globalAyah} style={styles.group}>
                <View style={styles.groupHeader}>
                  <Text style={[styles.groupLabel, { color: palette.primary }]}>{group.label}</Text>
                  <Text style={[styles.groupCount, { color: palette.textMuted }]}>
                    {group.items.length === 1 ? t('1 word') : t('{n} words', { n: group.items.length })}
                  </Text>
                </View>
                {group.items.map((mistake) => (
                  <MistakeRow
                    key={mistake.word}
                    mistake={mistake}
                    focused={false}
                    palette={palette}
                    onDismiss={dismiss}
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
  focused,
  palette,
  onDismiss,
  onGoToWord,
  onPractise,
  onPlayWord,
}: {
  mistake: Mistake;
  focused: boolean;
  palette: Palette;
  onDismiss: (word: number) => void;
  onGoToWord: (word: number) => void;
  onPractise: (word: number) => void;
  onPlayWord: (word: number) => void;
}) {
  const { t, lang } = useT();
  const ayah = ayahByGlobal(globalAyahOf(mistake.word));
  const display = ayahDisplayWords(ayah);
  const offset = wordInAyahOf(mistake.word);
  const correct = display[offset] ?? words[mistake.word];
  const explanation = explainMistake(words[mistake.word] ?? '', mistake.heardInstead);
  const skipped = explanation.kind === 'skipped';
  // What the reader sees is the recognizer's own spelling (فئران, هلؤمن); the
  // explanation is still worked out on the folded form, which is what the
  // matcher compared. Mistakes saved before heardRaw existed fall back.
  const said = mistake.heardRaw || explanation.heard;

  // Logical reading order: the words before, the word, the words after. The
  // renderer lays Arabic out right to left by itself. Putting "after" first,
  // as this used to, showed the ayah backwards around the word.
  const before = display.slice(Math.max(0, offset - 3), offset).join(' ');
  const after = display.slice(offset + 1, offset + 4).join(' ');
  const previous = offset > 0 ? display[offset - 1] : null;

  const badgeColour = skipped ? palette.accent : palette.error;
  const badgeBackground = skipped ? palette.accentSoft : palette.errorSoft;

  return (
    <Pressable
      onPress={() => onGoToWord(mistake.word)}
      onLongPress={() => onPractise(mistake.word)}
      accessibilityRole="button"
      accessibilityLabel={
        skipped
          ? t('Skipped word {word} in {ref}', { word: correct, ref: `${ayah.surah}:${ayah.ayah}` })
          : t('Said {heard} instead of {word} in {ref}', {
              heard: said,
              word: correct,
              ref: `${ayah.surah}:${ayah.ayah}`,
            })
      }
      accessibilityHint={t('Tap to jump to this word on the page, long press to practise this ayah')}
      style={[
        styles.row,
        { borderColor: focused ? palette.primary : palette.border, borderWidth: focused ? 2 : StyleSheet.hairlineWidth },
      ]}
    >
      <View style={styles.rowTop}>
        <View style={[styles.badge, { backgroundColor: badgeBackground, borderColor: badgeColour }]}>
          <Text style={[styles.badgeText, { color: badgeColour }]}>{skipped ? t('Skipped') : t('Wrong word')}</Text>
        </View>
        <Text style={[styles.where, { color: palette.textMuted }]}>
          {surahName(ayah.surah, lang)} {ayah.surah}:{ayah.ayah} · {t('word {n}', { n: offset + 1 })}
        </Text>
      </View>

      {skipped ? (
        <View style={styles.pair}>
          <Text style={[styles.pairLabel, { color: palette.textMuted }]}>{t('You skipped')}</Text>
          <Text style={[styles.correctWord, { color: palette.success }]}>{correct}</Text>
        </View>
      ) : (
        <>
          <View style={styles.pair}>
            <Text style={[styles.pairLabel, { color: palette.textMuted }]}>{t('You said')}</Text>
            <Text style={[styles.saidWord, { color: palette.error }]}>{said}</Text>
          </View>
          <View style={styles.pair}>
            <Text style={[styles.pairLabel, { color: palette.textMuted }]}>{t('Correct')}</Text>
            <Text style={[styles.correctWord, { color: palette.success }]}>{correct}</Text>
          </View>
        </>
      )}

      <Text style={[styles.explain, { color: palette.text }]}>
        {skipped
          ? previous !== null
            ? t('This word was not heard. It comes right after «{previous}».', { previous })
            : t('This word was not heard. It is the first word of the ayah.')
          : explanation.hint !== null
            ? describeHint(explanation.hint, t)
            : t('A different word was heard in its place.')}
      </Text>
      {explanation.likelyRecognizer ? (
        <Text style={[styles.note, { color: palette.textMuted }]}>
          {t(
            'The phone’s recognizer often confuses these sounds. If you are sure you said it right, tap “I said it right”.',
          )}
        </Text>
      ) : null}

      {/* the ayah around it, in reading order, with the word marked */}
      <Text style={[styles.phrase, { color: palette.textMuted }]} numberOfLines={2}>
        {before}
        {before ? ' ' : ''}
        <Text style={[styles.inPhrase, { color: palette.ink, backgroundColor: palette.accentSoft }]}>{correct}</Text>
        {after ? ' ' : ''}
        {after}
      </Text>

      <View style={styles.rowActions}>
        <Pressable
          onPress={() => onPlayWord(mistake.word)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t('Show this word on the page')}
          style={[styles.action, { borderColor: palette.border }]}
        >
          <Ionicons name="locate-outline" size={18} color={palette.primary} />
          <Text style={[styles.actionText, { color: palette.primary }]}>{t('Show on page')}</Text>
        </Pressable>
        <Pressable
          onPress={() => onDismiss(mistake.word)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t('I said it right')}
          accessibilityHint={t('Removes this permanently and never flags this word again')}
          style={[styles.action, { borderColor: palette.border }]}
        >
          <Ionicons name="checkmark-circle-outline" size={18} color={palette.success} />
          <Text style={[styles.actionText, { color: palette.success }]}>{t('I said it right')}</Text>
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
  undoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginHorizontal: space.md,
    marginBottom: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  undoText: { flex: 1, fontSize: 13, lineHeight: 19 },
  undoAction: { fontSize: 14, fontWeight: '700' },
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
    borderRadius: radius.md,
    padding: space.sm,
    marginBottom: space.sm,
    gap: space.xs,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  where: { fontSize: 12 },
  pair: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  pairLabel: { fontSize: 13, fontWeight: '600' },
  saidWord: {
    fontFamily: 'Amiri_400Regular',
    fontSize: 24,
    lineHeight: 44,
    textDecorationLine: 'line-through',
    writingDirection: 'rtl',
  },
  correctWord: { fontFamily: 'KFGQPC-Hafs', fontSize: 28, lineHeight: 52, writingDirection: 'rtl' },
  explain: { fontSize: 14, lineHeight: 20 },
  note: { fontSize: 12, lineHeight: 17, fontStyle: 'italic' },
  phrase: {
    fontFamily: 'KFGQPC-Hafs',
    fontSize: 18,
    lineHeight: 38,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  inPhrase: { fontSize: 20 },
  rowActions: { flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end', flexWrap: 'wrap' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
  },
  actionText: { fontSize: 13, fontWeight: '600' },
});
