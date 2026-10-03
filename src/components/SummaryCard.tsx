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
import type { T } from '../i18n/i18n';
import { surahName } from '../i18n/names';
import { useT } from '../i18n/useT';

export interface SummaryCardProps {
  summary: SessionSummary | null;
  palette: Palette;
  onClose: () => void;
  onLog: () => void;
  onPractise: () => void;
  /** save this session's recogniser log so matching can be improved from it (§9) */
  onExport: () => void;
  /**
   * Add the page by hand when the recogniser produced nothing gradeable.
   *
   * A session can end with zero grades for reasons that have nothing to do with
   * the reciter — no Arabic speech pack, a noisy masjid, a recogniser that
   * returned a transcript nobody could align. Leaving the revision line simply
   * absent told them the app had decided their recitation did not count. It
   * did not decide that; it could not hear.
   */
  onAddByHand?: () => void;
}

export const SummaryCard = memo(function SummaryCard({
  summary,
  palette,
  onClose,
  onLog,
  onPractise,
  onExport,
  onAddByHand,
}: SummaryCardProps) {
  const { t, lang } = useT();
  if (summary === null) return null;
  const progressLine = describeProgress(summary, t);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: palette.overlay }]}>
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.eyebrow, { color: palette.textMuted }]}>{t('Session complete')}</Text>
          <Text style={[styles.surah, { color: palette.text }]}>{surahName(summary.surah, lang)}</Text>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.grid}>
            <Stat label={t('Words recited')} value={String(summary.wordsRecited)} palette={palette} />
            <Stat label={t('Verses covered')} value={String(summary.versesCovered)} palette={palette} />
            <Stat label={t('Accuracy')} value={`${Math.round(summary.accuracy * 100)}%`} palette={palette} />
            <Stat label={t('Longest clean run')} value={t('{n} words', { n: summary.longestCleanRun })} palette={palette} />
            <Stat label={t('Needed a hint')} value={String(summary.hintedWords.length)} palette={palette} />
            <Stat label={t('Time')} value={formatDuration(summary.durationMs)} palette={palette} />
          </ScrollView>

          <Text style={[styles.progress, { color: palette.primary }]}>{progressLine}</Text>

          {summary.graded.length > 0 ? (
            <Text style={[styles.hifz, { color: palette.textMuted }]}>
              {summary.graded.length === 1
                ? t('1 ayah graded for revision')
                : t('{n} ayahs graded for revision', { n: summary.graded.length })}
              {weakest(summary) === null
                ? ''
                : ` · ${t('weakest {ref} — it comes back tomorrow', { ref: weakest(summary) ?? '' })}`}
              {summary.dueNow > 0 ? ` · ${t('due now: {n}', { n: summary.dueNow })}` : ''}
            </Text>
          ) : onAddByHand !== undefined ? (
            <>
              <Text style={[styles.hifz, { color: palette.textMuted }]}>
                {t(
                  'Nothing was matched clearly enough to schedule for revision. That is the recogniser, not your recitation — if you did recite this, add it yourself. It goes in as read rather than verified.',
                )}
              </Text>
              <Pressable
                onPress={onAddByHand}
                accessibilityRole="button"
                accessibilityLabel={t('Add this page to my revision schedule by hand')}
                accessibilityHint={t('Schedules the ayahs on the page you are reading, without the microphone')}
              >
                <Text style={[styles.dismiss, { color: palette.primary }]}>{t('Add it to revision anyway')}</Text>
              </Pressable>
            </>
          ) : null}

          {summary.hintedWords.length > 0 ? (
            <Text style={[styles.hintList, { color: palette.textMuted }]} numberOfLines={2}>
              {t('Shaky: {list}', { list: summary.hintedWords.slice(0, 8).map(describeWord).join(' · ') })}
            </Text>
          ) : null}

          <View style={styles.actions}>
            {/* A session that was backgrounded part-way through has already
                reached the streak on its own, so the button says so rather than
                implying nothing was saved. Pressing it is still worth doing: it
                supersedes that partial row with the finished numbers. */}
            <Pressable
              onPress={onLog}
              accessibilityRole="button"
              accessibilityLabel={
                summary.autoLogged
                  ? t('Update the streak entry already saved for this session')
                  : t('Log this session to my streak')
              }
              style={[styles.primaryButton, { backgroundColor: palette.primary }]}
            >
              <Text style={[styles.primaryLabel, { color: palette.paper }]}>
                {summary.autoLogged ? t('Saved — update it') : t('Log to streak')}
              </Text>
            </Pressable>
            <Pressable
              onPress={onPractise}
              accessibilityRole="button"
              accessibilityLabel={t('Practise the weakest ayah from this session')}
              style={[styles.secondaryButton, { borderColor: palette.border }]}
            >
              <Text style={[styles.secondaryLabel, { color: palette.text }]}>
                {weakest(summary) === null
                  ? t('Practise shaky words')
                  : t('Practise {ref}', { ref: weakest(summary) ?? '' })}
              </Text>
            </Pressable>
            {/* The one thing that makes matching better is a real recording of a
                real session, and it was previously only reachable through a
                developer toggle. This is the moment it exists. */}
            <Pressable
              onPress={onExport}
              accessibilityRole="button"
              accessibilityLabel={t("Save this session's recitation log")}
              accessibilityHint={t('Writes a file you can send, used to improve follow-along accuracy')}
            >
              <Text style={[styles.dismiss, { color: palette.primary }]}>{t('Save recitation log')}</Text>
            </Pressable>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Dismiss summary')}>
              <Text style={[styles.dismiss, { color: palette.textMuted }]}>{t('Not now')}</Text>
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

/** The lowest-graded ayah of this session, as "surah:ayah". */
function weakest(summary: SessionSummary): string | null {
  if (summary.graded.length === 0) return null;
  let worst = summary.graded[0];
  for (const g of summary.graded) if (g.grade < worst.grade) worst = g;
  const ayah = ayahByGlobal(worst.ayah);
  return `${ayah.surah}:${ayah.ayah}`;
}

/** The global ayah index of the lowest-graded ayah, for the practise action. */
export function weakestAyahOf(summary: SessionSummary): number | null {
  if (summary.graded.length === 0) return null;
  let worst = summary.graded[0];
  for (const g of summary.graded) if (g.grade < worst.grade) worst = g;
  return worst.ayah;
}

function describeProgress(summary: SessionSummary, t: T): string {
  if (summary.previousFurthest === null) {
    return t('First time reciting this surah here — this is your baseline.');
  }
  const delta = summary.furthestWord - summary.previousFurthest;
  if (delta > 0) return t('You got {n} words further than last time in this surah.', { n: delta });
  if (delta === 0) return t('You reached exactly where you did last time in this surah.');
  return t('{n} words short of your best run in this surah.', { n: Math.abs(delta) });
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
  hifz: { marginTop: space.xs, fontSize: 12, lineHeight: 18 },
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
