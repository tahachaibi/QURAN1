/**
 * Prayer tab (spec §8): today's times from device location, a countdown to the
 * next prayer, and tap-to-check-off. Offline shows the cached response with a
 * badge, never an error page.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { OfflineBadge } from '../../src/components/controls';
import {
  fetchPrayerTimes,
  formatCountdown,
  nextPrayer,
  parseTime,
  PRAYERS,
  type PrayerDay,
} from '../../src/data/prayer';
import { loadPrayerChecks, today, togglePrayerCheck, type PrayerChecks } from '../../src/data/storage';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, space } from '../../src/theme/theme';

export default function PrayerScreen() {
  const { palette } = useTheme();
  const [day, setDay] = useState<PrayerDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<PrayerChecks>({});
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setDay(await fetchPrayerTimes());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    void loadPrayerChecks().then(setChecks);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const key = today();
  const done = checks[key] ?? [];
  const next = day === null ? null : nextPrayer(day.timings, new Date(now));

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
      {next !== null ? (
        <View style={[styles.hero, { backgroundColor: palette.primary }]}>
          <Text style={[styles.heroLabel, { color: palette.accentSoft }]}>
            {next.tomorrow ? 'Tomorrow' : 'Next'}
          </Text>
          <Text style={[styles.heroName, { color: '#FFFFFF' }]}>{next.name}</Text>
          <Text style={[styles.heroCountdown, { color: palette.accent }]}>
            in {formatCountdown(next.msAway)}
          </Text>
        </View>
      ) : null}

      {day?.fromCache === true && day.note !== null ? (
        <View style={styles.badgeRow}>
          <OfflineBadge palette={palette} label={day.note} />
        </View>
      ) : null}

      {error !== null ? (
        <View style={[styles.errorCard, { backgroundColor: palette.errorSoft, borderColor: palette.error }]}>
          <Text style={[styles.errorText, { color: palette.error }]}>{error}</Text>
          <Pressable onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Try again">
            <Text style={[styles.retry, { color: palette.primary }]}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {day !== null
        ? PRAYERS.map((prayer) => {
            const raw = day.timings[prayer] ?? '--:--';
            const at = parseTime(raw, new Date(now));
            const past = at.getTime() < now;
            const checked = done.includes(prayer);
            return (
              <Pressable
                key={prayer}
                onPress={() => void togglePrayerCheck(key, prayer).then(setChecks)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={`${prayer} at ${raw}`}
                accessibilityHint="Tap to mark as prayed"
                style={[
                  styles.row,
                  {
                    backgroundColor: checked ? palette.successSoft : palette.surface,
                    borderColor: checked ? palette.success : palette.border,
                  },
                ]}
              >
                <Ionicons
                  name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={checked ? palette.success : palette.textMuted}
                />
                <Text style={[styles.rowName, { color: past && !checked ? palette.textMuted : palette.text }]}>
                  {prayer}
                </Text>
                <Text style={[styles.rowTime, { color: palette.text }]}>{raw.trim().slice(0, 5)}</Text>
              </Pressable>
            );
          })
        : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.md, gap: space.sm },
  hero: { borderRadius: radius.lg, padding: space.lg },
  heroLabel: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  heroName: { fontSize: 30, fontWeight: '700', marginTop: 2 },
  heroCountdown: { fontSize: 16, fontWeight: '600', marginTop: space.xs },
  badgeRow: { marginTop: space.xs },
  errorCard: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: space.md, gap: space.sm },
  errorText: { fontSize: 13, lineHeight: 19 },
  retry: { fontSize: 13, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  rowName: { flex: 1, fontSize: 16, fontWeight: '600' },
  rowTime: { fontSize: 16, fontVariant: ['tabular-nums'] },
});
