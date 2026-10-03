/**
 * The first screen of a fresh install: which language should the app speak?
 *
 * Written in BOTH languages at once, because the whole point is that the
 * reader may not understand one of them yet. It returns here only when the
 * language has never been chosen. After that it is changed in Settings.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { hasOnboarded } from '../src/data/storage';
import { useTheme } from '../src/theme/ThemeProvider';
import { radius, space } from '../src/theme/theme';

const CHOICES = [
  { value: 'ar' as const, label: 'العربية', hint: 'واجهة التطبيق بالعربية' },
  { value: 'en' as const, label: 'English', hint: 'The app in English' },
];

export default function LanguageScreen() {
  const { palette, setPrefs } = useTheme();
  const router = useRouter();

  const choose = (language: 'ar' | 'en') => {
    setPrefs({ language });
    void hasOnboarded().then((done) => router.replace(done ? '/(tabs)/quran' : '/onboarding'));
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: palette.background }]}>
      <View style={styles.body}>
        <View style={[styles.iconWrap, { backgroundColor: palette.accentSoft }]}>
          <Ionicons name="language-outline" size={34} color={palette.primary} />
        </View>
        <Text style={[styles.titleAr, { color: palette.text }]}>اختر لغة التطبيق</Text>
        <Text style={[styles.title, { color: palette.text }]}>Choose the app language</Text>
        <Text style={[styles.note, { color: palette.textMuted }]}>
          {'يمكنك تغييرها لاحقًا من الإعدادات.\nYou can change it later in Settings.'}
        </Text>

        <View style={styles.choices}>
          {CHOICES.map((c) => (
            <Pressable
              key={c.value}
              onPress={() => choose(c.value)}
              accessibilityRole="button"
              accessibilityLabel={c.label}
              style={({ pressed }) => [
                styles.choice,
                { borderColor: palette.primary, backgroundColor: pressed ? palette.accentSoft : palette.surface },
              ]}
            >
              <Text style={[styles.choiceLabel, { color: palette.primary }]}>{c.label}</Text>
              <Text style={[styles.choiceHint, { color: palette.textMuted }]}>{c.hint}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: space.lg, gap: space.sm },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: space.md,
  },
  titleAr: { fontFamily: 'Amiri_700Bold', fontSize: 26, textAlign: 'center' },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  note: { fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: space.xs },
  choices: { gap: space.md, marginTop: space.xl },
  choice: { borderWidth: 2, borderRadius: radius.lg, paddingVertical: space.md, alignItems: 'center' },
  choiceLabel: { fontSize: 24, fontWeight: '700' },
  choiceHint: { fontSize: 13, marginTop: 2 },
});
