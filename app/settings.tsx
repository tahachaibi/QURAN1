/**
 * Settings.
 *
 * Note what is NOT here: there is no engine picker (spec §0). The user should
 * never think about recognizers. The locale IS exposed, because recognizer
 * quality genuinely varies by locale and only the user can tell which sounds
 * best for their recitation (§4).
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useBilling } from '../src/billing/BillingProvider';
import { planRestore, type BackupParse, type RestoreSummary } from '../src/data/backup';
import { formatBytes, pickBackupFile, shareBackup } from '../src/data/backupFile';
import { exportAll, importAll } from '../src/data/storage';
import { useRecitation } from '../src/context/RecitationProvider';
import { useTheme } from '../src/theme/ThemeProvider';
import { ayahTextSizes, radius, space, type FontStep } from '../src/theme/theme';

const LOCALES = ['ar-SA', 'ar-EG', 'ar-MA', 'ar-AE', 'ar-JO', 'ar-DZ'];
const THEMES: { value: 'system' | 'light' | 'dark'; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Day' },
  { value: 'dark', label: 'Night mushaf' },
];

export default function Settings() {
  const { palette, prefs, setPrefs } = useTheme();
  const { recognizer } = useRecitation();
  const billing = useBilling();
  const router = useRouter();
  const backup = useBackup();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Section title="Reading" palette={palette}>
        <Row label="Theme" palette={palette}>
          <Choices
            options={THEMES.map((t) => ({ value: t.value, label: t.label }))}
            value={prefs.theme}
            onChange={(theme) => setPrefs({ theme })}
            palette={palette}
          />
        </Row>
        <Row label="Text size" palette={palette}>
          <Choices
            options={ayahTextSizes.map((s, i) => ({ value: i as FontStep, label: `${s.fontSize}pt` }))}
            value={prefs.fontStep}
            onChange={(fontStep) => setPrefs({ fontStep })}
            palette={palette}
          />
        </Row>
        <Toggle
          label="High contrast"
          hint="Maximum ink contrast for the mushaf text"
          value={prefs.highContrast}
          onChange={(highContrast) => setPrefs({ highContrast })}
          palette={palette}
        />
        <Toggle
          label="Reduce motion"
          hint="No page-turn animation, instant reveals"
          value={prefs.reduceMotion}
          onChange={(reduceMotion) => setPrefs({ reduceMotion })}
          palette={palette}
        />
      </Section>

      <Section title="While reciting" palette={palette}>
        <Toggle
          label="Haptics"
          hint="A light tick at the end of each ayah, and on a confirmed mistake. Never per word."
          value={prefs.haptics}
          onChange={(haptics) => setPrefs({ haptics })}
          palette={palette}
        />
        <Row label="Recognizer locale" palette={palette}>
          <Choices
            options={LOCALES.map((l) => ({ value: l, label: l }))}
            value={prefs.locale}
            onChange={(locale) => setPrefs({ locale })}
            palette={palette}
          />
        </Row>
        <Text style={[styles.hint, { color: palette.textMuted }]}>
          Recognition quality varies by locale. If Al-Fatiha tracks poorly, try ar-EG or ar-MA — the same
          voice can score very differently.
        </Text>
        <Toggle
          label="Prefer on-device recognition"
          hint="Lower latency, works with no network, and your recitation never leaves the phone."
          value={prefs.preferOnDevice}
          onChange={(preferOnDevice) => setPrefs({ preferOnDevice })}
          palette={palette}
        />
        <Toggle
          label="Continuous segmented session"
          hint="Keeps one recognition session alive across breaths on Android 12+. Turn off if your device behaves oddly."
          value={prefs.allowSegmented}
          onChange={(allowSegmented) => setPrefs({ allowSegmented })}
          palette={palette}
        />
      </Section>

      <Section title="Recognizer on this device" palette={palette}>
        <Info label="Android API" value={String(recognizer.capabilities?.sdkInt ?? '—')} palette={palette} />
        <Info
          label="Recognition service"
          value={recognizer.capabilities?.recognitionAvailable === true ? 'available' : 'not available'}
          palette={palette}
        />
        <Info
          label="On-device recognition"
          value={recognizer.capabilities?.onDeviceAvailable === true ? 'supported' : 'not supported'}
          palette={palette}
        />
        <Info
          label="Segmented sessions"
          value={
            recognizer.capabilities?.segmentedProven === true
              ? 'working'
              : recognizer.capabilities?.segmentedAvailable === true
                ? 'supported, not yet proven'
                : 'not supported'
          }
          palette={palette}
        />
        <Info label="Strategy in use" value={recognizer.strategy ?? '—'} palette={palette} />
        <Info
          label="Arabic offline pack"
          value={
            recognizer.languageStatus === null
              ? '—'
              : recognizer.languageStatus.localeInstalled === true
                ? 'installed'
                : recognizer.languageStatus.supported
                  ? 'not installed'
                  : (recognizer.languageStatus.detail ?? 'unknown')
          }
          palette={palette}
        />
        {recognizer.languageStatus?.localeInstalled === false ? (
          <Pressable
            onPress={() => void recognizer.requestLanguagePack()}
            accessibilityRole="button"
            accessibilityLabel="Install the Arabic offline pack"
            style={[styles.button, { backgroundColor: palette.primary }]}
          >
            <Text style={[styles.buttonLabel, { color: palette.paper }]}>Install Arabic offline pack</Text>
          </Pressable>
        ) : null}
        {recognizer.lastError !== null ? (
          <Text style={[styles.hint, { color: palette.error }]}>{recognizer.lastError.message}</Text>
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
      <Section title="Your data" palette={palette}>
        <Pressable
          onPress={backup.doExport}
          disabled={backup.busy !== null}
          accessibilityRole="button"
          accessibilityLabel="Save a backup file"
          style={styles.toggleRow}
        >
          <View style={styles.toggleText}>
            <Text style={[styles.rowLabel, { color: palette.text }]}>Save a backup</Text>
            <Text style={[styles.hint, { color: palette.textMuted }]}>
              Your memorisation schedule, streak, mistakes and reading positions, as one plain JSON file you
              keep. Nothing is uploaded anywhere — you choose where it goes.
            </Text>
          </View>
          {backup.busy === 'export' ? <ActivityIndicator color={palette.primary} /> : null}
        </Pressable>

        <Pressable
          onPress={backup.doPick}
          disabled={backup.busy !== null}
          accessibilityRole="button"
          accessibilityLabel="Restore from a backup file"
          style={styles.toggleRow}
        >
          <View style={styles.toggleText}>
            <Text style={[styles.rowLabel, { color: palette.text }]}>Restore from a backup</Text>
            <Text style={[styles.hint, { color: palette.textMuted }]}>
              Merged with what is already here, never replacing it — you will be told exactly what changes
              before anything is written.
            </Text>
          </View>
          {backup.busy === 'pick' ? <ActivityIndicator color={palette.primary} /> : null}
        </Pressable>

        {backup.pending !== null ? (
          <View style={[styles.confirm, { borderColor: palette.border }]}>
            <Text style={[styles.rowLabel, { color: palette.text }]}>
              {backup.pending.summary.losesNothing
                ? 'Nothing on this phone is lost'
                : 'Some things on this phone will change'}
            </Text>
            {describeLines(backup.pending.summary).map((line) => (
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
                <Text style={[styles.rowLabel, { color: palette.textMuted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={backup.confirm}
                accessibilityRole="button"
                style={[styles.confirmButton, { backgroundColor: palette.primary, borderColor: palette.primary }]}
              >
                <Text style={[styles.rowLabel, { color: palette.paper }]}>Restore</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {backup.note !== '' ? (
          <Text style={[styles.hint, { color: palette.textMuted, paddingHorizontal: space.md, paddingBottom: space.md }]}>
            {backup.note}
          </Text>
        ) : null}
      </Section>

      <Section title="Diagnostics" palette={palette}>
        <Toggle
          label="Show debug overlay"
          hint="Heard alternatives, local vs global score, cursor and jump decisions. Dev builds only."
          value={prefs.showDebugOverlay}
          onChange={(showDebugOverlay) => setPrefs({ showDebugOverlay })}
          palette={palette}
        />
      </Section>

      <Text style={[styles.footer, { color: palette.textMuted }]}>
        Quran Habit keeps everything on your device. There is no account, no analytics and no backend. Only
        prayer times and optional audio playback reach the network.
      </Text>
    </ScrollView>
  );
}

/**
 * The restore flow, as a hook so the screen stays declarative.
 *
 * Two deliberate properties. Picking a file WRITES NOTHING — it parses, plans,
 * and stops, so the user sees the consequence before agreeing to it. And a
 * restore that touches somebody's memorisation record is never a side effect of
 * opening a file.
 */
