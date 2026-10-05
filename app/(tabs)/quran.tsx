/**
 * Quran tab (spec §8): all 114 surahs, searchable, plus continue-where-you-
 * left-off and a juz / page jump.
 */
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { Lang, T } from '../../src/i18n/i18n';
import { surahName } from '../../src/i18n/names';
import { useT } from '../../src/i18n/useT';

import {
  ayahByGlobal,
  globalAyahOf,
  hizbStart,
  juzStart,
  searchSurahs,
  surahOf,
  TOTAL_HIZB,
  TOTAL_JUZ,
  wordIndexOf,
  type SurahInfo,
} from '../../src/data/quran';
import { lastPosition, loadProgress, type ProgressMap } from '../../src/data/storage';
import { useRecitation } from '../../src/context/RecitationProvider';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, space, type Palette } from '../../src/theme/theme';

export default function QuranScreen() {
  const { palette } = useTheme();
  const { t, lang, arabic } = useT();
  const router = useRouter();
  const { session, seekTo, setViewedPage } = useRecitation();
  const [query, setQuery] = useState('');
  const [resume, setResume] = useState<{ surah: number; cursor: number } | null>(null);
  /** where each surah was left (§6.7) */
  const [progress, setProgress] = useState<ProgressMap>({});

  /**
   * Read on every visit to the tab, not once at mount. The tab stays mounted
   * underneath the surah screen it opens, so a read at mount never saw what
   * that screen saved: "Continue" kept naming the surah before last, and on a
   * fresh install it did not appear at all until the app was restarted.
   */
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void Promise.all([lastPosition(), loadProgress()]).then(([last, all]) => {
        if (!live) return;
        setResume(last);
        setProgress(all);
      });
      return () => {
        live = false;
      };
    }, []),
  );

  const filtered = useMemo(() => searchSurahs(query), [query]);

  /** for the juz and hizb jumps, which land on the first word of an ayah */
  const open = useCallback(
    (surah: number, ayah: number) => {
      router.push({ pathname: '/surah/[id]', params: { id: String(surah), ayah: String(ayah) } });
    },
    [router],
  );

  // The surah a session's cursor is in, while there is a session at all.
  const sessionSurah = session.status === 'idle' ? null : surahOf(session.cursor);

  /**
   * A surah opens where its reader left it, which is what the per-surah save
   * (§6.7) is for; every row used to open at ayah 1 and the save was never read
   * from here. A session already in that surah owns its place (§2), so it is
   * followed rather than dragged back to the last save; otherwise the cursor
   * moves to the saved place, or to the first ayah of a surah never read.
   *
   * The route carries no ayah. An ayah in the route makes the surah screen seek
   * to that ayah's first word, which would undo the exact word just set; without
   * one it follows the cursor that is already there.
   */
  const openSurah = useCallback(
    (surah: number) => {
      if (sessionSurah !== surah) {
        const saved = progress[String(surah)];
        seekTo(saved !== undefined && surahOf(saved.cursor) === surah ? saved.cursor : wordIndexOf(surah, 1));
      }
      router.push({ pathname: '/surah/[id]', params: { id: String(surah) } });
    },
    [progress, router, seekTo, sessionSurah],
  );

  const renderItem = useCallback(
    ({ item }: { item: SurahInfo }) => (
      <Pressable
        onPress={() => openSurah(item.number)}
        accessibilityRole="button"
        accessibilityLabel={
          arabic
            ? `${item.name}، ${t('{n} verses', { n: item.totalVerses })}`
            : `${item.transliteration}, ${item.translation}, ${item.totalVerses} verses, ${item.type}`
        }
        style={[styles.row, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        <View style={[styles.numberBadge, { borderColor: palette.accent }]}>
          <Text style={[styles.number, { color: palette.primary }]}>{item.number}</Text>
        </View>
        <View style={styles.rowMain}>
          {/* In Arabic the Arabic name on the right is the name; a
              transliteration and an English meaning are only for readers
              who cannot read it. */}
          {arabic ? null : (
            <Text style={[styles.translit, { color: palette.text }]}>{item.transliteration}</Text>
          )}
          <Text style={[styles.translation, { color: palette.textMuted }]}>
            {arabic ? '' : `${item.translation} · `}
            {t('{n} verses', { n: item.totalVerses })} · {item.type === 'meccan' ? t('Meccan') : t('Medinan')}
          </Text>
        </View>
        <Text style={[styles.arabic, { color: palette.text }]}>{item.name}</Text>
      </Pressable>
    ),
    [openSurah, palette, t, arabic],
  );

  return (
    <View style={styles.root}>
      <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Ionicons name="search" size={16} color={palette.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('Search surah name, meaning or number')}
          placeholderTextColor={palette.textMuted}
          style={[styles.searchInput, { color: palette.text }]}
          accessibilityLabel={t('Search surahs')}
        />
      </View>

      {resume !== null ? (
        <Pressable
          onPress={() => {
            // The word itself, not the start of its ayah — in 2:282, the
            // longest, that start can be a hundred words before where the
            // reciter stopped. No ayah in the route, so nothing re-seeks.
            seekTo(resume.cursor);
            router.push({ pathname: '/surah/[id]', params: { id: String(surahOf(resume.cursor)) } });
          }}
          accessibilityRole="button"
          accessibilityLabel={t('Continue where you left off')}
          style={[styles.resume, { backgroundColor: palette.primary }]}
        >
          <Ionicons name="play" size={16} color={palette.paper} />
          <Text style={[styles.resumeText, { color: palette.paper }]}>
            {t('Continue {where}', { where: describe(resume.cursor, lang) })}
          </Text>
        </Pressable>
      ) : null}

      <FlatList
        data={filtered}
        keyExtractor={(s) => String(s.number)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <GoToRow
            onJumpJuz={(juz) => {
              const start = juzStart(juz);
              seekTo(start.word);
              setViewedPage(start.page);
              open(start.surah, start.ayah);
            }}
            onJumpHizb={(hizb) => {
              const start = hizbStart(hizb);
              seekTo(start.word);
              setViewedPage(start.page);
              open(start.surah, start.ayah);
            }}
            palette={palette}
            t={t}
          />
        }
        initialNumToRender={12}
        windowSize={7}
      />
    </View>
  );
}

function describe(cursor: number, lang: Lang): string {
  const ayah = ayahByGlobal(globalAyahOf(cursor));
  return `${surahName(ayah.surah, lang)} ${ayah.surah}:${ayah.ayah}`;
}

/**
 * Two doors, "Go to juz" and "Go to hizb", each opening a small panel with a
 * number field.
 *
 * They replace a grid of thirty numbered squares, which filled the top third of
 * the screen to serve a tap most people make rarely, and could not have grown to
 * sixty for hizb without swallowing the surah list entirely.
 */
function GoToRow({
  onJumpJuz,
  onJumpHizb,
  palette,
  t,
}: {
  onJumpJuz: (juz: number) => void;
  onJumpHizb: (hizb: number) => void;
  palette: Palette;
  t: T;
}) {
  const [open, setOpen] = useState<'juz' | 'hizb' | null>(null);

  return (
    <View style={styles.goWrap}>
      <View style={styles.goRow}>
        <GoButton
          label={t('Go to juz')}
          icon="bookmark-outline"
          active={open === 'juz'}
          onPress={() => setOpen((was) => (was === 'juz' ? null : 'juz'))}
          palette={palette}
        />
        <GoButton
          label={t('Go to hizb')}
          icon="bookmarks-outline"
          active={open === 'hizb'}
          onPress={() => setOpen((was) => (was === 'hizb' ? null : 'hizb'))}
          palette={palette}
        />
      </View>

      {open === 'juz' ? (
        <NumberPanel
          placeholder={t('Juz number, 1 to {max}', { max: TOTAL_JUZ })}
          max={TOTAL_JUZ}
          onGo={(n) => {
            setOpen(null);
            onJumpJuz(n);
          }}
          palette={palette}
          t={t}
        />
      ) : null}

      {open === 'hizb' ? (
        <NumberPanel
          placeholder={t('Hizb number, 1 to {max}', { max: TOTAL_HIZB })}
          max={TOTAL_HIZB}
          onGo={(n) => {
            setOpen(null);
            onJumpHizb(n);
          }}
          palette={palette}
          t={t}
        />
      ) : null}
    </View>
  );
}

function GoButton({
  label,
  icon,
  active,
  onPress,
  palette,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  palette: Palette;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: active }}
      accessibilityLabel={label}
      style={[
        styles.goButton,
        {
          backgroundColor: active ? palette.primary : palette.surface,
          borderColor: active ? palette.primary : palette.border,
        },
      ]}
    >
      {/* paper on primary, not white: the night palette's primary is a light
          green, and white on it measured 2.0:1 */}
      <Ionicons name={icon} size={16} color={active ? palette.paper : palette.primary} />
      <Text style={[styles.goText, { color: active ? palette.paper : palette.text }]}>{label}</Text>
      <Ionicons
        name={active ? 'chevron-up' : 'chevron-down'}
        size={14}
        color={active ? palette.paper : palette.textMuted}
      />
    </Pressable>
  );
}

