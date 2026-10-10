/**
 * Settings.
 *
 * Note what is NOT here: there is no engine picker (spec §0). The user should
 * never think about recognizers. The locale IS exposed, because recognizer
 * quality genuinely varies by locale and only the user can tell which sounds
 * best for their recitation (§4).
 */
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { LanguageStatus, SpeechCapabilities, SpeechStrategy } from '../modules/expo-arabic-speech';
import { useBilling } from '../src/billing/BillingProvider';
import { planRestore, type BackupParse, type RestoreSummary } from '../src/data/backup';
import { formatBytes, pickBackupFile, shareBackup } from '../src/data/backupFile';
import { exportAll, restoreAll, today } from '../src/data/storage';
import { useRecitation } from '../src/context/RecitationProvider';
import type { T } from '../src/i18n/i18n';
import { useT } from '../src/i18n/useT';
import { recognizerErrorText } from '../src/recognition/errorText';
import { useTheme } from '../src/theme/ThemeProvider';
import { ayahTextSizes, radius, space, type FontStep } from '../src/theme/theme';

const LOCALES = ['ar-SA', 'ar-EG', 'ar-MA', 'ar-AE', 'ar-JO', 'ar-DZ'];
const themes = (t: T): { value: 'system' | 'light' | 'dark'; label: string }[] => [
  { value: 'system', label: t('System') },
  { value: 'light', label: t('Day') },
  { value: 'dark', label: t('Night mushaf') },
];

