/**
 * Root layout.
 *
 * RecitationProvider is mounted HERE, above the router (spec §2). That single
 * placement decision is what removes the entire class of bugs the previous build
 * fought: the session, the cursor and the microphone outlive every screen, so
 * moving between surahs never needs a navigation, a remount, or a handoff.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Amiri_400Regular, Amiri_700Bold } from '@expo-google-fonts/amiri';

import { RecitationProvider } from '../src/context/RecitationProvider';
import { AdhanProvider } from '../src/context/AdhanProvider';
import { AdhanBanner } from '../src/components/AdhanBanner';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { hasOnboarded } from '../src/data/storage';
import { lightPalette } from '../src/theme/theme';

export default function RootLayout() {
  // Every hook runs before any early return (§10): rendering nothing while the
  // fonts load must not change the hook order on the next pass.
  /**
   * Amiri, not Amiri Quran, for the ayah text — a deliberate departure from §7,
   * for the reason §7 gives for choosing a font at all ("correct
   * tashkeel/Quranic marks"):
   *
   *   - Amiri Quran has NO GLYPH for U+065E, which the bundled Uthmani text uses
   *     1,807 times across 1,241 ayahs, and a missing combining mark renders as
   *     nothing at all.
   *   - Amiri Quran is really Amiri Quran *Coloured*: COLR/CPAL paint 612 glyphs
   *     red, green, orange and blue, which destroys red as the missed-word signal.
   *
   * Ayah text is now KFGQPC Uthmanic Script HAFS, the typeface the printed mushaf
   * is set in, so the page reads as the mushaf rather than as a web page. Amiri
   * stays for Latin-adjacent Arabic UI (surah names, the heard pill).
   * scripts/verify-fonts.mjs asserts full coverage and no colour tables in CI.
   */
  const [fontsLoaded, fontError] = useFonts({
    // The typeface the printed mushaf is actually set in. Bundled whole and
    // never subsetted: its licence grants Use/Copy/Distribute free of cost and
    // forbids modification, so a subsetting step would breach it.
    'KFGQPC-Hafs': require('../src/assets/fonts/UthmanicHafs.otf'),
    Amiri_400Regular,
    Amiri_700Bold,
  });

  if (fontError !== null) {
    return (
      <View style={[styles.center, { backgroundColor: lightPalette.background }]}>
        <Text style={[styles.error, { color: lightPalette.error }]}>
          Amiri could not be loaded: {fontError.message}
          {'\n\n'}
          The Quran text needs Amiri for correct tashkeel. Reinstall dependencies with
          `npm install` and rebuild the app.
        </Text>
      </View>
    );
  }

  // Render nothing until the fonts are ready (§7) — a flash of a fallback font
  // on Quranic text looks broken and drops the tashkeel.
  if (!fontsLoaded) {
    return (
      <View style={[styles.center, { backgroundColor: lightPalette.background }]}>
        <ActivityIndicator color={lightPalette.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RecitationProvider>
          {/* Inside RecitationProvider so the adhan can hold back while the
              microphone is live, and above the router so it can sound on any
              screen without a navigation. */}
          <AdhanProvider>
            <Chrome />
          </AdhanProvider>
        </RecitationProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Chrome() {
  const { palette, dark } = useTheme();
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    void hasOnboarded().then((done) => {
      setChecked(true);
      if (!done) router.replace('/onboarding');
    });
  }, [router]);

  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.background },
          headerTintColor: palette.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="surah/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, animation: checked ? 'default' : 'none' }} />
        <Stack.Screen name="adhkar" options={{ title: 'Adhkar' }} />
        <Stack.Screen name="hadith/[collection]/index" options={{ title: 'Books' }} />
        <Stack.Screen name="hadith/[collection]/[chapter]" options={{ title: 'Hadith' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings', presentation: 'modal' }} />
      </Stack>
      {/* Last sibling, so it paints over the header and every screen. */}
      <AdhanBanner />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
