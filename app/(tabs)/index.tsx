/**
 * Prayer tab (spec §8): today's times from device location, a countdown to the
 * next prayer, and the corrections needed to make both match the mosque you
 * follow. Offline shows the cached response with a badge, never an error page.
 *
 * The rows are read-only. They were check-offs feeding a prayer streak, and that
 * came out: the tracker is about the Qur'an, and a checkbox on a prayer invites
 * the app to keep score of someone's worship.
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
  PRAYER_ARABIC,
  type PrayerDay,
} from '../../src/data/prayer';
import { clampOffset, describeOffsets, hasOffsets, OFFSET_LIMIT } from '../../src/data/prayerOffsets';
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
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [tuning, setTuning] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      // No method is passed: it is decided from the country the phone is in.
      setDay(await fetchPrayerTimes({ offsets: prefs.prayerOffsets }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [prefs.prayerOffsets]);

  useEffect(() => {
    void load();
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
          {/**
            * Where the times come from, stated rather than chosen. Nobody thinks
            * "I follow an 18-degree Fajr angle"; they think "I am in Morocco, so I
            * follow وزارة الأوقاف والشؤون الإسلامية". The phone knows the first
            * half, so the app works out the second.
            */}
          <View style={styles.subRow}>
            <Ionicons
              name={day.resolved === null ? 'help-circle-outline' : 'location-outline'}
              size={15}
              color={day.resolved === null ? palette.error : palette.textMuted}
            />
            <Text style={[styles.sourceText, { color: palette.text }]}>
              {day.resolved === null
                ? 'Could not tell which country you are in, so these use a general calculation.'
                : day.source}
            </Text>
          </View>

          <Pressable
            onPress={() => setTuning((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel="Fine-tune each prayer time"
            accessibilityState={{ expanded: tuning }}
            style={styles.subRow}
          >
            <Ionicons name="options-outline" size={15} color={palette.textMuted} />
            <Text style={[styles.subLabel, { color: palette.text }]}>
              {hasOffsets(prefs.prayerOffsets)
                ? `Shifted by hand: ${describeOffsets(prefs.prayerOffsets)}`
                : 'A time here is wrong by a few minutes'}
            </Text>
            <Ionicons name={tuning ? 'chevron-up' : 'chevron-down'} size={15} color={palette.textMuted} />
          </Pressable>

          {tuning ? (
            <View style={styles.tuneBlock}>
              <Text style={[styles.notifyNote, { color: palette.textMuted }]}>
                Only use this if a time above does not match the mosque you follow. Each + adds one
                minute to that prayer and each − takes one away, permanently, and the countdown, the
                reminder and the adhan all move with it. If everything is right, leave it at 0.
              </Text>
              {PRAYERS.map((prayer) => {
                const value = clampOffset(prefs.prayerOffsets[prayer] ?? 0);
                const step = (delta: number) =>
                  setPrefs({
                    prayerOffsets: { ...prefs.prayerOffsets, [prayer]: clampOffset(value + delta) },
                  });
                return (
                  <View key={prayer} style={styles.tuneRow}>
                    <Text style={[styles.tuneName, { color: palette.text }]}>{prayer}</Text>
                    <Pressable
                      onPress={() => step(-1)}
                      disabled={value <= -OFFSET_LIMIT}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`One minute earlier for ${prayer}`}
                      style={[styles.stepper, { borderColor: palette.border }]}
                    >
                      <Ionicons name="remove" size={16} color={palette.text} />
                    </Pressable>
                    <Text style={[styles.tuneValue, { color: value === 0 ? palette.textMuted : palette.primary }]}>
                      {value === 0 ? '0' : `${value > 0 ? '+' : '−'}${Math.abs(value)}`}
                    </Text>
                    <Pressable
                      onPress={() => step(1)}
                      disabled={value >= OFFSET_LIMIT}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`One minute later for ${prayer}`}
                      style={[styles.stepper, { borderColor: palette.border }]}
                    >
                      <Ionicons name="add" size={16} color={palette.text} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
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
            const isNext = next !== null && !next.tomorrow && next.name === prayer;
            /**
             * Read-only, deliberately. These rows used to be check-offs feeding a
             * prayer streak; the tracker is about the Qur'an, and a checkbox on a
             * prayer invites the app to keep score of someone's worship. What the
             * row owes the reader is which prayer is next and what time it is.
             */
            return (
              <View
                key={prayer}
                accessible
                accessibilityLabel={`${prayer} at ${raw.trim().slice(0, 5)}${isNext ? ', next' : past ? ', passed' : ''}`}
                style={[
                  styles.row,
                  {
                    backgroundColor: isNext ? palette.successSoft : palette.surface,
                    borderColor: isNext ? palette.success : palette.border,
                  },
                ]}
              >
                <Ionicons
                  name={isNext ? 'arrow-forward-circle' : past ? 'checkmark-done-outline' : 'time-outline'}
                  size={20}
                  color={isNext ? palette.success : palette.textMuted}
                />
                <Text
                  style={[
                    styles.rowName,
                    { color: past && !isNext ? palette.textMuted : palette.text },
                  ]}
                >
                  {prayer}
                </Text>
                <Text style={[styles.rowArabic, { color: palette.textMuted }]}>
                  {PRAYER_ARABIC[prayer]}
                </Text>
                <Text style={[styles.rowTime, { color: palette.text }]}>{raw.trim().slice(0, 5)}</Text>
              </View>
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
  rowArabic: { fontSize: 15, fontFamily: 'Amiri_400Regular', writingDirection: 'rtl' },
  notifyCard: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.sm,
  },
  notifyNote: { fontSize: 11, lineHeight: 16 },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.sm,
  },
  subLabel: { flex: 1, fontSize: 13, fontWeight: '600' },
  sourceText: { flex: 1, fontSize: 12, lineHeight: 17 },
  tuneBlock: { gap: space.xs },
  tuneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tuneName: { flex: 1, fontSize: 13, fontWeight: '600' },
  stepper: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tuneValue: {
    minWidth: 34,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
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
