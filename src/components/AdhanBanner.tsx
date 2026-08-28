/**
 * The adhan banner: what you see when the call to prayer sounds, and the one
 * button that silences it.
 *
 * Deliberately a top overlay rather than a modal. A modal would steal the screen
 * from whatever the user was reading, and the adhan is an announcement, not an
 * interruption to be dismissed before life continues. It sits over the header so
 * it is impossible to miss, and the Stop button is the full width of the card
 * because it has to be hittable with a thumb, in a hurry, without looking (§7).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAdhan } from '../context/AdhanProvider';
import { PRAYER_ARABIC } from '../data/prayerTimes';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/theme';

export function AdhanBanner() {
  const { prayer, dismiss } = useAdhan();
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();

  if (prayer === null) return null;

  return (
    <View style={[styles.wrap, { top: insets.top + space.xs }]} pointerEvents="box-none">
      <View style={[styles.card, { backgroundColor: palette.primary, borderColor: palette.accent }]}>
        {/**
          * Three things and no more: which prayer, that this is the adhan, and the
          * way to stop it. Everything else that used to be here — the length, the
          * media volume, the audio mode, the output route — was instrumentation
          * for a bug that is fixed. Diagnostics earn their place while something
          * is broken and become clutter the moment it is not.
          */}
        <View style={styles.head}>
          <Ionicons name="volume-high" size={22} color={palette.accent} />
          <View style={styles.headText}>
            <Text style={[styles.arabic, { color: '#FFFFFF' }]}>{PRAYER_ARABIC[prayer]}</Text>
            <Text style={[styles.sub, { color: palette.accentSoft }]}>Adhan</Text>
          </View>
        </View>

        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Stop the adhan"
          style={[styles.stop, { backgroundColor: palette.accent }]}
        >
          <Ionicons name="stop" size={18} color="#1B4332" />
          <Text style={styles.stopText}>Stop adhan</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: space.md, zIndex: 40 },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.md,
    gap: space.sm,
    // Android needs elevation for the shadow; the border carries it elsewhere.
    elevation: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headText: { flex: 1 },
  arabic: { fontSize: 22, fontFamily: 'Amiri_700Bold', writingDirection: 'rtl' },
  sub: { fontSize: 12, letterSpacing: 0.4, marginTop: 1 },
  note: { fontSize: 11, lineHeight: 16 },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.sm,
  },
  secondaryText: { fontSize: 13, fontWeight: '700' },
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderRadius: radius.md,
    paddingVertical: space.md,
  },
  stopText: { fontSize: 15, fontWeight: '800', color: '#1B4332' },
});
