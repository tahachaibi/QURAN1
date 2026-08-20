/**
 * Settings.
 *
 * Note what is NOT here: there is no engine picker (spec §0). The user should
 * never think about recognizers. The locale IS exposed, because recognizer
 * quality genuinely varies by locale and only the user can tell which sounds
 * best for their recitation (§4).
 */
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

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
