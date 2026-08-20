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
import { AmiriQuran_400Regular } from '@expo-google-fonts/amiri-quran';

import { RecitationProvider } from '../src/context/RecitationProvider';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { hasOnboarded } from '../src/data/storage';
import { lightPalette } from '../src/theme/theme';

export default function RootLayout() {
  // Every hook runs before any early return (§10): rendering nothing while the
  // fonts load must not change the hook order on the next pass.
  const [fontsLoaded, fontError] = useFonts({
    Amiri_400Regular,
    Amiri_700Bold,
    AmiriQuran_400Regular,
  });

  if (fontError !== null) {
    return (
      <View style={[styles.center, { backgroundColor: lightPalette.background }]}>
        <Text style={[styles.error, { color: lightPalette.error }]}>
          Amiri could not be loaded: {fontError.message}
          {'\n\n'}
          The Quran text needs Amiri Quran for correct tashkeel. Reinstall dependencies with
          `npm install` and rebuild the dev client.
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
          <Chrome />
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
        <Stack.Screen name="settings" options={{ title: 'Settings', presentation: 'modal' }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
