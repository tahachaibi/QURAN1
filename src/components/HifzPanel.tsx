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
}

const QUEUE_LIMIT = 8;

export const HifzPanel = memo(function HifzPanel({
  deck,
  profile,
  palette,
  now,
  onPractise,
  onOpenAyah,
}: HifzPanelProps) {
  const summary = useMemo(() => summarize(deck, now), [deck, now]);
  const due = useMemo(() => dueQueue(deck, now, QUEUE_LIMIT), [deck, now]);
  const runs = useMemo(() => contiguousRuns(due), [due]);
  const patterns = useMemo(() => actionablePatterns(profile), [profile]);

  if (summary.tracked === 0) {
    return (
      <View style={styles.block}>
        <Text style={[styles.section, { color: palette.textMuted }]}>Revision</Text>
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.empty, { color: palette.textMuted }]}>
            Recite an ayah or two and this becomes your revision plan. Every session grades what you
            recited, and the ayahs you stumble on come back sooner than the ones you know cold.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <View style={styles.block}>
        <Text style={[styles.section, { color: palette.textMuted }]}>Revision</Text>
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.statRow}>
            <Metric label="Tracked" value={String(summary.tracked)} palette={palette} />
            <Metric label="Due now" value={String(summary.due)} palette={palette} accent={summary.due > 0} />
            <Metric label="Shaky" value={String(summary.weak)} palette={palette} />
            <Metric label="Solid" value={String(summary.solid)} palette={palette} />
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
            Average recall strength {Math.round(summary.averageStrength * 100)}% across{' '}
            {summary.tracked} {summary.tracked === 1 ? 'ayah' : 'ayahs'}
          </Text>

          {runs.length > 0 ? (
            <Pressable
              onPress={() => {
                const first = runs[0];
                onPractise(ayahStartWord[first.from], ayahStartWord[first.to + 1] - 1);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Revise ${due.length} due ayahs`}
              style={[styles.cta, { backgroundColor: palette.primary }]}
            >
              <Ionicons name="repeat" size={16} color={palette.paper} />
              <Text style={[styles.ctaLabel, { color: palette.paper }]}>
                Revise {due.length} due {due.length === 1 ? 'ayah' : 'ayahs'}
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.hint, { color: palette.success }]}>
              Nothing due. The next review comes back on its own.
            </Text>
          )}
        </View>
      </View>

      {due.length > 0 ? (
        <View style={styles.block}>
          <Text style={[styles.section, { color: palette.textMuted }]}>Weakest first</Text>
          {due.map((item) => {
            const ayah = ayahByGlobal(item.ayah);
            const surah = surahInfo(ayah.surah);
            return (
              <Pressable
                key={item.ayah}
                onPress={() => onOpenAyah(ayah.surah, ayah.ayah)}
                accessibilityRole="button"
                accessibilityLabel={`${surah.transliteration} ${ayah.surah}:${ayah.ayah}, strength ${Math.round(item.strength * 100)}%`}
                style={[styles.dueRow, { backgroundColor: palette.surface, borderColor: palette.border }]}
              >
                <View style={styles.dueMain}>
                  <Text style={[styles.dueTitle, { color: palette.text }]}>
                    {surah.transliteration} {ayah.surah}:{ayah.ayah}
                  </Text>
                  <Text style={[styles.dueMeta, { color: palette.textMuted }]}>
                    last graded {item.card.lastGrade}/5 · {describeOverdue(item.overdueDays)}
                    {item.card.lapses > 0 ? ` · ${item.card.lapses} lapses` : ''}
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
          <Text style={[styles.section, { color: palette.textMuted }]}>What keeps tripping you</Text>
          {patterns.slice(0, 4).map(({ pattern, advice }) => (
            <View
              key={pattern.id}
              style={[styles.patternRow, { backgroundColor: palette.surface, borderColor: palette.border }]}
            >
              <View style={styles.patternHead}>
                <Text style={[styles.patternGlyph, { color: palette.ink }]}>
                  {pattern.kind === 'substitution'
                    ? `${pattern.expected} → ${pattern.heard}`
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
                    {pattern.likelyRecognizer ? 'likely the recognizer' : 'worth checking'} ·{' '}
                    {pattern.count}×
                  </Text>
                </View>
              </View>
              <Text style={[styles.patternAdvice, { color: palette.textMuted }]}>{advice}</Text>
            </View>
          ))}
          {profile.recognizerShare > 0.6 ? (
            <Text style={[styles.hint, { color: palette.textMuted }]}>
              {Math.round(profile.recognizerShare * 100)}% of these are pairs Android&apos;s Arabic model
              routinely confuses, so most of this list is the recognizer rather than your recitation. Try a
              different locale in Settings before drilling any of it.
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

const describeOverdue = (days: number): string => {
  const d = Math.floor(days);
  if (d <= 0) return 'due today';
  if (d === 1) return '1 day overdue';
  return `${d} days overdue`;
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
  patternGlyph: { fontFamily: 'AmiriQuran_400Regular', fontSize: 22, writingDirection: 'rtl' },
  patternTag: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
  },
  patternTagText: { fontSize: 10, fontWeight: '600' },
  patternAdvice: { fontSize: 12, lineHeight: 18 },
});
