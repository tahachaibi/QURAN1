/**
 * Adhkar of the morning and the evening.
 *
 * Reached from the Hadith tab, because that is where the app keeps narrated text
 * rather than revealed text — and every du'a on this screen is a verbatim slice of
 * a hadith bundled in the app, with its collection and number shown so it can be
 * checked against a printed copy.
 *
 * Two typefaces on purpose: Qur'an passages are set in the mushaf face, du'as in
 * Amiri. Setting a narration in the Qur'an's typeface would dress it as
 * revelation, and this screen puts the two side by side.
 */
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { adhkarFor, defaultTime, type AdhkarTime, type Dhikr } from '../src/data/adhkar';
import { collectionById } from '../src/data/hadith';
import { useTheme } from '../src/theme/ThemeProvider';
import { radius, space } from '../src/theme/theme';

export default function AdhkarScreen() {
  const { palette, fontStep } = useTheme();
  const [time, setTime] = useState<AdhkarTime>(() => defaultTime());
  /** Repetitions done, per dhikr. Saying something a hundred times needs a tally. */
  const [counts, setCounts] = useState<Record<string, number>>({});

  const items = useMemo(() => adhkarFor(time), [time]);

  const switchTo = useCallback((next: AdhkarTime) => {
    setTime(next);
    setCounts({});
  }, []);

  const bump = useCallback((id: string, repeat: number) => {
    setCounts((prev) => {
      const done = prev[id] ?? 0;
      return { ...prev, [id]: done >= repeat ? 0 : done + 1 };
    });
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <View style={[styles.segment, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        {(['morning', 'evening'] as const).map((option) => {
          const active = time === option;
          return (
            <Pressable
              key={option}
              onPress={() => switchTo(option)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${option} adhkar`}
              style={[styles.segmentButton, active ? { backgroundColor: palette.primary } : null]}
            >
              <Ionicons
                name={option === 'morning' ? 'sunny-outline' : 'moon-outline'}
                size={15}
                color={active ? '#FFFFFF' : palette.textMuted}
              />
              <Text style={[styles.segmentText, { color: active ? '#FFFFFF' : palette.textMuted }]}>
                {option === 'morning' ? 'Morning' : 'Evening'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={items}
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => (
          <DhikrCard
            dhikr={item}
            done={counts[item.id] ?? 0}
            onCount={() => bump(item.id, item.repeat)}
            palette={palette}
            fontStep={fontStep}
          />
        )}
        contentContainerStyle={styles.list}
        initialNumToRender={5}
        ListFooterComponent={
          <Text style={[styles.footer, { color: palette.textMuted }]}>
            Every du'a here is quoted from Sahih al-Bukhari or Sahih Muslim, with its number, so you can
            check it. The Qur'an passages are cited by surah and ayah: the narrations that prescribe them
            for morning and evening are in Abu Dawud, at-Tirmidhi and an-Nasa'i, which this app does not
            include, so it does not claim a source it cannot show you. Familiar adhkar from those
            collections are missing for the same reason.
          </Text>
        }
      />
    </View>
  );
}

function DhikrCard({
  dhikr,
  done,
  onCount,
  palette,
  fontStep,
}: {
  dhikr: Dhikr;
  done: number;
  onCount: () => void;
  palette: ReturnType<typeof useTheme>['palette'];
  fontStep: number;
}) {
  const [openSource, setOpenSource] = useState(false);
  const quran = dhikr.source.kind === 'quran';
  const complete = done >= dhikr.repeat;

  const sourceLabel =
    dhikr.source.kind === 'quran'
      ? dhikr.source.reference
      : `${collectionById(dhikr.source.collection)?.englishTitle ?? 'Hadith'} ${dhikr.source.number}`;

  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: palette.text }]}>{dhikr.titleEn}</Text>
        <Pressable
          onPress={onCount}
          accessibilityRole="button"
          accessibilityLabel={
            dhikr.repeat === 1
              ? `Mark ${dhikr.titleEn} as said`
              : `Count a repetition of ${dhikr.titleEn}, ${done} of ${dhikr.repeat} done`
          }
          accessibilityHint="Tap to count; tapping again after the last one starts over"
          hitSlop={8}
          style={[
            styles.tally,
            {
              backgroundColor: complete ? palette.successSoft : palette.background,
              borderColor: complete ? palette.success : palette.border,
            },
          ]}
        >
          {complete ? (
            <Ionicons name="checkmark" size={14} color={palette.success} />
          ) : null}
          <Text style={[styles.tallyText, { color: complete ? palette.success : palette.textMuted }]}>
            {dhikr.repeat === 1 ? (complete ? 'said' : 'once') : `${done}/${dhikr.repeat}`}
          </Text>
        </Pressable>
      </View>

      {dhikr.lines.map((line, i) => (
        <Text
          key={i}
          style={[
            quran ? styles.quranLine : styles.duaLine,
            { color: palette.ink, fontSize: (quran ? 22 : 20) + fontStep },
            quran ? { lineHeight: (22 + fontStep) * 2 } : { lineHeight: (20 + fontStep) * 1.9 },
          ]}
        >
          {line}
        </Text>
      ))}

      {dhikr.note !== null ? (
        <Text style={[styles.note, { color: palette.textMuted }]}>{dhikr.note}</Text>
      ) : null}

      <Pressable
        onPress={() => setOpenSource((open) => !open)}
        accessibilityRole="button"
        accessibilityLabel={`Source: ${sourceLabel}`}
        accessibilityState={{ expanded: openSource }}
        style={styles.sourceRow}
        disabled={dhikr.source.kind !== 'hadith'}
      >
        <Text style={[styles.source, { color: palette.primary }]}>{sourceLabel}</Text>
        {dhikr.source.kind === 'hadith' ? (
          <Ionicons name={openSource ? 'chevron-up' : 'chevron-down'} size={15} color={palette.primary} />
        ) : null}
      </Pressable>

      {openSource && dhikr.source.kind === 'hadith' ? (
        <View style={[styles.full, { borderTopColor: palette.border }]}>
          <Text style={[styles.fullArabic, { color: palette.text }]}>{dhikr.source.arabic}</Text>
          {dhikr.source.narrator.length > 0 ? (
            <Text style={[styles.narrator, { color: palette.textMuted }]}>{dhikr.source.narrator}</Text>
          ) : null}
          <Text style={[styles.fullEnglish, { color: palette.text }]}>{dhikr.source.english}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  segment: {
    flexDirection: 'row',
    margin: space.md,
    marginBottom: space.sm,
    padding: 3,
    gap: 3,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  segmentText: { fontSize: 13, fontWeight: '700' },
  list: { paddingHorizontal: space.md, paddingBottom: space.xxl, gap: space.sm },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, fontSize: 14, fontWeight: '700' },
  tally: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    minWidth: 54,
    justifyContent: 'center',
  },
  tallyText: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  quranLine: { fontFamily: 'KFGQPC-Hafs', textAlign: 'right', writingDirection: 'rtl' },
  duaLine: { fontFamily: 'Amiri_400Regular', textAlign: 'right', writingDirection: 'rtl' },
  note: { fontSize: 11, lineHeight: 17 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  source: { fontSize: 12, fontWeight: '700' },
  full: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, gap: space.sm },
  fullArabic: { fontFamily: 'Amiri_400Regular', fontSize: 16, lineHeight: 32, textAlign: 'right', writingDirection: 'rtl' },
  narrator: { fontSize: 11, fontStyle: 'italic' },
  fullEnglish: { fontSize: 13, lineHeight: 20 },
  footer: { fontSize: 11, lineHeight: 17, marginTop: space.md },
});
