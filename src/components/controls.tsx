/**
 * One-thumb controls (spec §6.4). Everything here is designed to sit in the
 * bottom third of the screen, reachable by the thumb of the hand holding the
 * phone. Nothing competes with the text: while listening the header hides and
 * the page goes full-bleed.
 */
import { memo, useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { radius, space, type Palette } from '../theme/theme';

// ---------------------------------------------------------------------------

export interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
  palette: Palette;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  palette,
}: SegmentedControlProps<T>) {
  return (
    <View
      style={[styles.segment, { backgroundColor: palette.surface, borderColor: palette.border }]}
      accessibilityRole="tablist"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            accessibilityHint={option.hint}
            style={[
              styles.segmentItem,
              selected && { backgroundColor: palette.primary },
            ]}
          >
            <Text
              style={[
                styles.segmentLabel,
                { color: selected ? palette.paper : palette.textMuted },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface IconToggleProps<T extends string> {
  options: { value: T; icon: keyof typeof Ionicons.glyphMap; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
  palette: Palette;
}

/**
 * A two-state toggle drawn as icons, for the bottom bar.
 *
 * Follow/Hidden lived in the header as a labelled segmented control, which cost
 * a whole band of vertical space above the page. As icons in the bottom bar it
 * is both inside thumb reach (§6.4) and hands that space back to the text.
 */
export function IconToggle<T extends string>({ options, value, onChange, palette }: IconToggleProps<T>) {
  return (
    <View
      style={[styles.iconToggle, { backgroundColor: palette.surface, borderColor: palette.border }]}
      accessibilityRole="tablist"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            accessibilityHint={option.hint}
            style={[styles.iconToggleItem, selected && { backgroundColor: palette.primary }]}
          >
            <Ionicons
              name={option.icon}
              size={18}
              color={selected ? palette.paper : palette.textMuted}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface MicButtonProps {
  listening: boolean;
  /** 0..1 voice level; the button pulses with your ACTUAL voice, not a timer */
  level: Animated.Value;
  onPress: () => void;
  palette: Palette;
  reduceMotion: boolean;
  disabled?: boolean;
}

export const MicButton = memo(function MicButton({
  listening,
  level,
  onPress,
  palette,
  reduceMotion,
  disabled,
}: MicButtonProps) {
  const scale = reduceMotion
    ? 1
    : level.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] });
  const haloOpacity = reduceMotion
    ? 0.25
    : level.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.45] });

  return (
    <View style={styles.micWrap}>
      {listening ? (
        <Animated.View
          style={[
            styles.micHalo,
            { backgroundColor: palette.accent, opacity: haloOpacity, transform: [{ scale }] },
          ]}
        />
      ) : null}
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={listening ? 'Stop reciting' : 'Start reciting'}
        accessibilityHint={
          listening
            ? 'Ends the session and shows your summary'
            : 'Starts listening and follows your recitation on the page'
        }
        style={({ pressed }) => [
          styles.mic,
          {
            backgroundColor: disabled
              ? palette.border
              : listening
                ? palette.accent
                : palette.primary,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons
          name={listening ? 'stop' : 'mic'}
          size={30}
          color={listening ? palette.text : palette.paper}
        />
      </Pressable>
    </View>
  );
});

// ---------------------------------------------------------------------------

export interface StatsColumnProps {
  elapsedMs: number;
  mistakeCount: number;
  onReset: () => void;
  onOpenMistakes: () => void;
  palette: Palette;
}

export const StatsColumn = memo(function StatsColumn({
  elapsedMs,
  mistakeCount,
  onReset,
  onOpenMistakes,
  palette,
}: StatsColumnProps) {
  return (
    <View style={styles.stats}>
      <View style={styles.statsRow}>
        <Text style={[styles.timer, { color: palette.text }]} accessibilityLabel={`Session time ${formatDuration(elapsedMs)}`}>
          {formatDuration(elapsedMs)}
        </Text>
        <Pressable
          onPress={onReset}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Reset session stats"
        >
          <Ionicons name="refresh" size={13} color={palette.textMuted} />
        </Pressable>
      </View>
      <Pressable
        onPress={onOpenMistakes}
        accessibilityRole="button"
        accessibilityLabel={`${mistakeCount} ${mistakeCount === 1 ? 'mistake' : 'mistakes'}`}
        accessibilityHint="Opens the mistakes review sheet"
        style={[
          styles.mistakePill,
          {
            backgroundColor: mistakeCount > 0 ? palette.errorSoft : palette.successSoft,
            borderColor: mistakeCount > 0 ? palette.error : palette.success,
          },
        ]}
      >
        <Text style={[styles.mistakeCount, { color: mistakeCount > 0 ? palette.error : palette.success }]}>
          {mistakeCount === 0 ? 'clean' : `${mistakeCount} to review`}
        </Text>
      </Pressable>
    </View>
  );
});

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------

export interface ChipProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  palette: Palette;
  tone?: 'accent' | 'neutral' | 'error';
  accessibilityHint?: string;
}

export const Chip = memo(function Chip({ label, icon, onPress, palette, tone = 'neutral', accessibilityHint }: ChipProps) {
  const background =
    tone === 'accent' ? palette.accentSoft : tone === 'error' ? palette.errorSoft : palette.surface;
  const color = tone === 'accent' ? palette.primary : tone === 'error' ? palette.error : palette.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={[styles.chip, { backgroundColor: background, borderColor: palette.border }]}
    >
      {icon ? <Ionicons name={icon} size={14} color={color} style={styles.chipIcon} /> : null}
      <Text style={[styles.chipLabel, { color }]}>{label}</Text>
    </Pressable>
  );
});

// ---------------------------------------------------------------------------

export interface HeardPillProps {
  text: string;
  expanded: boolean;
  onToggle: () => void;
  transcript: readonly string[];
  palette: Palette;
  reduceMotion: boolean;
}

/** The last thing heard, fading. Tap to expand into a live transcript (§6.4). */
export const HeardPill = memo(function HeardPill({
  text,
  expanded,
  onToggle,
  transcript,
  palette,
  reduceMotion,
}: HeardPillProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (text.length === 0) return;
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(1);
    Animated.timing(opacity, { toValue: 0.25, duration: 2600, useNativeDriver: true }).start();
  }, [text, opacity, reduceMotion]);

  if (text.length === 0 && !expanded) return null;

  return (
    <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel="Last heard" accessibilityHint="Expands the live transcript">
      <Animated.View
        style={[
          styles.heardPill,
          { backgroundColor: palette.surface, borderColor: palette.border, opacity: expanded ? 1 : opacity },
        ]}
      >
        <Text
          numberOfLines={expanded ? 8 : 1}
          style={[styles.heardText, { color: palette.textMuted }]}
        >
          {expanded ? transcript.join('  ·  ') : text}
        </Text>
      </Animated.View>
    </Pressable>
  );
});

// ---------------------------------------------------------------------------

/** Never a scary error: an offline badge, and tracking carries on regardless. */
export const OfflineBadge = memo(function OfflineBadge({ palette, label }: { palette: Palette; label: string }) {
  return (
    <View style={[styles.offline, { backgroundColor: palette.accentSoft, borderColor: palette.accent }]}>
      <Ionicons name="cloud-offline-outline" size={13} color={palette.primary} />
      <Text style={[styles.offlineText, { color: palette.primary }]}>{label}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  segment: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
  },
  segmentItem: {
    paddingVertical: 6,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  iconToggle: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
  },
  iconToggleItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
  },
  micWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 76,
    height: 76,
  },
  micHalo: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  mic: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: {
    minWidth: 92,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  timer: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
  mistakePill: {
    marginTop: space.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  mistakeCount: {
    fontSize: 11,
    fontWeight: '600',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  chipIcon: {
    marginRight: 6,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  heardPill: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    maxWidth: 320,
  },
  heardText: {
    fontSize: 13,
    fontFamily: 'Amiri_400Regular',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  offlineText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