function useBackup() {
  const [busy, setBusy] = useState<'export' | 'pick' | 'restore' | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<{ values: Record<string, string>; summary: RestoreSummary } | null>(null);

  const doExport = useCallback(async () => {
    setBusy('export');
    setNote('');
    const result = await shareBackup(Date.now());
    setBusy(null);
    setNote(result.detail !== '' ? result.detail : `Backup ready — ${formatBytes(result.sizeBytes)}.`);
  }, []);

  const doPick = useCallback(async () => {
    setBusy('pick');
    setNote('');
    setPending(null);
    const { parse, detail } = await pickBackupFile();
    setBusy(null);
    if (parse === null) {
      // detail is empty when the user simply cancelled, which is not an error
      setNote(detail);
      return;
    }
    if (!parse.ok) {
      setNote(explainProblem(parse));
      return;
    }
    const plan = planRestore(await exportAll(), parse.backup.payload);
    setPending(plan);
  }, []);

  const confirm = useCallback(async () => {
    if (pending === null) return;
    setBusy('restore');
    const restored = await importAll(pending.values);
    setBusy(null);
    setPending(null);
    /**
     * The app reads most of this at mount, so a restore does not take effect
     * everywhere until it is reopened. Saying so is better than letting
     * somebody restore, see an unchanged streak, and conclude it failed.
     */
    setNote(
      `Restored ${restored.length} ${restored.length === 1 ? 'item' : 'items'}. Close and reopen Quran Habit to see all of it.`,
    );
  }, [pending]);

  const cancel = useCallback(() => {
    setPending(null);
    setNote('Nothing was changed.');
  }, []);

  return { busy, note, pending, doExport, doPick, confirm, cancel };
}

