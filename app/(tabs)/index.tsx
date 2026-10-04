/**
 * Prayer tab (spec §8): today's times from device location, a countdown to the
 * next prayer, and the corrections needed to make both match the mosque you
 * follow. Offline shows the cached response with a badge, never an error page.
 *
 * The rows are read-only. They were check-offs feeding a prayer streak, and that
 * came out: the tracker is about the Qur'an, and a checkbox on a prayer invites
 * the app to keep score of someone's worship.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { OfflineBadge } from '../../src/components/controls';
import {
  fetchPrayerTimes,
  formatCountdown,
  nextPrayer,
  parseTime,
  PRAYERS,
  PRAYER_ARABIC,
  problemOf,
  type PrayerDay,
  type PrayerTimesProblem,
} from '../../src/data/prayer';
import {
  adjustTimings,
  clampOffset,
  describeOffsets,
  hasOffsets,
  OFFSET_LIMIT,
} from '../../src/data/prayerOffsets';
import { today } from '../../src/data/storage';
import { adhanName, prayerName } from '../../src/i18n/names';
import { useT } from '../../src/i18n/useT';
import { selectedAdhan } from '../../src/data/adhanLibrary';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, space } from '../../src/theme/theme';
import { WARNING_MINUTES } from '../../src/data/prayerSchedule';
import { useAdhan } from '../../src/context/AdhanProvider';

export default function PrayerScreen() {
  const { palette, prefs, setPrefs } = useTheme();
  const { t, lang, arabic } = useT();
  const router = useRouter();
  /**
   * Read, not owned. Scheduling moved to AdhanProvider, which is mounted above
   * the router — this screen used to be the ONLY caller of rescheduleAll, and
   * the app does not open here, so a user who never pressed Prayer had no call
   * to prayer scheduled and nothing telling them so.
   */
  const { scheduleError, refresh } = useAdhan();
  const [day, setDay] = useState<PrayerDay | null>(null);
  const [error, setError] = useState<{ text: string; problem: PrayerTimesProblem | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [locating, setLocating] = useState(false);
  /** Each load's number, so a slow answer cannot overwrite a newer one. */
  const latestLoad = useRef(0);

  const load = useCallback(
    async (freshLocation = false) => {
      const mine = ++latestLoad.current;
      try {
        setError(null);
        // No method is passed: it is decided from the country the phone is in.
        // No offsets either: the times are kept as the API gave them and the
        // reader's corrections are applied as the screen draws, so a tap on a
        // +/− costs no location fix and no request — and an older answer
        // arriving late cannot put back the minute before the tap.
        const fetched = await fetchPrayerTimes({ freshLocation, t, lang });
        if (mine === latestLoad.current) setDay(fetched);
      } catch (e) {
        if (mine === latestLoad.current) {
          setError({ text: e instanceof Error ? e.message : String(e), problem: problemOf(e) });
        }
      } finally {
        // Tell the adhan to read the saved times again, whatever happened here:
        // the first times ever fetched, a new city's, or nothing new at all —
        // which still re-checks the notification permission behind "Check again".
        await refresh();
      }
    },
    [t, lang, refresh],
  );

  /**
   * Load on arrival, and again whenever the calendar day changes.
   *
   * The tab stays mounted once visited, and it used to load exactly once: a
   * phone left overnight showed yesterday's times as today's the next morning,
   * with no badge, and the cache behind the adhan was never refreshed. `now`
   * ticks every second while the app is open, so the day changes under it at
   * midnight, and within a second of coming back to the app.
   */
  const dayKey = today(new Date(now));
  useEffect(() => {
    void load();
  }, [load, dayKey]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const timings = useMemo(
    () => (day === null ? null : adjustTimings(day.timings, prefs.prayerOffsets)),
    [day, prefs.prayerOffsets],
  );
  const next = timings === null ? null : nextPrayer(timings, new Date(now));
  const selected = selectedAdhan(prefs.addedAdhans, prefs.adhanSelectedId);

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
      {/* A location fix, a reverse geocode and the requests take a few seconds
          even on a good day, and the screen used to be empty all that time —
          indistinguishable from broken. */}
      {day === null && error === null ? (
        <ActivityIndicator
          style={styles.loading}
          color={palette.primary}
          accessibilityLabel={t('Loading prayer times')}
        />
      ) : null}

      {next !== null ? (
        <View style={[styles.hero, { backgroundColor: palette.primary }]}>
          <Text style={[styles.heroLabel, { color: palette.accentSoft }]}>
            {next.tomorrow ? t('Tomorrow') : t('Next')}
          </Text>
          <Text style={[styles.heroName, { color: '#FFFFFF' }]}>{prayerName(next.name, lang)}</Text>
          <Text style={[styles.heroCountdown, { color: palette.accent }]}>
            {t('in {time}', { time: formatCountdown(next.msAway, lang) })}
          </Text>
        </View>
      ) : null}

      {/* Any note, not only an offline one: fresh times for the place saved
          last time, when there is no location fix, say so too. */}
      {day !== null && day.note !== null ? (
        <View style={styles.badgeRow}>
          <OfflineBadge palette={palette} label={day.note} />
        </View>
      ) : null}

      {error !== null ? (
        <View style={[styles.errorCard, { backgroundColor: palette.errorSoft, borderColor: palette.error }]}>
          <Text style={[styles.errorText, { color: palette.error }]}>{error.text}</Text>
          <View style={styles.errorActions}>
            <Pressable onPress={() => void load()} accessibilityRole="button" accessibilityLabel={t('Try again')}>
              <Text style={[styles.retry, { color: palette.primary }]}>{t('Try again')}</Text>
            </Pressable>
            {/* Only for a refusal: it is the one problem the app's own settings
                page fixes. Location switched off is fixed by "Try again", which
                brings back the system's own "turn on location" dialog. */}
            {error.problem === 'permission' ? (
              <Pressable
                onPress={() => void Linking.openSettings()}
                accessibilityRole="button"
                accessibilityLabel={t("Open this app's system settings")}
              >
                <Text style={[styles.retry, { color: palette.primary }]}>{t('Open settings')}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {day !== null && timings !== null
        ? PRAYERS.map((prayer) => {
            const raw = timings[prayer] ?? '--:--';
            const time = raw.trim().slice(0, 5);
            const name = prayerName(prayer, lang);
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
                // NOT `accessible`: the row now contains a button, and collapsing
                // it into one node would make the bell unreachable by screen
                // reader. The texts inside carry their own labels.
                //
                // Three whole sentences rather than pieces glued together, so
                // each language can order and agree its own words. This was a
                // bare English template, read to Arabic TalkBack users as
                // "Fajr at 05:12, next" — the only English in the row.
                accessibilityLabel={
                  isNext
                    ? t('{prayer} at {time}, next', { prayer: name, time })
                    : past
                      ? t('{prayer} at {time}, passed', { prayer: name, time })
                      : t('{prayer} at {time}', { prayer: name, time })
                }
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
                  {name}
                </Text>
                {/* the Arabic name beside the English is for English readers;
                    in Arabic it would just say the same word twice */}
                {arabic ? null : (
                  <Text style={[styles.rowArabic, { color: palette.textMuted }]}>{PRAYER_ARABIC[prayer]}</Text>
                )}
                <Text style={[styles.rowTime, { color: palette.text }]}>{time}</Text>

                {/**
                  * The bell decides whether this prayer is HEARD, not whether it
                  * is announced: with it off the banner and the notification still
                  * appear, silently. Placed at the end of the row so the eye reads
                  * name, then time, then the one thing that is a control.
                  */}
                <Pressable
                  onPress={() =>
                    setPrefs({
                      bells: { ...prefs.bells, [prayer]: prefs.bells[prayer] === false },
                    })
                  }
                  hitSlop={10}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: prefs.bells[prayer] !== false }}
                  accessibilityLabel={t('Adhan sound for {prayer}', { prayer: name })}
                  accessibilityHint={
                    prefs.bells[prayer] === false
                      ? t('Currently silent. Tap to hear the adhan at this prayer.')
                      : t('Currently sounds the adhan. Tap to make it silent.')
                  }
                  style={styles.bell}
                >
                  <Ionicons
                    name={prefs.bells[prayer] === false ? 'notifications-off-outline' : 'notifications'}
                    size={20}
                    color={prefs.bells[prayer] === false ? palette.textMuted : palette.accent}
                  />
                </Pressable>
              </View>
            );
          })
        : null}

      {/* The times first, then everything that configures them. Somebody opening
          this tab wants to know when the next prayer is, and settings stacked above
          the answer push the answer off the screen. */}
      {day !== null ? (
        <View style={[styles.notifyCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Toggle
            label={t('Remind me {n} minutes before', { n: WARNING_MINUTES })}
            hint={t('A plain reminder — never the adhan, which would be five minutes early.')}
            value={prefs.prayerWarning}
            onChange={(prayerWarning) => setPrefs({ prayerWarning })}
            palette={palette}
          />
          {/**
            * A door, not a drawer. The list of recordings with a play button each
            * belongs on its own screen: opening it here pushed the prayer times
            * off the display, and the times are what this tab is for.
            */}
          <Pressable
            onPress={() => router.push('/adhan')}
            accessibilityRole="button"
            accessibilityLabel={t('Change adhan, currently {name}', { name: selected ? adhanName(selected, t, lang) : t('none') })}
            style={styles.subRow}
          >
            <Ionicons name="musical-notes-outline" size={15} color={palette.textMuted} />
            <View style={styles.toggleText}>
              <Text style={[styles.subLabel, { color: palette.text }]}>{t('Change adhan')}</Text>
              <Text style={[styles.notifyNote, { color: palette.textMuted }]}>
                {selected ? adhanName(selected, t, lang) : t('none available')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
          </Pressable>

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
              {day.resolved === null ? (day.authorityNote ?? day.source) : day.source}
            </Text>
            {/**
              * Refresh takes a NEW position reading rather than the last known
              * one. The last known fix is normally right and costs nothing, but it
              * can be a city old — and a button that answered with the same stale
              * place would look broken to the one person who needs it: somebody
              * who has just travelled.
              */}
            <Pressable
              onPress={() => {
                setLocating(true);
                void load(true).finally(() => setLocating(false));
              }}
              disabled={locating}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Refresh my location')}
              accessibilityState={{ busy: locating }}
              style={styles.refresh}
            >
              {locating ? (
                <ActivityIndicator size="small" color={palette.primary} />
              ) : (
                <Ionicons name="refresh" size={18} color={palette.primary} />
              )}
            </Pressable>
          </View>

          {/* The correction still applies — it is what makes these times match the
              ministry's published table — but it no longer announces itself. The
              screen shows the time; how it got there is not the reader's problem. */}

          <Pressable
            onPress={() => setTuning((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel={t('Fine-tune each prayer time')}
            accessibilityState={{ expanded: tuning }}
            style={styles.subRow}
          >
            <Ionicons name="options-outline" size={15} color={palette.textMuted} />
            <Text style={[styles.subLabel, { color: palette.text }]}>
              {hasOffsets(prefs.prayerOffsets)
                ? t('Shifted by hand: {list}', {
                    list: describeOffsets(prefs.prayerOffsets, (p) => prayerName(p, lang), arabic ? '، ' : ', '),
                  })
                : t('A time here is wrong by a few minutes')}
            </Text>
            <Ionicons name={tuning ? 'chevron-up' : 'chevron-down'} size={15} color={palette.textMuted} />
          </Pressable>

          {tuning ? (
            <View style={styles.tuneBlock}>
              <Text style={[styles.notifyNote, { color: palette.textMuted }]}>
                {t(
                  'Only use this if a time above does not match the mosque you follow. Each + adds one minute to that prayer and each − takes one away, permanently, and the countdown, the reminder and the adhan all move with it. If everything is right, leave it at 0.',
                )}
              </Text>
              {PRAYERS.map((prayer) => {
                const value = clampOffset(prefs.prayerOffsets[prayer] ?? 0);
                const step = (delta: number) =>
                  setPrefs({
                    prayerOffsets: { ...prefs.prayerOffsets, [prayer]: clampOffset(value + delta) },
                  });
                return (
                  <View key={prayer} style={styles.tuneRow}>
                    <Text style={[styles.tuneName, { color: palette.text }]}>{prayerName(prayer, lang)}</Text>
                    <Pressable
                      onPress={() => step(-1)}
                      disabled={value <= -OFFSET_LIMIT}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={t('One minute earlier for {prayer}', { prayer: prayerName(prayer, lang) })}
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
                      accessibilityLabel={t('One minute later for {prayer}', { prayer: prayerName(prayer, lang) })}
                      style={[styles.stepper, { borderColor: palette.border }]}
                    >
                      <Ionicons name="add" size={16} color={palette.text} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}

          {scheduleError?.kind === 'permission' ? (
            <View style={styles.notifyProblem}>
              <Text style={[styles.notifyNote, { color: palette.error }]}>{scheduleError.text}</Text>
              {/**
                * A button, not directions. Android stops showing the permission
                * dialog once it has been refused twice, so asking again does
                * nothing and "go to Settings > Apps > Tasmee Hifz >
                * Notifications" is four taps of someone else's navigation. This
                * opens the app's own settings page directly.
                */}
              <View style={styles.buttonRow}>
                <Pressable
                  onPress={() => void Linking.openSettings()}
                  accessibilityRole="button"
                  accessibilityLabel={t("Open this app's system settings")}
                  style={[styles.testButton, { borderColor: palette.error, flex: 1 }]}
                >
                  <Ionicons name="settings-outline" size={16} color={palette.error} />
                  <Text style={[styles.testText, { color: palette.error }]}>{t('Open settings')}</Text>
                </Pressable>
                {/* The adhan's own check, not this screen's: re-reading the
                    times here never asked about notifications at all. */}
                <Pressable
                  onPress={() => void refresh()}
                  accessibilityRole="button"
                  accessibilityLabel={t('Check again for notification permission')}
                  style={[styles.testButton, { borderColor: palette.primary, flex: 1 }]}
                >
                  <Ionicons name="refresh" size={16} color={palette.primary} />
                  <Text style={[styles.testText, { color: palette.primary }]}>{t('Check again')}</Text>
                </Pressable>
              </View>
              <Text style={[styles.notifyNote, { color: palette.textMuted }]}>
                {t(
                  'Without this, the reminder and the closed-app notification cannot fire. The adhan still plays while the app is open — that part needs no permission.',
                )}
              </Text>
            </View>
          ) : null}

          {/* The saved times have run out. Nothing about permission: settings
              are not where this is fixed, fetching is. */}
          {scheduleError?.kind === 'stale' ? (
            <View style={styles.notifyProblem}>
              <Text style={[styles.notifyNote, { color: palette.error }]}>{scheduleError.text}</Text>
              <Pressable
                onPress={() => void load()}
                accessibilityRole="button"
                accessibilityLabel={t('Refresh prayer times')}
                style={[styles.testButton, { borderColor: palette.primary }]}
              >
                <Ionicons name="refresh" size={16} color={palette.primary} />
                <Text style={[styles.testText, { color: palette.primary }]}>{t('Refresh prayer times')}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
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
  loading: { marginTop: space.xl },
  hero: { borderRadius: radius.lg, padding: space.lg },
  heroLabel: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  heroName: { fontSize: 30, fontWeight: '700', marginTop: 2 },
  heroCountdown: { fontSize: 16, fontWeight: '600', marginTop: space.xs },
  badgeRow: { marginTop: space.xs },
  errorCard: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: space.md, gap: space.sm },
  errorText: { fontSize: 13, lineHeight: 19 },
  errorActions: { flexDirection: 'row', gap: space.lg },
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
  bell: { paddingLeft: space.xs, paddingVertical: 2 },
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
  refresh: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
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
  buttonRow: { flexDirection: 'row', gap: space.sm },
  notifyProblem: { gap: space.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  toggleText: { flex: 1 },
  toggleLabel: { fontSize: 14, fontWeight: '600' },
  rowTime: { fontSize: 16, fontVariant: ['tabular-nums'] },
});
