/**
 * What to revise today, and what you keep getting wrong.
 *
 * This is the part of the app Tarteel has no equivalent for. Tarteel can tell
 * you what you just recited; it does not watch which ayahs you are personally
 * weak on and decide what you should revise. Everything here is derived from
 * sessions the app already records — no extra work is asked of the reciter.
 */
import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ayahByGlobal, ayahStartWord, surahInfo } from '../data/quran';
import { actionablePatterns, type ConfusionProfile } from '../engine/confusion';
import type { T } from '../i18n/i18n';
import { surahName } from '../i18n/names';
import { useT } from '../i18n/useT';
import { contiguousRuns, dueQueue, summarize, type HifzDeck } from '../engine/hifz';
import { radius, space, type Palette } from '../theme/theme';

export interface HifzPanelProps {
  deck: HifzDeck;
  profile: ConfusionProfile;
  palette: Palette;
  now: number;
  /** start a practice run over a word range */
  onPractise: (fromWord: number, toWord: number) => void;
  onOpenAyah: (surah: number, ayah: number) => void;
  /**
   * The non-voice way to fill the deck, offered right here rather than only on
   * the mushaf.
   *
   * An empty deck used to be a paragraph of encouragement with nothing to press,
   * and the encouragement was wrong for most of the people reading it: anyone
   * whose phone has no Arabic speech pack, anyone reading silently, anyone who
   * will not recite aloud on a bus or in a masjid. "Recite an ayah or two" is
   * not advice they can take, so the panel now carries the other door too.
   *
   * Optional and nullable so the panel still renders in tests that do not care
   * about it. `hint` replaces the spoken description when the button does
   * something other than add the page — the tracker's way in for somebody who
   * has never recited, which can only take them to the mushaf.
   */
  selfReport?: { label: string; onPress: () => void; hint?: string } | null;
}

const QUEUE_LIMIT = 8;