export default function Settings() {
  const { palette, prefs, setPrefs } = useTheme();
  const { t } = useT();
  const { recognizer, session, clearDismissedWords } = useRecitation();
  const billing = useBilling();
  const router = useRouter();
  const backup = useBackup(t);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* First, and labelled in both languages: somebody who picked the wrong
          one by accident has to be able to find the way back without reading
          the language they cannot read. */}
      <Section title="Language · اللغة" palette={palette}>
        <Row label="Language · اللغة" palette={palette}>
          <Choices
            options={[
              { value: 'ar' as const, label: 'العربية' },
              { value: 'en' as const, label: 'English' },
            ]}
            value={prefs.language === 'ar' ? 'ar' : 'en'}
            onChange={(language) => setPrefs({ language })}
            palette={palette}
          />
        </Row>
      </Section>

      <Section title={t('Reading')} palette={palette}>
        <Row label={t('Theme')} palette={palette}>
          <Choices
            options={themes(t)}
            value={prefs.theme}
            onChange={(theme) => setPrefs({ theme })}
            palette={palette}
          />
        </Row>
        <Row label={t('Text size')} palette={palette}>
          <Choices
            options={ayahTextSizes.map((s, i) => ({ value: i as FontStep, label: `${s.fontSize}pt` }))}
            value={prefs.fontStep}
            onChange={(fontStep) => setPrefs({ fontStep })}
            palette={palette}
          />
        </Row>
        <Text style={[styles.hint, { color: palette.textMuted, paddingHorizontal: space.md }]}>
          {t('Hadith, adhkar and Listen text. The mushaf page always fits your screen.')}
        </Text>
        <Toggle
          label={t('High contrast')}
          hint={t('Maximum ink contrast for the mushaf text')}
          value={prefs.highContrast}
          onChange={(highContrast) => setPrefs({ highContrast })}
          palette={palette}
        />
        <Toggle
          label={t('Reduce motion')}
          hint={t('No page-turn animation, instant reveals')}
          value={prefs.reduceMotion}
          onChange={(reduceMotion) => setPrefs({ reduceMotion })}
          palette={palette}
        />
      </Section>

      <Section title={t('While reciting')} palette={palette}>
        <Toggle
          label={t('Haptics')}
          hint={t('A light tick at the end of each ayah, and on a confirmed mistake. Never per word.')}
          value={prefs.haptics}
          onChange={(haptics) => setPrefs({ haptics })}
          palette={palette}
        />
        <Row label={t('Recognizer locale')} palette={palette}>
          <Choices
            options={LOCALES.map((l) => ({ value: l, label: l }))}
            value={prefs.locale}
            onChange={(locale) => setPrefs({ locale })}
            palette={palette}
          />
        </Row>
        <Text style={[styles.hint, { color: palette.textMuted }]}>
          {t(
            'Recognition quality varies by locale. If Al-Fatiha tracks poorly, try ar-EG or ar-MA — the same voice can score very differently.',
          )}
        </Text>
        <Toggle
          label={t('Prefer on-device recognition')}
          hint={t('Lower latency, and works with no network when the Arabic offline pack is installed. Your recitation then stays on the phone.')}
          value={prefs.preferOnDevice}
          onChange={(preferOnDevice) => setPrefs({ preferOnDevice })}
          palette={palette}
        />
        <Toggle
          label={t('Continuous segmented session')}
          hint={t('Keeps one recognition session alive across breaths on Android 13+. Turn off if your device behaves oddly.')}
          value={prefs.allowSegmented}
          onChange={(allowSegmented) => setPrefs({ allowSegmented })}
          palette={palette}
        />
        <Toggle
          label={t('Underline ahead of the recognizer')}
          hint={t('The recognizer confirms each word a moment after you say it. This moves the underline on with your voice, at your own pace, and the recognizer then confirms it.')}
          value={prefs.leadUnderline}
          onChange={(leadUnderline) => setPrefs({ leadUnderline })}
          palette={palette}
        />
      </Section>

      <Section title={t('Recognizer on this device')} palette={palette}>
        <Info label={t('Android API')} value={String(recognizer.capabilities?.sdkInt ?? '—')} palette={palette} />
        <Info
          label={t('Recognition service')}
          value={recognizer.capabilities?.recognitionAvailable === true ? t('available') : t('not available')}
          palette={palette}
        />
        <Info
          label={t('On-device recognition')}
          value={recognizer.capabilities?.onDeviceAvailable === true ? t('supported') : t('not supported')}
          palette={palette}
        />
        <Info
          label={t('Segmented sessions')}
          value={
            recognizer.capabilities?.segmentedProven === true
              ? t('working')
              : recognizer.capabilities?.segmentedAvailable === true
                ? t('supported, not yet proven')
                : t('not supported')
          }
          palette={palette}
        />
        <Info label={t('Strategy in use')} value={strategyLabel(recognizer.strategy, t)} palette={palette} />
        <Info
          label={t('Arabic offline pack')}
          value={offlinePackLabel(recognizer.languageStatus, recognizer.capabilities, t)}
          palette={palette}
        />
        {recognizer.languageStatus?.localeInstalled === false ? (
          <Pressable
            onPress={() => void recognizer.requestLanguagePack()}
            accessibilityRole="button"
            accessibilityLabel={t('Install the Arabic offline pack')}
            style={[styles.button, { backgroundColor: palette.primary }]}
          >
            <Text style={[styles.buttonLabel, { color: palette.paper }]}>{t('Install Arabic offline pack')}</Text>
          </Pressable>
        ) : null}
        {/* A transient error is already being retried; showing it in red here
            would report a problem that has fixed itself. */}
        {recognizer.lastError !== null && !recognizer.lastError.transient ? (
          <Text style={[styles.hint, { color: palette.error }]}>{recognizerErrorText(recognizer.lastError, t)}</Text>
        ) : null}
      </Section>

      {/*
        One of the three places this app is allowed to mention money
        (src/billing/gates.ts PAYWALL_SITES), and it is a plain row rather than a
        card, a badge or a banner.

        The whole section disappears when MONETISATION_ENABLED is false, which is
        every build today: not disabled, not greyed out with a "coming soon",
        absent. A dormant paid tier that still advertises itself is just an ad,
        and nothing here is locked for the user to be curious about.
      */}
      {billing.monetisationEnabled ? (
        <Section title="The coach" palette={palette}>
          <Pressable
            onPress={() => router.push('/upgrade')}
            accessibilityRole="button"
            accessibilityLabel={billing.state.active ? 'Coach subscription details' : 'Unlock the coach'}
            style={styles.toggleRow}
          >
            <View style={styles.toggleText}>
              <Text style={[styles.rowLabel, { color: palette.text }]}>
                {billing.state.active ? 'Coach — active' : 'Unlock the coach'}
              </Text>
              <Text style={[styles.hint, { color: palette.textMuted }]}>
                {billing.state.active
                  ? 'Your revision schedule, mistake history and backup. Tap for the plan and how to restore it.'
                  : 'Revision schedule, mistake history, weak-ayah report and backup. The Quran, prayer times, the adhan and following along with your voice stay free.'}
              </Text>
            </View>
          </Pressable>
        </Section>
      ) : null}

      {/*
        There is no account and no server, so this file is the ONLY thing
        standing between a lost phone and a lost hifz deck. It is free, and it
        stays free while MONETISATION_ENABLED is false like everything else —
        but note that `backup` is on the paid list in gates.ts, so when the
        switch is eventually flipped this section is what goes behind it. The
        EXPORT half should not: a person must always be able to get their own
        data out, whether or not they are paying. That is a decision for the
        commit that flips the switch, and it is written down here so it is a
        decision rather than an oversight.
      */}
      <Section title={t('Your data')} palette={palette}>
        <Pressable
          onPress={backup.doExport}
          disabled={backup.busy !== null}
          accessibilityRole="button"
          accessibilityLabel={t('Save a backup file')}
          style={styles.toggleRow}
        >
          <View style={styles.toggleText}>
            <Text style={[styles.rowLabel, { color: palette.text }]}>{t('Save a backup')}</Text>
            <Text style={[styles.hint, { color: palette.textMuted }]}>
              {t(
                'Your memorization schedule, streak, mistakes and reading positions, as one plain JSON file you keep. Nothing is uploaded anywhere — you choose where it goes.',
              )}
            </Text>
          </View>
          {backup.busy === 'export' ? <ActivityIndicator color={palette.primary} /> : null}
        </Pressable>

        <Pressable
          onPress={backup.doPick}
          disabled={backup.busy !== null}
          accessibilityRole="button"
          accessibilityLabel={t('Restore from a backup file')}
          style={styles.toggleRow}
        >
          <View style={styles.toggleText}>
            <Text style={[styles.rowLabel, { color: palette.text }]}>{t('Restore from a backup')}</Text>
            <Text style={[styles.hint, { color: palette.textMuted }]}>
              {t(
                'Your progress is merged with what is already here, never replaced. Settings are taken from the file. You will be told exactly what changes before anything is written.',
              )}
            </Text>
          </View>
          {backup.busy === 'pick' ? <ActivityIndicator color={palette.primary} /> : null}
        </Pressable>

        {backup.pending !== null ? (
          <View style={[styles.confirm, { borderColor: palette.border }]}>
            <Text style={[styles.rowLabel, { color: palette.text }]}>
              {backup.pending.summary.losesNothing
                ? t('Nothing on this phone is lost')
                : t('Some things on this phone will change')}
            </Text>
            {describeLines(backup.pending, t).map((line) => (
              <Text key={line} style={[styles.hint, { color: palette.textMuted }]}>
                {line}
              </Text>
            ))}
            <View style={styles.confirmRow}>
              <Pressable
                onPress={backup.cancel}
                accessibilityRole="button"
                style={[styles.confirmButton, { borderColor: palette.border }]}
              >
                <Text style={[styles.rowLabel, { color: palette.textMuted }]}>{t('Cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={backup.confirm}
                disabled={backup.busy !== null}
                accessibilityRole="button"
                style={[styles.confirmButton, { backgroundColor: palette.primary, borderColor: palette.primary }]}
              >
                <Text style={[styles.rowLabel, { color: palette.paper }]}>{t('Restore')}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <Pressable
          onPress={clearDismissedWords}
          disabled={session.dismissed.size === 0}
          accessibilityRole="button"
          accessibilityLabel={t('Check the words marked “I said it right” again')}
          style={styles.toggleRow}
        >
          <View style={styles.toggleText}>
            <Text style={[styles.rowLabel, { color: session.dismissed.size === 0 ? palette.textMuted : palette.text }]}>
              {t('Check the words marked “I said it right” again')}
            </Text>
            <Text style={[styles.hint, { color: palette.textMuted }]}>
              {t('Words marked so far: {n}. They are never flagged as mistakes until you reset them here.', {
                n: session.dismissed.size,
              })}
            </Text>
          </View>
        </Pressable>

        {backup.note !== '' ? (
          <Text style={[styles.hint, { color: palette.textMuted, paddingHorizontal: space.md, paddingBottom: space.md }]}>
            {backup.note}
          </Text>
        ) : null}
      </Section>

      {/*
        Development builds only. The overlay this switches on renders nothing
        in a release build (DebugOverlay returns null unless __DEV__), and every
        APK anybody installs — the test build and the Play bundle alike — is a
        release build. So this was a switch that visibly did nothing, explained
        in developer jargon, on every user's settings screen.
      */}
      {__DEV__ ? (
        <Section title={t('Diagnostics')} palette={palette}>
          <Toggle
            label={t('Show debug overlay')}
            hint={t('Heard alternatives, local vs global score, cursor and jump decisions. Dev builds only.')}
            value={prefs.showDebugOverlay}
            onChange={(showDebugOverlay) => setPrefs({ showDebugOverlay })}
            palette={palette}
          />
        </Section>
      ) : null}

      <Text style={[styles.footer, { color: palette.textMuted }]}>
        {t(
          'Tasmee Hifz keeps your data on your device. There is no account, no analytics and no backend. The app goes online only for prayer times, the reciter list and audio you choose to play. Speech recognition goes online only when the Arabic offline pack is not installed.',
        )}
      </Text>
    </ScrollView>
  );
}

/** A picked file waiting for the user to confirm it. */
interface PendingRestore {
  /** what the confirmation shows; the write plans again against storage as it is then */
  summary: RestoreSummary;
  /** the file's payload, kept so the write can be planned at the moment it happens */
  incoming: Record<string, string>;
  /** when the file was made, epoch ms; 0 when it does not say */
  createdAt: number;
  /** some of the file could not be read, or it promised entries it does not hold */
  damaged: boolean;
}

/**
 * The restore flow, as a hook so the screen stays declarative.
 *
 * Two deliberate properties. Picking a file WRITES NOTHING — it parses, plans,
 * and stops, so the user sees the consequence before agreeing to it. And a
 * restore that touches somebody's memorisation record is never a side effect of
 * opening a file.
 */
function useBackup(t: T) {
  const [busy, setBusy] = useState<'export' | 'pick' | 'restore' | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const restoring = useRef(false);

  const doExport = useCallback(async () => {
    setBusy('export');
    setNote('');
    const result = await shareBackup(Date.now(), t);
    setBusy(null);
    setNote(result.detail !== '' ? result.detail : t('Backup ready — {size}.', { size: formatBytes(result.sizeBytes) }));
  }, [t]);

  const doPick = useCallback(async () => {
    setBusy('pick');
    setNote('');
    setPending(null);
    const { parse, detail } = await pickBackupFile(t);
    setBusy(null);
    if (parse === null) {
      // detail is empty when the user simply cancelled, which is not an error
      setNote(detail);
      return;
    }
    if (!parse.ok) {
      setNote(explainProblem(parse, t));
      return;
    }
    const plan = planRestore(await exportAll(), parse.backup.payload);
    // Nothing would change: the same file restored twice, or a backup just made
    // on this phone. Offering a Restore button for that ended in "Restored 0
    // items"; saying so now, and writing nothing, is the honest answer.
    if (Object.keys(plan.values).length === 0) {
      setNote(t('This backup holds nothing newer than what is already on this phone. Nothing was changed.'));
      return;
    }
    setPending({
      summary: plan.summary,
      incoming: parse.backup.payload,
      createdAt: parse.backup.createdAt,
      damaged: parse.warnings.some((w) => w.kind === 'unreadable-keys' || w.kind === 'incomplete'),
    });
  }, [t]);

  const confirm = useCallback(async () => {
    // A second tap would plan again from what the first one just wrote, and
    // report that the file held nothing new.
    if (pending === null || restoring.current) return;
    restoring.current = true;
    const { incoming } = pending;
    setBusy('restore');
    try {
      /**
       * Planned again HERE, against storage as it is now rather than when the
       * file was picked, and written with every part of the app that keeps a
       * copy in memory wrapped around the write (`restoreAll`, storage.ts).
       * That is what makes the restore take effect at once — and what stops
       * the next recitation or the next setting from quietly writing the old
       * copy back over it, which a "close and reopen" note never prevented.
       */
      const { planned, restored } = await restoreAll((current) => planRestore(current, incoming).values);
      setPending(null);
      setNote(
        planned === 0
          ? t('This backup holds nothing newer than what is already on this phone. Nothing was changed.')
          : restored.length === 0
            ? t('Nothing could be restored. Nothing was changed.')
            : restored.length < planned
              ? t('Part of the backup could not be written. Restore it again to finish.')
              : t('Backup restored.'),
      );
    } finally {
      restoring.current = false;
      setBusy(null);
    }
  }, [pending, t]);

  const cancel = useCallback(() => {
    setPending(null);
    setNote(t('Nothing was changed.'));
  }, [t]);

  return { busy, note, pending, doExport, doPick, confirm, cancel };
}

/** Why a file was refused, in words rather than an enum. */
function explainProblem(parse: Extract<BackupParse, { ok: false }>, t: T): string {
  switch (parse.problem) {
    case 'empty':
      return t('That file is empty. The copy may have failed — try sharing the backup to yourself again.');
    case 'not-json':
      return t(
        'That file is not a Tasmee Hifz backup — it is not even JSON. A photo or a truncated download looks like this.',
      );
    case 'not-an-object':
    case 'not-a-backup':
      return t('That is a JSON file, but not one of ours.');
    case 'schema-too-new':
      return t(
        'That backup was written by a newer version of Tasmee Hifz, and this build cannot be sure what its contents mean. Update the app and try again.',
      );
    case 'nothing-to-restore':
      return t('That is one of our backups, but there is nothing in it this version can restore.');
    default:
      return parse.detail;
  }
}

/** The consequence, in counts, before anything is written. */
function describeLines(p: PendingRestore, t: T): string[] {
  const s = p.summary;
  const lines: string[] = [];
  // Which file this is, first: "yesterday's, or last year's?" is the question
  // to settle before anything else. The same YYYY-MM-DD the file was named with.
  if (p.createdAt > 0) lines.push(t('Backup made on {date}.', { date: today(new Date(p.createdAt)) }));
  if (s.hifz.added > 0 || s.hifz.recovered > 0) {
    lines.push(
      t('Memorization, in ayahs: {added} added, {updated} updated from the file, {kept} left as they are.', {
        added: s.hifz.added,
        updated: s.hifz.recovered,
        kept: s.hifz.kept,
      }),
    );
  } else {
    lines.push(t('Memorization: nothing in the file is newer than what is here.'));
  }
  if (s.sessions.merged > 0) {
    lines.push(t('Sessions: {recovered} recovered, {total} in total.', { recovered: s.sessions.recovered, total: s.sessions.merged }));
  }
  if (s.mistakes.merged > 0) lines.push(t('Mistakes: {n} recovered.', { n: s.mistakes.recovered }));
  if (s.progress.recovered > 0) lines.push(t('Reading positions: {n} moved forward.', { n: s.progress.recovered }));
  if (s.settingsReplaced) lines.push(t('Settings will be replaced by the ones in the file.'));
  // What a capped list pushes off the end. These are what `losesNothing`
  // counted when it said something will change, and the screen used to leave
  // the user to guess which thing it meant.
  if (s.sessions.dropped > 0) {
    lines.push(
      s.sessions.dropped === 1
        ? t('The oldest session will not be kept: the history is full.')
        : t('The {n} oldest sessions will not be kept: the history is full.', { n: s.sessions.dropped }),
    );
  }
  if (s.mistakes.dropped > 0) {
    lines.push(
      s.mistakes.dropped === 1
        ? t('The oldest mistake will not be kept: the history is full.')
        : t('The {n} oldest mistakes will not be kept: the history is full.', { n: s.mistakes.dropped }),
    );
  }
  if (s.skipped.length > 0) {
    lines.push(
      s.skipped.length === 1
        ? t('1 item in the file is deliberately not restored.')
        : t('{n} items in the file are deliberately not restored.', { n: s.skipped.length }),
    );
  }
  if (p.damaged) lines.push(t('Part of this file could not be read, so not everything in it can be restored.'));
  return lines;
}

/**
 * The recognizer strategy in words. The native module reports an enum name,
 * and "SEGMENTED" or "RELAY" is a developer's word on a settings screen, in
 * either language.
 */
function strategyLabel(strategy: SpeechStrategy | null, t: T): string {
  switch (strategy) {
    case 'STREAM':
      return t('Continuous microphone stream');
    case 'SEGMENTED':
      return t('Continuous segmented session');
    case 'ON_DEVICE':
      return t('On-device recognition');
    case 'RELAY':
      return t('Standard recognition');
    default:
      return '—';
  }
}

/**
 * The offline pack row, without the native module's own English.
 *
 * When the recognizer cannot say whether the pack is there, the Kotlin gives
 * its reason as a developer's sentence ("checkRecognitionSupport timed out
 * after 4s"), and that used to be printed here as it was, in English in the
 * Arabic interface too. Its reasons come in two kinds and the capabilities
 * already tell them apart: a phone that cannot recognise on-device at all
 * (before Android 13, or with no on-device service) has no pack to install,
 * and anything else is a question that went unanswered.
 */
function offlinePackLabel(status: LanguageStatus | null, capabilities: SpeechCapabilities | null, t: T): string {
  if (status === null) return '—';
  if (status.localeInstalled === true) return t('installed');
  if (status.supported) return t('not installed');
  const impossible = capabilities !== null && (capabilities.sdkInt < 33 || !capabilities.onDeviceAvailable);
  return impossible ? t('not available') : t('unknown');
}

// --- small building blocks ---

type Palette = ReturnType<typeof useTheme>['palette'];

function Section({ title, palette, children }: { title: string; palette: Palette; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.textMuted }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>{children}</View>
    </View>
  );
}

function Row({ label, palette, children }: { label: string; palette: Palette; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text>
      {children}
    </View>
  );
}

function Info({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.rowLabel, { color: palette.textMuted }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: palette.text }]}>{value}</Text>
    </View>
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
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
  palette: Palette;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text>
        <Text style={[styles.hint, { color: palette.textMuted }]}>{hint}</Text>
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

function Choices<T extends string | number>({
  options,
  value,
  onChange,
  palette,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  palette: Palette;
}) {
  return (
    <View style={styles.choices}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={[
              styles.choice,
              {
                backgroundColor: selected ? palette.primary : 'transparent',
                borderColor: selected ? palette.primary : palette.border,
              },
            ]}
          >
            <Text style={[styles.choiceLabel, { color: selected ? palette.paper : palette.text }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  confirm: { borderTopWidth: StyleSheet.hairlineWidth, padding: space.md, gap: 6 },
  confirmRow: { flexDirection: 'row', gap: space.sm, paddingTop: space.sm },
  confirmButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  content: { padding: space.md, gap: space.md, paddingBottom: space.xxl },
  section: { gap: space.xs },
  sectionTitle: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.md,
  },
  row: { gap: space.sm },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  infoValue: { fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  rowLabel: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  toggleText: { flex: 1 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  choice: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  choiceLabel: { fontSize: 12, fontWeight: '600' },
  button: { borderRadius: radius.pill, paddingVertical: 12, alignItems: 'center' },
  buttonLabel: { fontSize: 14, fontWeight: '700' },
  footer: { fontSize: 12, lineHeight: 18 },
});