/** A number field that only accepts a number in range, and says so when it does not. */
function NumberPanel({
  placeholder,
  max,
  onGo,
  palette,
  t,
}: {
  placeholder: string;
  max: number;
  onGo: (n: number) => void;
  palette: Palette;
  t: T;
}) {
  const [value, setValue] = useState('');
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= max;

  return (
    <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.panelRow}>
        <TextInput
          value={value}
          onChangeText={(next) => setValue(next.replace(/[^0-9]/g, '').slice(0, 3))}
          placeholder={placeholder}
          placeholderTextColor={palette.textMuted}
          keyboardType="number-pad"
          returnKeyType="go"
          onSubmitEditing={() => valid && onGo(n)}
          accessibilityLabel={placeholder}
          style={[styles.panelInput, { color: palette.text, borderColor: palette.border }]}
        />
        <Pressable
          onPress={() => valid && onGo(n)}
          disabled={!valid}
          accessibilityRole="button"
          accessibilityLabel={t('Go')}
          style={[
            styles.panelGo,
            { backgroundColor: valid ? palette.primary : palette.border },
          ]}
        >
          <Ionicons name="arrow-forward" size={18} color={valid ? palette.paper : palette.textMuted} />
        </Pressable>
      </View>
      {value.length > 0 && !valid ? (
        <Text style={[styles.panelNote, { color: palette.error }]}>
          {t('Enter a number from 1 to {max}.', { max })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  goWrap: { gap: space.sm, marginBottom: space.sm },
  goRow: { flexDirection: 'row', gap: space.sm },
  goButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
  },
  goText: { fontSize: 13, fontWeight: '700' },
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.sm,
    gap: space.xs,
  },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  panelInput: {
    flex: 1,
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 10,
  },
  panelGo: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelNote: { fontSize: 11, lineHeight: 16 },
  root: { flex: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    margin: space.md,
    marginBottom: space.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.md,
    marginBottom: space.sm,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 11,
  },
  resumeText: { fontSize: 14, fontWeight: '700' },
  list: { paddingHorizontal: space.md, paddingBottom: space.xl, gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
  },
  numberBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: { fontSize: 12, fontWeight: '700' },
  rowMain: { flex: 1 },
  translit: { fontSize: 15, fontWeight: '600' },
  translation: { fontSize: 11, marginTop: 1 },
  arabic: { fontFamily: 'Amiri_700Bold', fontSize: 20 },
});
