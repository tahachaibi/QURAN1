/**
 * Session summary (spec §6.6) — the card Tarteel does not have.
 *
 * One tap logs it to the tracker streak, one tap starts practising the shaky
 * words. The "further than last time" line is real: it compares against the
 * furthest word reached in this surah across all previous sessions.
 */
import { memo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ayahByGlobal, globalAyahOf, surahInfo } from '../data/quran';
import { radius, space, type Palette } from '../theme/theme';
import type { SessionSummary } from '../context/RecitationProvider';
import { formatDuration } from './controls';

export interface SummaryCardProps {
  summary: SessionSummary | null;
  palette: Palette;
  onClose: () => void;
  onLog: () => void;
  onPractise: () => void;
}

export const SummaryCard = memo(function SummaryCard({
  summary,
  palette,
  onClose,
  onLog,
  onPractise,
}: SummaryCardProps) {
  if (summary === null) return null;
  const surah = surahInfo(summary.surah);
  const progressLine = describeProgress(summary);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: palette.overlay }]}>
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.eyebrow, { color: palette.textMuted }]}>Session complete</Text>
          <Text style={[styles.surah, { color: palette.text }]}>{surah.transliteration}</Text>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.grid}>
            <Stat label="Words recited" value={String(summary.wordsRecited)} palette={palette} />
            <Stat label="Verses covered" value={String(summary.versesCovered)} palette={palette} />
            <Stat label="Accuracy" value={`${Math.round(summary.accuracy * 100)}%`} palette={palette} />
            <Stat label="Longest clean run" value={`${summary.longestCleanRun} words`} palette={palette} />
            <Stat label="Needed a hint" value={String(summary.hintedWords.length)} palette={palette} />
            <Stat label="Time" value={formatDuration(summary.durationMs)} palette={palette} />
          </ScrollView>

          <Text style={[styles.progress, { color: palette.primary }]}>{progressLine}</Text>

          {summary.hintedWords.length > 0 ? (
            <Text style={[styles.hintList, { color: palette.textMuted }]} numberOfLines={2}>
              Shaky: {summary.hintedWords.slice(0, 8).map(describeWord).join(' · ')}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              onPress={onLog}
              accessibilityRole="button"
              accessibilityLabel="Log this session to my streak"
              style={[styles.primaryButton, { backgroundColor: palette.primary }]}
            >
              <Text style={[styles.primaryLabel, { color: palette.paper }]}>Log to streak</Text>
            </Pressable>
            <Pressable
              onPress={onPractise}
              accessibilityRole="button"
              accessibilityLabel="Practise the shaky words"
              style={[styles.secondaryButton, { borderColor: palette.border }]}
            >
              <Text style={[styles.secondaryLabel, { color: palette.text }]}>Practise shaky words</Text>
            </Pressable>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss summary">
              <Text style={[styles.dismiss, { color: palette.textMuted }]}>Not now</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
});

function Stat({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return (
    <View style={[styles.stat, { borderColor: palette.border }]}>
      <Text style={[styles.statValue, { color: palette.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: palette.textMuted }]}>{label}</Text>
    </View>
  );
}

function describeWord(word: number): string {
  const ayah = ayahByGlobal(globalAyahOf(word));
  return `${ayah.surah}:${ayah.ayah}`;
}

function describeProgress(summary: SessionSummary): string {
  if (summary.previousFurthest === null) {
    return 'First time reciting this surah here — this is your baseline.';
  }
  const delta = summary.furthestWord - summary.previousFurthest;
  if (delta > 0) return `You got ${delta} words further than last time in this surah.`;
  if (delta === 0) return 'You reached exactly where you did last time in this surah.';
  return `${Math.abs(delta)} words short of your best run in this surah.`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.md },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '86%',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
  },
  eyebrow: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  surah: { fontSize: 24, fontWeight: '700', marginTop: 2 },
  scroll: { marginTop: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: {
    minWidth: 108,
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.sm,
  },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 11, marginTop: 2 },
  progress: { marginTop: space.md, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  hintList: { marginTop: space.xs, fontSize: 12 },
  actions: { marginTop: space.lg, gap: space.sm, alignItems: 'stretch' },
  primaryButton: { borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center' },
  primaryLabel: { fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 13,
    alignItems: 'center',
  },
  secondaryLabel: { fontSize: 15, fontWeight: '600' },
  dismiss: { textAlign: 'center', fontSize: 13, paddingVertical: space.sm },
});
