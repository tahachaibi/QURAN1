/**
 * The Listen tab (spec §8).
 *
 * Reuses the SAME page renderer as Read, so follow-along highlighting during
 * playback looks identical to follow-along during recitation — one renderer, one
 * set of word states, no second code path to drift.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';

import { ayahsOnPage, ayahByGlobal, globalAyahOf } from '../data/quran';
import { ayahAudioUrl, RECITERS, reciterById } from '../data/audio';
import type { SessionState } from '../engine/session';
import { radius, space, type FontStep, type Palette } from '../theme/theme';
import { MushafPage } from './MushafPage';
import { usePageSlice } from '../hooks/usePageSlice';
import { OfflineBadge } from './controls';

export interface ListenPanelProps {
  surah: number;
  palette: Palette;
  reciter: string;
  onReciterChange: (id: string) => void;
  onFollowWord: (word: number) => void;
  session: SessionState;
  fontStep: FontStep;
  reduceMotion: boolean;
  level: Animated.Value;
  hintLevelOf: (word: number) => 0 | 1 | 2;
  width: number;
  page: number;
  onPageChange: (page: number) => void;
}

export function ListenPanel(props: ListenPanelProps) {
  const {
    palette,
    reciter,
    onReciterChange,
    onFollowWord,
    session,
    fontStep,
    reduceMotion,
    level,
    hintLevelOf,
    width,
    page,
  } = props;

  const [playing, setPlaying] = useState(false);
  const [globalAyah, setGlobalAyah] = useState(() => globalAyahOf(session.livePos) + 1);
  const [offline, setOffline] = useState(false);
  const sound = useRef<Audio.Sound | null>(null);
  const sliceFor = usePageSlice(session);
  const ayahsHere = useMemo(() => ayahsOnPage(page), [page]);

  const unload = useCallback(async () => {
    const current = sound.current;
    sound.current = null;
    if (current !== null) {
      await current.unloadAsync().catch(() => undefined);
    }
  }, []);

  useEffect(
    () => () => {
      void unload();
    },
    [unload],
  );

  const playAyah = useCallback(
    async (target: number) => {
      await unload();
      setOffline(false);
      try {
        const { sound: created } = await Audio.Sound.createAsync(
          { uri: ayahAudioUrl(target, reciter) },
          { shouldPlay: true },
        );
        sound.current = created;
        setGlobalAyah(target);
        setPlaying(true);
        // follow-along: move the shared cursor to the start of the playing ayah
        onFollowWord(ayahByGlobal(target - 1).wordStart);
        created.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            void playAyah(target + 1);
          }
        });
      } catch {
        // Never a scary error: show the offline badge and stop (§6.7)
        setOffline(true);
        setPlaying(false);
      }
    },
    [onFollowWord, reciter, unload],
  );

  const toggle = useCallback(() => {
    if (playing) {
      void sound.current?.pauseAsync().catch(() => undefined);
      setPlaying(false);
      return;
    }
    if (sound.current !== null) {
      void sound.current.playAsync().catch(() => undefined);
      setPlaying(true);
      return;
    }
    void playAyah(globalAyah);
  }, [globalAyah, playAyah, playing]);

  return (
    <View style={styles.root}>
      <View style={styles.pageWrap}>
        <MushafPage
          page={page}
          slice={sliceFor(page)}
          hidden={false}
          fontStep={fontStep}
          palette={palette}
          reduceMotion={reduceMotion}
          level={level}
          cursor={session.cursor}
          hintLevelOf={hintLevelOf}
          onWordPress={(word) => void playAyah(globalAyahOf(word) + 1)}
          onWordLongPress={(word) => void playAyah(globalAyahOf(word) + 1)}
          width={width}
        />
      </View>

      <View style={[styles.controls, { borderColor: palette.border }]}>
        {offline ? <OfflineBadge palette={palette} label="Audio needs a connection" /> : null}

        <View style={styles.transport}>
          <Pressable
            onPress={() => void playAyah(Math.max(1, globalAyah - 1))}
            accessibilityRole="button"
            accessibilityLabel="Previous ayah"
            hitSlop={10}
          >
            <Ionicons name="play-skip-back" size={22} color={palette.text} />
          </Pressable>
          <Pressable
            onPress={toggle}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause' : 'Play'}
            style={[styles.play, { backgroundColor: palette.primary }]}
          >
            <Ionicons name={playing ? 'pause' : 'play'} size={24} color={palette.paper} />
          </Pressable>
          <Pressable
            onPress={() => void playAyah(globalAyah + 1)}
            accessibilityRole="button"
            accessibilityLabel="Next ayah"
            hitSlop={10}
          >
            <Ionicons name="play-skip-forward" size={22} color={palette.text} />
          </Pressable>
          <Text style={[styles.nowPlaying, { color: palette.textMuted }]}>
            {ayahLabel(globalAyah)} · {ayahsHere.length} on this page
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reciters}>
          {RECITERS.map((r) => {
            const selected = r.id === reciter;
            return (
              <Pressable
                key={r.id}
                onPress={() => onReciterChange(r.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={r.name}
                style={[
                  styles.reciter,
                  {
                    backgroundColor: selected ? palette.primary : palette.surface,
                    borderColor: selected ? palette.primary : palette.border,
                  },
                ]}
              >
                <Text style={[styles.reciterName, { color: selected ? palette.paper : palette.text }]}>
                  {r.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const ayahLabel = (globalAyah: number): string => {
  const a = ayahByGlobal(Math.max(0, globalAyah - 1));
  return `${a.surah}:${a.ayah}`;
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  pageWrap: { flex: 1 },
  controls: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  transport: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  play: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  nowPlaying: { fontSize: 12, marginLeft: 'auto' },
  reciters: { gap: space.sm, paddingBottom: space.sm },
  reciter: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  reciterName: { fontSize: 12, fontWeight: '600' },
});
