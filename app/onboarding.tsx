/**
 * First run (spec §6.7): a three-step explainer that ENDS IN A LIVE TRY on
 * Al-Fatiha, so the first experience is success rather than a permission dialog.
 * The microphone permission is requested at the point it is about to be used and
 * explained in the same breath.
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';

import { setOnboarded } from '../src/data/storage';
import { useTheme } from '../src/theme/ThemeProvider';
import { radius, space } from '../src/theme/theme';

interface Step {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  cta: string;
}

const STEPS: Step[] = [
  {
    icon: 'book-outline',
    title: 'The page follows your voice',
    body:
      'Open any surah and recite. Quran Habit tracks where you are on the mushaf page — word by word — and turns the page when you do.',
    cta: 'Next',
  },
  {
    icon: 'sparkles-outline',
    title: 'Start anywhere, in any surah',
    body:
      'You do not have to tell it what you are reciting. Begin in the middle of another surah, with or without the basmala, and it finds you within a second.',
    cta: 'Next',
  },
  {
    icon: 'mic-outline',
    title: 'Try it on Al-Fatiha',
    body:
      'Quran Habit needs the microphone to follow along. Your recitation is processed on the device by Android’s own recognizer and is never uploaded.',
    cta: 'Allow microphone and try',
  },
];

export default function Onboarding() {
  const { palette } = useTheme();
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [denied, setDenied] = useState(false);
  const step = STEPS[index];

  const finish = useCallback(async () => {
    const permission = await Audio.requestPermissionsAsync();
    await setOnboarded();
    if (!permission.granted) {
      setDenied(true);
      return;
    }
    // land straight in a live try on Al-Fatiha
    router.replace({ pathname: '/surah/[id]', params: { id: '1', ayah: '1' } });
  }, [router]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: palette.background }]}>
      <View style={styles.body}>
        <View style={[styles.iconWrap, { backgroundColor: palette.accentSoft }]}>
          <Ionicons name={step.icon} size={34} color={palette.primary} />
        </View>
        <Text style={[styles.title, { color: palette.text }]}>{step.title}</Text>
        <Text style={[styles.text, { color: palette.textMuted }]}>{step.body}</Text>

        {denied ? (
          <Text style={[styles.denied, { color: palette.error }]}>
            Microphone access was denied, so follow-along cannot listen. You can still read and listen to
            recitations. To turn it on later: Settings → Apps → Quran Habit → Permissions → Microphone.
          </Text>
        ) : null}
      </View>

      <View style={styles.dots}>
        {STEPS.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i === index ? palette.primary : palette.border },
            ]}
          />
        ))}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => {
            if (index < STEPS.length - 1) setIndex(index + 1);
            else void finish();
          }}
          accessibilityRole="button"
          accessibilityLabel={step.cta}
          style={[styles.primary, { backgroundColor: palette.primary }]}
        >
          <Text style={[styles.primaryLabel, { color: palette.paper }]}>{step.cta}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void setOnboarded().then(() => router.replace('/(tabs)/quran'));
          }}
          accessibilityRole="button"
          accessibilityLabel="Skip the introduction"
        >
          <Text style={[styles.skip, { color: palette.textMuted }]}>
            {denied ? 'Continue without the microphone' : 'Skip'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: space.lg, justifyContent: 'space-between' },
  body: { flex: 1, justifyContent: 'center', gap: space.md },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 28, fontWeight: '700', lineHeight: 34 },
  text: { fontSize: 15, lineHeight: 23 },
  denied: { fontSize: 13, lineHeight: 20, marginTop: space.sm },
  dots: { flexDirection: 'row', gap: space.xs, justifyContent: 'center', marginBottom: space.md },
  dot: { width: 7, height: 7, borderRadius: 4 },
  actions: { gap: space.sm },
  primary: { borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center' },
  primaryLabel: { fontSize: 16, fontWeight: '700' },
  skip: { textAlign: 'center', fontSize: 13, paddingVertical: space.sm },
});
