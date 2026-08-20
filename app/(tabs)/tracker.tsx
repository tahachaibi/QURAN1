/**
 * Tracker tab (spec §8): daily streak, a calendar heatmap, and the recitation
 * sessions that feed it automatically from the session summary (§6.6).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRouter } from 'expo-router';

import { ayahByGlobal, globalAyahOf, surahs } from '../../src/data/quran';
import {
  loadHifzDeck,
  loadMistakeLog,
  loadPrayerChecks,
  loadSessions,
  today,
  type LoggedSession,
} from '../../src/data/storage';
import { buildProfile, type ConfusionProfile } from '../../src/engine/confusion';
import type { HifzDeck } from '../../src/engine/hifz';
import { HifzPanel } from '../../src/components/HifzPanel';
import { useRecitation } from '../../src/context/RecitationProvider';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, space, type Palette } from '../../src/theme/theme';
import { formatDuration } from '../../src/components/controls';

const HEATMAP_WEEKS = 18;

export default function TrackerScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const { practiseRange } = useRecitation();
  const [sessions, setSessions] = useState<LoggedSession[]>([]);
  const [prayerDays, setPrayerDays] = useState<string[]>([]);
  const [deck, setDeck] = useState<HifzDeck>({});
  const [profile, setProfile] = useState<ConfusionProfile>(() => buildProfile([]));
  const [refreshing, setRefreshing] = useState(false);
  // A single timestamp for the whole render: due-ness and strength must not
  // shift between two components in the same pass.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setNow(Date.now());
    setSessions(await loadSessions());
    const checks = await loadPrayerChecks();
    setPrayerDays(Object.keys(checks).filter((day) => (checks[day] ?? []).length > 0));
    setDeck(await loadHifzDeck());
    setProfile(buildProfile(await loadMistakeLog()));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeDays = useMemo(() => {
    const set = new Set<string>(prayerDays);
    for (const s of sessions) set.add(s.day);
    return set;
  }, [prayerDays, sessions]);

  const streak = useMemo(() => currentStreak(activeDays), [activeDays]);
  const grid = useMemo(() => buildGrid(activeDays, sessions), [activeDays, sessions]);
  const recent = useMemo(() => [...sessions].reverse().slice(0, 12), [sessions]);
  const totals = useMemo(
    () =>
      sessions.reduce(
        (acc, s) => ({
          words: acc.words + s.wordsRecited,
          verses: acc.verses + s.versesCovered,
          ms: acc.ms + s.durationMs,
        }),
        { words: 0, verses: 0, ms: 0 },
      ),
    [sessions],
  );

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
          tintColor={palette.primary}
        />
      }
    >
      <View style={[styles.hero, { backgroundColor: palette.primary }]}>
        <Text style={[styles.heroLabel, { color: palette.accentSoft }]}>Current streak</Text>
        <Text style={styles.heroValue}>
          {streak} {streak === 1 ? 'day' : 'days'}
        </Text>
      </View>

      <View style={styles.statRow}>
        <Stat label="Words recited" value={String(totals.words)} palette={palette} />
        <Stat label="Verses" value={String(totals.verses)} palette={palette} />
        <Stat label="Time" value={formatDuration(totals.ms)} palette={palette} />
      </View>

      <HifzPanel
        deck={deck}
        profile={profile}
        palette={palette}
        now={now}
        onPractise={(from, to) => {
          practiseRange(from, to);
          const ayah = ayahByGlobal(globalAyahOf(from));
          router.push({
            pathname: '/surah/[id]',
            params: { id: String(ayah.surah), ayah: String(ayah.ayah) },
          });
        }}
        onOpenAyah={(surah, ayah) => {
          router.push({ pathname: '/surah/[id]', params: { id: String(surah), ayah: String(ayah) } });
        }}
      />

      <Text style={[styles.section, { color: palette.textMuted }]}>Last {HEATMAP_WEEKS} weeks</Text>
      <View style={styles.heatmap}>
        {grid.map((week, wi) => (
          <View key={wi} style={styles.week}>
            {week.map((cell) => (
              <View
                key={cell.day}
                accessible
                accessibilityLabel={`${cell.day}: ${cell.intensity === 0 ? 'nothing logged' : `${cell.words} words`}`}
                style={[
                  styles.cell,
                  {
                    backgroundColor:
                      cell.intensity === 0
                        ? palette.border
                        : cell.intensity === 1
                          ? palette.successSoft
                          : cell.intensity === 2
                            ? palette.primaryLight
                            : palette.primary,
                  },
                ]}
              />
            ))}
          </View>
        ))}
      </View>

      <Text style={[styles.section, { color: palette.textMuted }]}>Recent sessions</Text>
      {recent.length === 0 ? (
        <Text style={[styles.empty, { color: palette.textMuted }]}>
          Nothing logged yet. Finish a recitation and tap “Log to streak” on the summary card.
        </Text>
      ) : (
        recent.map((s) => (
          <View key={s.id} style={[styles.sessionRow, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.sessionMain}>
              <Text style={[styles.sessionTitle, { color: palette.text }]}>
                {surahs[s.surah - 1]?.transliteration ?? `Surah ${s.surah}`}
              </Text>
              <Text style={[styles.sessionMeta, { color: palette.textMuted }]}>
                {s.day} · {s.wordsRecited} words · {Math.round(s.accuracy * 100)}% · best run {s.longestCleanRun}
              </Text>
            </View>
            <Text style={[styles.sessionTime, { color: palette.textMuted }]}>{formatDuration(s.durationMs)}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function Stat({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return (
    <View style={[styles.stat, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.statValue, { color: palette.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: palette.textMuted }]}>{label}</Text>
    </View>
  );
}

function currentStreak(activeDays: ReadonlySet<string>): number {
  let streak = 0;
  const cursor = new Date();
  // a streak that has not been extended today is still alive until tomorrow
  if (!activeDays.has(today(cursor))) cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    if (!activeDays.has(today(cursor))) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

interface Cell {
  day: string;
  intensity: 0 | 1 | 2 | 3;
  words: number;
}

function buildGrid(activeDays: ReadonlySet<string>, sessions: readonly LoggedSession[]): Cell[][] {
  const wordsByDay = new Map<string, number>();
  for (const s of sessions) wordsByDay.set(s.day, (wordsByDay.get(s.day) ?? 0) + s.wordsRecited);

  const weeks: Cell[][] = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - (HEATMAP_WEEKS * 7 - 1));
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    const week: Cell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = today(cursor);
      const words = wordsByDay.get(day) ?? 0;
      const intensity: Cell['intensity'] = !activeDays.has(day)
        ? 0
        : words === 0
          ? 1
          : words < 60
            ? 2
            : 3;
      week.push({ day, intensity, words });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

const styles = StyleSheet.create({
  content: { padding: space.md, gap: space.sm },
  hero: { borderRadius: radius.lg, padding: space.lg },
  heroLabel: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  heroValue: { fontSize: 34, fontWeight: '700', color: '#FFFFFF', marginTop: 2 },
  statRow: { flexDirection: 'row', gap: space.sm },
  stat: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.sm,
  },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { fontSize: 10, marginTop: 2 },
  section: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginTop: space.md },
  heatmap: { flexDirection: 'row', gap: 3 },
  week: { gap: 3 },
  cell: { width: 12, height: 12, borderRadius: 3 },
  empty: { fontSize: 13, lineHeight: 20 },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.sm,
  },
  sessionMain: { flex: 1 },
  sessionTitle: { fontSize: 14, fontWeight: '600' },
  sessionMeta: { fontSize: 11, marginTop: 1 },
  sessionTime: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
