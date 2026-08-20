/**
 * One word of the mushaf, with all of its states (spec §6.3).
 *
 * Memoized on value, and re-rendered only when its OWN state changes: the page
 * deck hands each page a slice clamped to that page's word range, so a
 * recognized word repaints one page, not all of them (§5.7).
 *
 * Hidden mode renders a ghost of the word's own glyphs at ~9% ink rather than a
 * box or a blank, so the page's geometry is byte-identical whether hidden or
 * revealed and the reciter still gets the rhythm of the line (§6.2).
 */
import { memo, useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { duration, inkOpacity, type Palette } from '../theme/theme';

export type WordState = 'upcoming' | 'current' | 'recited' | 'missed';

export interface AyahWordProps {
  /** global word index — also the accessibility and test identity */
  index: number;
  text: string;
  state: WordState;
  hidden: boolean;
  /** 0 none, 1 first letter shown, 2 whole word shown (§6.2) */
  hintLevel: 0 | 1 | 2;
  fontSize: number;
  lineHeight: number;
  palette: Palette;
  reduceMotion: boolean;
  /** shared voice level; drives the current word's breathing underline */
  level: Animated.Value;
  onPress: (index: number) => void;
  onLongPress: (index: number) => void;
  accessibilityHint: string;
}

/**
 * First grapheme cluster: a base letter plus any combining marks that belong to
 * it. Taking `text[0]` would strip a word's opening shadda or hamza and show the
 * wrong hint.
 */
function firstGrapheme(text: string): [string, string] {
  if (text.length === 0) return ['', ''];
  let i = 1;
  while (i < text.length && /[ؐ-ًؚ-ٰٟۖ-ۭ]/.test(text[i])) i++;
  return [text.slice(0, i), text.slice(i)];
}

function AyahWordImpl({
  index,
  text,
  state,
  hidden,
  hintLevel,
  fontSize,
  lineHeight,
  palette,
  reduceMotion,
  level,
  onPress,
  onLongPress,
  accessibilityHint,
}: AyahWordProps) {
  const revealed = !hidden || hintLevel === 2 || state === 'recited' || state === 'missed';
  const ink = useRef(new Animated.Value(revealed ? 1 : inkOpacity.hidden)).current;

  useEffect(() => {
    const target = revealed ? (state === 'upcoming' ? inkOpacity.upcoming : 1) : inkOpacity.hidden;
    if (reduceMotion) {
      ink.setValue(target);
      return;
    }
    Animated.timing(ink, {
      toValue: target,
      duration: duration.reveal,
      useNativeDriver: true,
    }).start();
  }, [revealed, state, ink, reduceMotion]);

  const showFirstLetterOnly = hidden && hintLevel === 1 && !revealed;
  const [head, tail] = showFirstLetterOnly ? firstGrapheme(text) : ['', ''];

  const underlineOpacity = reduceMotion
    ? 1
    : level.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  const underlineScale = reduceMotion
    ? 1
    : level.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });

  const textColor = palette.ink;

  return (
    <Pressable
      onPress={() => onPress(index)}
      onLongPress={() => onLongPress(index)}
      hitSlop={4}
      accessible
      accessibilityRole="text"
      accessibilityLabel={revealed || showFirstLetterOnly ? text : 'hidden word'}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: state === 'current' }}
      style={styles.press}
    >
      <View style={styles.wrap}>
        {showFirstLetterOnly ? (
          // one Text node, two spans: on Android nested Text becomes a single
          // SpannableString, so the word still shapes and joins correctly
          <Text
            allowFontScaling={false}
            style={[styles.word, { fontSize, lineHeight, color: textColor }]}
          >
            <Text style={{ opacity: 1 }}>{head}</Text>
            <Text style={{ opacity: inkOpacity.hidden }}>{tail}</Text>
          </Text>
        ) : (
          <Animated.Text
            allowFontScaling={false}
            style={[styles.word, { fontSize, lineHeight, color: textColor, opacity: ink }]}
          >
            {text}
          </Animated.Text>
        )}

        {/* current word: a gold underline that breathes with the voice, never a
            filled box over the sacred text (§6.3) */}
        {state === 'current' ? (
          <Animated.View
            style={[
              styles.underline,
              {
                backgroundColor: palette.accent,
                opacity: underlineOpacity,
                transform: [{ scaleX: underlineScale }],
              },
            ]}
          />
        ) : null}

        {/* a hinted word keeps a dashed gold underline as a record (§6.3) */}
        {hintLevel > 0 && state !== 'current' ? (
          <View style={[styles.dashed, { borderColor: palette.accent }]} />
        ) : null}

        {/* a missed word gets a small red dot BENEATH it — no red on the text */}
        {state === 'missed' ? (
          <View style={[styles.dot, { backgroundColor: palette.error }]} />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: {},
  wrap: {
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  word: {
    fontFamily: 'Amiri_400Regular',
    textAlign: 'center',
    // writingDirection is a STYLE in React Native, not a prop
    writingDirection: 'rtl',
  },
  underline: {
    position: 'absolute',
    bottom: 2,
    left: 4,
    right: 4,
    height: 2,
    borderRadius: 1,
  },
  dashed: {
    position: 'absolute',
    bottom: 2,
    left: 4,
    right: 4,
    height: 0,
    borderBottomWidth: 1.5,
    borderStyle: 'dashed',
  },
  dot: {
    position: 'absolute',
    bottom: -3,
    width: 5,
    height: 5,
    borderRadius: 3,
  },
});

/**
 * Custom comparator: `level` and the two callbacks are stable references from
 * the provider, and `palette` only changes on a theme switch. Everything else
 * is a primitive, so this is a cheap and exact bail-out.
 */
export const AyahWord = memo(AyahWordImpl, (a, b) =>
  a.index === b.index &&
  a.text === b.text &&
  a.state === b.state &&
  a.hidden === b.hidden &&
  a.hintLevel === b.hintLevel &&
  a.fontSize === b.fontSize &&
  a.lineHeight === b.lineHeight &&
  a.palette === b.palette &&
  a.reduceMotion === b.reduceMotion &&
  a.level === b.level &&
  a.onPress === b.onPress &&
  a.onLongPress === b.onLongPress);