/** Why a file was refused, in words rather than an enum. */
function explainProblem(parse: Extract<BackupParse, { ok: false }>): string {
  switch (parse.problem) {
    case 'empty':
      return 'That file is empty. The copy may have failed — try sharing the backup to yourself again.';
    case 'not-json':
      return 'That file is not a Quran Habit backup — it is not even JSON. A photo or a truncated download looks like this.';
    case 'not-an-object':
    case 'not-a-backup':
      return 'That is a JSON file, but not one of ours.';
    case 'schema-too-new':
      return 'That backup was written by a newer version of Quran Habit, and this build cannot be sure what its contents mean. Update the app and try again.';
    case 'nothing-to-restore':
      return 'That is one of our backups, but there is nothing in it this version can restore.';
    default:
      return parse.detail;
  }
}

/** The consequence, in counts, before anything is written. */
function describeLines(s: RestoreSummary): string[] {
  const lines: string[] = [];
  if (s.hifz.added > 0 || s.hifz.recovered > 0) {
    lines.push(
      `Memorisation: ${s.hifz.added} ayahs added, ${s.hifz.recovered} updated from the file, ${s.hifz.kept} left as they are.`,
    );
  } else {
    lines.push('Memorisation: nothing in the file is newer than what is here.');
  }
  if (s.sessions.merged > 0) lines.push(`Sessions: ${s.sessions.recovered} recovered, ${s.sessions.merged} in total.`);
  if (s.mistakes.merged > 0) lines.push(`Mistakes: ${s.mistakes.recovered} recovered.`);
  if (s.progress.recovered > 0) lines.push(`Reading positions: ${s.progress.recovered} moved forward.`);
  if (s.settingsReplaced) lines.push('Settings will be replaced by the ones in the file.');
  if (s.skipped.length > 0) lines.push(`${s.skipped.length} thing(s) in the file are deliberately not restored.`);
  return lines;
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
