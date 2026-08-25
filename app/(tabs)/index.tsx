/**
 * Prayer tab (spec §8): today's times from device location, a countdown to the
 * next prayer, and tap-to-check-off. Offline shows the cached response with a
 * badge, never an error page.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
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
import { ADHAN_SOUND, hasAdhanSound } from '../../src/data/adhan';
import { rescheduleAll, requestPermission } from '../../src/data/notifications';
import { WARNING_MINUTES } from '../../src/data/prayerSchedule';
import { useAdhan } from '../../src/context/AdhanProvider';

export default function PrayerScreen() {
  const { palette, prefs, setPrefs } = useTheme();
  const { test: testAdhan } = useAdhan();
  const [scheduled, setScheduled] = useState<number | null>(null);
  const [notifyError, setNotifyError] = useState<string | null>(null);
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

  /**
   * Rebuild the schedule whenever the times or the switches change. Rescheduling
   * cancels everything first, so this is idempotent — running it again after a
   * refresh cannot pile up duplicate alarms.
   */
  useEffect(() => {
    if (day === null) return;
    if (!prefs.prayerWarning && !prefs.adhanNotification) {
      setScheduled(0);
      return;
    }
    void (async () => {
      const granted = await requestPermission();
      if (!granted) {
        setNotifyError(
          'Notifications are turned off for Quran Habit. Enable them in Settings > Apps > Quran Habit > Notifications.',
        );
        setScheduled(0);
        return;
      }
      setNotifyError(null);
      const count = await rescheduleAll(
        {
          timings: day.timings,
          warnBefore: prefs.prayerWarning,
          adhan: prefs.adhanNotification,
        },
        hasAdhanSound ? ADHAN_SOUND : null,
      );
      setScheduled(count);
    })();
  }, [day, prefs.adhanNotification, prefs.prayerWarning]);

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

      {day !== null ? (
        <View style={[styles.notifyCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Toggle
            label={`Remind me ${WARNING_MINUTES} minutes before`}
            hint="A plain reminder — never the adhan, which would be five minutes early."
            value={prefs.prayerWarning}
            onChange={(prayerWarning) => setPrefs({ prayerWarning })}
            palette={palette}
          />
          <Toggle
            label="Adhan at prayer time"
            hint={
              hasAdhanSound
                ? 'Played through the phone with a Stop button when the app is open, and as a notification when it is closed.'
                : 'No adhan recording is bundled in this build yet, so prayer time shows a notice without sound.'
            }
            value={prefs.adhanNotification}
            onChange={(adhanNotification) => setPrefs({ adhanNotification })}
            palette={palette}
          />
          {prefs.adhanNotification && hasAdhanSound ? (
            <Pressable
              onPress={() => testAdhan(next?.name ?? 'Fajr')}
              accessibilityRole="button"
              accessibilityLabel="Hear the adhan now"
              style={[styles.testButton, { borderColor: palette.primary }]}
            >
              <Ionicons name="volume-high" size={16} color={palette.primary} />
              <Text style={[styles.testText, { color: palette.primary }]}>Hear it now</Text>
            </Pressable>
          ) : null}
          {notifyError !== null ? (
            <Text style={[styles.notifyNote, { color: palette.error }]}>{notifyError}</Text>
          ) : scheduled !== null && scheduled > 0 ? (
            <Text style={[styles.notifyNote, { color: palette.textMuted }]}>
              {scheduled} reminders scheduled for the week ahead
            </Text>
          ) : null}
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

function Toggle({
  label,
  hint,
  value,
  onChange,
  palette,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  palette: ReturnType<typeof useTheme>['palette'];
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={[styles.toggleLabel, { color: palette.text }]}>{label}</Text>
        {hint === undefined ? null : (
          <Text style={[styles.notifyNote, { color: palette.textMuted }]}>{hint}</Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: palette.primaryLight, false: palette.border }}
        thumbColor={value ? palette.primary : palette.surface}
      />
    </View>
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
  notifyCard: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.sm,
  },
  notifyNote: { fontSize: 11, lineHeight: 16 },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.sm,
  },
  testText: { fontSize: 13, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  toggleText: { flex: 1 },
  toggleLabel: { fontSize: 14, fontWeight: '600' },
  rowTime: { fontSize: 16, fontVariant: ['tabular-nums'] },
});