export const HifzPanel = memo(function HifzPanel({
  deck,
  profile,
  palette,
  now,
  onPractise,
  onOpenAyah,
  selfReport,
}: HifzPanelProps) {
  const summary = useMemo(() => summarize(deck, now), [deck, now]);
  const due = useMemo(() => dueQueue(deck, now, QUEUE_LIMIT), [deck, now]);
  /**
   * The passage the revise button practises: the run holding the WEAKEST due
   * ayah, the one at the top of "Weakest first".
   *
   * It used to be `runs[0]`, and `contiguousRuns` sorts by position in the
   * mushaf, so the button drilled whichever due passage came first in the
   * Quran — while its label counted every due ayah. With 1:1, 2:255 and 67:1–5
   * due it said "Revise 7 due ayahs" and practised Al-Fatiha 1:1 alone.
   * A practice session is one passage, so the label now counts that passage.
   */
  const target = useMemo(() => {
    if (due.length === 0) return null;
    const runs = contiguousRuns(due);
    const weakest = due[0].ayah;
    return runs.find((r) => r.from <= weakest && weakest <= r.to) ?? runs[0];
  }, [due]);
  const targetSize = target === null ? 0 : target.to - target.from + 1;
  const { t, lang } = useT();
  const patterns = useMemo(() => actionablePatterns(profile, t), [profile, t]);

  if (summary.tracked === 0) {
    return (
      <View style={styles.block}>
        <Text style={[styles.section, { color: palette.textMuted }]}>{t('Revision')}</Text>
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.empty, { color: palette.textMuted }]}>
            {t(
              'Recite an ayah or two and this becomes your revision plan. Every session grades what you recited, and the ayahs you stumble on come back sooner than the ones you know cold.',
            )}
          </Text>
          <Text style={[styles.empty, { color: palette.textMuted }]}>
            {t(
              'You do not have to recite out loud to use it. If you read silently, or you are somewhere you would rather not speak into a phone, or your phone has no Arabic speech pack, tell it what you read and the same schedule starts. It is marked as read rather than verified, and only recitation ever changes that.',
            )}
          </Text>
          {selfReport !== undefined && selfReport !== null ? (
            <Pressable
              onPress={selfReport.onPress}
              accessibilityRole="button"
              accessibilityLabel={selfReport.label}
              accessibilityHint={
                selfReport.hint ?? t('Adds those ayahs to your revision schedule as read, without using the microphone')
              }
              style={[styles.cta, { backgroundColor: palette.primary }]}
            >
              <Ionicons name="book-outline" size={16} color={palette.paper} />
              <Text style={[styles.ctaLabel, { color: palette.paper }]}>{selfReport.label}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <>
      <View style={styles.block}>
        <Text style={[styles.section, { color: palette.textMuted }]}>{t('Revision')}</Text>
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.statRow}>
            <Metric label={t('Tracked')} value={String(summary.tracked)} palette={palette} />
            <Metric label={t('Due now')} value={String(summary.due)} palette={palette} accent={summary.due > 0} />
            <Metric label={t('Shaky')} value={String(summary.weak)} palette={palette} />
            <Metric label={t('Solid')} value={String(summary.solid)} palette={palette} />
          </View>

          <View style={[styles.strengthTrack, { backgroundColor: palette.border }]}>
            <View
              style={[
                styles.strengthFill,
                {
                  backgroundColor: palette.primary,
                  width: `${Math.round(summary.averageStrength * 100)}%`,
                },
              ]}
            />
          </View>
          <Text style={[styles.hint, { color: palette.textMuted }]}>
            {summary.tracked === 1
              ? t('Average recall strength {pct}% across 1 ayah', { pct: Math.round(summary.averageStrength * 100) })
              : t('Average recall strength {pct}% across {n} ayahs', {
                  pct: Math.round(summary.averageStrength * 100),
                  n: summary.tracked,
                })}
          </Text>

          {target !== null ? (
            <Pressable
              onPress={() => onPractise(ayahStartWord[target.from], ayahStartWord[target.to + 1] - 1)}
              accessibilityRole="button"
              accessibilityLabel={targetSize === 1 ? t('Revise 1 due ayah') : t('Revise {n} due ayahs', { n: targetSize })}
              style={[styles.cta, { backgroundColor: palette.primary }]}
            >
              <Ionicons name="repeat" size={16} color={palette.paper} />
              <Text style={[styles.ctaLabel, { color: palette.paper }]}>
                {targetSize === 1 ? t('Revise 1 due ayah') : t('Revise {n} due ayahs', { n: targetSize })}
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.hint, { color: palette.success }]}>
              {t('Nothing due. The next review comes back on its own.')}
            </Text>
          )}

          {selfReport !== undefined && selfReport !== null ? (
            <Pressable
              onPress={selfReport.onPress}
              accessibilityRole="button"
              accessibilityLabel={selfReport.label}
              accessibilityHint={
                selfReport.hint ?? t('Adds those ayahs to your revision schedule as read, without using the microphone')
              }
              style={[styles.secondaryCta, { borderColor: palette.border }]}
            >
              <Ionicons name="book-outline" size={15} color={palette.primary} />
              <Text style={[styles.secondaryLabel, { color: palette.primary }]}>{selfReport.label}</Text>
            </Pressable>
          ) : null}

          {/* Said out loud rather than quietly folded in, because the whole
              worth of this schedule is that it reports what happened. */}
          {summary.verified < summary.tracked ? (
            <Text style={[styles.hint, { color: palette.textMuted }]}>
              {t(
                '{n} of these you added by hand. They are scheduled the same way, but nothing has heard them — recite one and it counts as verified.',
                { n: summary.tracked - summary.verified },
              )}
            </Text>
          ) : null}
        </View>
      </View>

      {due.length > 0 ? (
        <View style={styles.block}>
          <Text style={[styles.section, { color: palette.textMuted }]}>{t('Weakest first')}</Text>
          {due.map((item) => {
            const ayah = ayahByGlobal(item.ayah);
            const surah = surahInfo(ayah.surah);
            return (
              <Pressable
                key={item.ayah}
                onPress={() => onOpenAyah(ayah.surah, ayah.ayah)}
                accessibilityRole="button"
                accessibilityLabel={t('{name} {ref}, strength {pct}%', {
                  name: surahName(ayah.surah, lang),
                  ref: `${ayah.surah}:${ayah.ayah}`,
                  pct: Math.round(item.strength * 100),
                })}
                style={[styles.dueRow, { backgroundColor: palette.surface, borderColor: palette.border }]}
              >
                <View style={styles.dueMain}>
                  <Text style={[styles.dueTitle, { color: palette.text }]}>
                    {surahName(ayah.surah, lang)} {ayah.surah}:{ayah.ayah}
                  </Text>
                  <Text style={[styles.dueMeta, { color: palette.textMuted }]}>
                    {t('last graded {grade}/5', { grade: item.card.lastGrade })} · {describeOverdue(item.overdueDays, t)}
                    {item.card.lapses > 0 ? ` · ${t('lapses: {n}', { n: item.card.lapses })}` : ''}
                  </Text>
                </View>
                <View style={[styles.strengthPip, { backgroundColor: pipColour(item.strength, palette) }]} />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {patterns.length > 0 ? (
        <View style={styles.block}>
          <Text style={[styles.section, { color: palette.textMuted }]}>{t('What keeps tripping you')}</Text>
          {patterns.slice(0, 4).map(({ pattern, advice }) => (
            <View
              key={pattern.id}
              style={[styles.patternRow, { backgroundColor: palette.surface, borderColor: palette.border }]}
            >
              <View style={styles.patternHead}>
                {/* A LEFTWARDS arrow, on purpose. Both letters are Arabic, so
                    the whole line, arrow included, is laid out right to left:
                    the expected letter lands on the right and the heard one on
                    the left. "→" is not a mirrored character, so it used to
                    point from the heard letter back at the expected one, the
                    opposite of the advice beneath it. "←" points from the
                    expected letter to what was heard. */}
                <Text style={[styles.patternGlyph, { color: palette.ink }]}>
                  {pattern.kind === 'substitution'
                    ? `${pattern.expected} ← ${pattern.heard}`
                    : pattern.expected}
                </Text>
                <View
                  style={[
                    styles.patternTag,
                    {
                      backgroundColor: pattern.likelyRecognizer ? palette.accentSoft : palette.errorSoft,
                      borderColor: pattern.likelyRecognizer ? palette.accent : palette.error,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.patternTagText,
                      { color: pattern.likelyRecognizer ? palette.primary : palette.error },
                    ]}
                  >
                    {pattern.likelyRecognizer ? t('likely the recognizer') : t('worth checking')} ·{' '}
                    {pattern.count}×
                  </Text>
                </View>
              </View>
              <Text style={[styles.patternAdvice, { color: palette.textMuted }]}>{advice}</Text>
            </View>
          ))}
          {profile.recognizerShare > 0.6 ? (
            <Text style={[styles.hint, { color: palette.textMuted }]}>
              {t(
                "{pct}% of these are pairs Android's Arabic model routinely confuses, so most of this list is the recognizer rather than your recitation. Try a different locale in Settings before drilling any of it.",
                { pct: Math.round(profile.recognizerShare * 100) },
              )}
            </Text>
          ) : null}
        </View>
      ) : null}
    </>
  );
});

function Metric({
  label,
  value,
  palette,
  accent,
}: {
  label: string;
  value: string;
  palette: Palette;
  accent?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color: accent === true ? palette.accent : palette.text }]}>
        {value}
      </Text>
      <Text style={[styles.metricLabel, { color: palette.textMuted }]}>{label}</Text>
    </View>
  );
}

const describeOverdue = (days: number, t: T): string => {
  const d = Math.floor(days);
  if (d <= 0) return t('due today');
  if (d === 1) return t('1 day overdue');
  return t('{n} days overdue', { n: d });
};

const pipColour = (strength: number, palette: Palette): string =>
  strength < 0.4 ? palette.error : strength < 0.7 ? palette.accent : palette.success;

const styles = StyleSheet.create({
  block: { gap: space.xs, marginTop: space.md },
  section: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.sm,
  },
  empty: { fontSize: 13, lineHeight: 20 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metric: { alignItems: 'flex-start' },
  metricValue: { fontSize: 20, fontWeight: '700' },
  metricLabel: { fontSize: 10, marginTop: 1 },
  strengthTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  strengthFill: { height: 6, borderRadius: 3 },
  hint: { fontSize: 12, lineHeight: 18 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    paddingVertical: 12,
  },
  ctaLabel: { fontSize: 14, fontWeight: '700' },
  secondaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 11,
  },
  secondaryLabel: { fontSize: 13, fontWeight: '600' },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  dueMain: { flex: 1 },
  dueTitle: { fontSize: 14, fontWeight: '600' },
  dueMeta: { fontSize: 11, marginTop: 1 },
  strengthPip: { width: 8, height: 8, borderRadius: 4 },
  patternRow: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.xs,
  },
  patternHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  patternGlyph: { fontFamily: 'KFGQPC-Hafs', fontSize: 22, writingDirection: 'rtl' },
  patternTag: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
  },
  patternTagText: { fontSize: 10, fontWeight: '600' },
  patternAdvice: { fontSize: 12, lineHeight: 18 },
});
