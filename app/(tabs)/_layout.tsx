import { Pressable } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useT } from '../../src/i18n/useT';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function TabsLayout() {
  const { palette } = useTheme();
  const { t } = useT();
  const router = useRouter();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.text,
        /**
         * Settings, from every tab. It used to be reachable only from an
         * unlabelled icon inside an open surah, which hides itself while
         * listening — while the language screen promises "you can change it
         * later in Settings" to somebody who may just have picked a language
         * they cannot read. A gear in the corner needs no words to find.
         */
        headerRight: () => (
          <Pressable
            onPress={() => router.push('/settings')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('Settings')}
            style={{ paddingHorizontal: 16 }}
          >
            <Ionicons name="settings-outline" size={22} color={palette.text} />
          </Pressable>
        ),
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('Prayer'),
          tabBarIcon: ({ color, size }) => <Ionicons name="moon-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="hadith"
        options={{
          title: t('Hadith'),
          tabBarIcon: ({ color, size }) => <Ionicons name="library-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="quran"
        options={{
          title: t('Quran'),
          tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="listen"
        options={{
          title: t('Listen'),
          tabBarIcon: ({ color, size }) => <Ionicons name="headset-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tracker"
        options={{
          title: t('Tracker'),
          tabBarIcon: ({ color, size }) => <Ionicons name="flame-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
