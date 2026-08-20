/**
 * Dev-only diagnostics (spec §9).
 *
 * Accuracy problems have to be diagnosable rather than anecdotal, so this shows
 * exactly what the engine saw and why it decided what it decided: the heard
 * alternatives, local vs global score, cursor and livePos, the jump verdict, and
 * the recognizer strategy actually in use. It also exports the session as a
 * replay fixture, which is how a real device transcript becomes a regression
 * test in __tests__/fixtures/.
 */
import { memo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { ayahByGlobal, globalAyahOf } from '../data/quran';
import type { SessionState } from '../engine/session';
import type { ReplayFixture } from '../engine/replay';
import type { RecognizerHandle } from '../recognition/useRecitationRecognizer';
import { radius, space, type Palette } from '../theme/theme';

export interface DebugOverlayProps {
  session: SessionState;
  recognizer: RecognizerHandle;
  palette: Palette;
  captureFixture: () => ReplayFixture;
}

export const DebugOverlay = memo(function DebugOverlay({
  session,
  recognizer,
  palette,
  captureFixture,
}: DebugOverlayProps) {
  const [open, setOpen] = useState(false);
  if (!__DEV__) return null;

  const live = ayahByGlobal(globalAyahOf(session.livePos));
  const d = session.debug;

  return (
    <View style={[styles.wrap, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityLabel="Toggle debug overlay">
        <Text style={[styles.title, { color: palette.textMuted }]}>
          dbg {live.surah}:{live.ayah} · cur {session.cursor} · live {session.livePos} ·{' '}
          {recognizer.strategy ?? '—'} {open ? '▾' : '▸'}
        </Text>
      </Pressable>
      {open ? (
        <ScrollView style={styles.body}>
          <Row label="status" value={`${session.status} / ${recognizer.status}`} palette={palette} />
          <Row label="lockedOn" value={String(session.lockedOn)} palette={palette} />
          <Row label="lookAhead" value={String(d.lookAhead)} palette={palette} />
          <Row label="local score" value={d.localScore.toFixed(3)} palette={palette} />
          <Row label="global score" value={d.globalScore.toFixed(3)} palette={palette} />
          <Row label="jump" value={d.jumpReason || '—'} palette={palette} />
          <Row label="anchor" value={String(d.anchor)} palette={palette} />
          <Row label="progress" value={String(d.progress)} palette={palette} />
          <Row label="engine latency" value={`${d.latencyMs} ms`} palette={palette} />
          <Row label="relay gap" value={`${recognizer.lastRelayGapMs} ms`} palette={palette} />
          <Row label="audio focus" value={recognizer.audioFocus} palette={palette} />
          <Row label="watchdog restarts" value={String(recognizer.watchdogRestarts)} palette={palette} />
          <Row label="heard anything" value={String(recognizer.heardSomething)} palette={palette} />
          <Row label="offline dropped" value={String(recognizer.offlineDropped)} palette={palette} />
          <Row label="segmented proven" value={String(recognizer.capabilities?.segmentedProven ?? false)} palette={palette} />
          <Row label="on-device" value={String(recognizer.capabilities?.onDeviceAvailable ?? false)} palette={palette} />
          <Row label="arabic pack" value={String(recognizer.languageStatus?.localeInstalled ?? 'unknown')} palette={palette} />
          <Row label="last error" value={recognizer.lastError ? `${recognizer.lastError.name}` : '—'} palette={palette} />
          <Row label="mistakes" value={session.mistakes.map((m) => m.word).join(',') || '—'} palette={palette} />
          <Row label="pending" value={session.pending.map((p) => p.word).join(',') || '—'} palette={palette} />
          <Text style={[styles.alts, { color: palette.text }]}>alternatives</Text>
          {d.alternatives.length === 0 ? (
            <Text style={[styles.alt, { color: palette.textMuted }]}>—</Text>
          ) : (
            d.alternatives.map((alt, i) => (
              <Text key={i} style={[styles.alt, { color: i === 0 ? palette.text : palette.textMuted }]}>
                {i + 1}. {alt}
              </Text>
            ))
          )}
          <Pressable
            onPress={() => {
              const fixture = captureFixture();
              void Share.share({
                title: 'Quran Habit replay fixture',
                message: JSON.stringify(fixture),
              });
            }}
            style={[styles.export, { borderColor: palette.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Export this session as a replay fixture"
          >
            <Text style={[styles.exportLabel, { color: palette.primary }]}>
              Export replay fixture ({captureFixture().events.length} events)
            </Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </View>
  );
});

function Row({ label, value, palette }: { label: string; value: string; palette: Palette }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: palette.textMuted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: palette.text }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    maxHeight: 280,
  },
  title: { fontSize: 10, fontVariant: ['tabular-nums'] },
  body: { marginTop: space.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  rowLabel: { fontSize: 10, flexShrink: 0 },
  rowValue: { fontSize: 10, flexShrink: 1, textAlign: 'right' },
  alts: { fontSize: 10, marginTop: space.xs, fontWeight: '700' },
  alt: { fontSize: 11, fontFamily: 'Amiri_400Regular', textAlign: 'right', writingDirection: 'rtl' },
  export: {
    marginTop: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingVertical: 6,
    alignItems: 'center',
  },
  exportLabel: { fontSize: 11, fontWeight: '600' },
});
