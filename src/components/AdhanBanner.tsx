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
import { hasAdhanSound } from '../data/adhan';
import { PRAYER_ARABIC } from '../data/prayerTimes';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/theme';

export function AdhanBanner() {
  const { prayer, playing, note, preview, dismiss, play } = useAdhan();
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();

  if (prayer === null) return null;

  return (
    <View style={[styles.wrap, { top: insets.top + space.xs }]} pointerEvents="box-none">
      <View style={[styles.card, { backgroundColor: palette.primary, borderColor: palette.accent }]}>
        <View style={styles.head}>
          <Ionicons name={playing ? 'volume-high' : 'notifications'} size={22} color={palette.accent} />
          <View style={styles.headText}>
            <Text style={[styles.arabic, { color: '#FFFFFF' }]}>{PRAYER_ARABIC[prayer]}</Text>
            <Text style={[styles.sub, { color: palette.accentSoft }]}>
              {preview
                ? 'Adhan · test'
                : playing
                  ? `Adhan · ${prayer}`
                  : `It is time for ${prayer}`}
            </Text>
          </View>
        </View>

        {note !== null ? <Text style={[styles.note, { color: palette.accentSoft }]}>{note}</Text> : null}

        {!playing && hasAdhanSound ? (
          <Pressable
            onPress={() => play(prayer)}
            accessibilityRole="button"
            accessibilityLabel="Play adhan"
            style={[styles.secondary, { borderColor: palette.accent }]}
          >
            <Ionicons name="play" size={16} color={palette.accent} />
            <Text style={[styles.secondaryText, { color: palette.accent }]}>Play adhan</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Stop the adhan' : 'Dismiss'}
          style={[styles.stop, { backgroundColor: palette.accent }]}
        >
          <Ionicons name={playing ? 'stop' : 'close'} size={18} color="#1B4332" />
          <Text style={styles.stopText}>{playing ? 'Stop adhan' : 'Dismiss'}</Text>
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
