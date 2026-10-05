/**
 * The adhan library, on its own screen.
 *
 * A list of recordings with a play button each is not a setting — it is a place
 * you go to, look around, listen, and choose. It lived inside the prayer tab as
 * an expander and pushed the prayer times off the screen the moment it opened,
 * which is the wrong trade: the times are what that tab is for.
 */
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAdhan } from '../src/context/AdhanProvider';
import { forgetChosenAdhan, formatSize, pickAdhanFile } from '../src/data/adhanFile';
import {
  library,
  nameFromFile,
  nextAdhanId,
  selectedAdhan,
  type AdhanEntry,
} from '../src/data/adhanLibrary';
import { adhanName } from '../src/i18n/names';
import { useT } from '../src/i18n/useT';
import { useTheme } from '../src/theme/ThemeProvider';
import { radius, space } from '../src/theme/theme';

export default function AdhanScreen() {
  const { palette, prefs, setPrefs } = useTheme();
  const { t, lang } = useT();
  const { previewEntry, previewingId, stopPreview } = useAdhan();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * A preview stops when the screen is left.
   *
   * The player lives above the router, and a preview raises no banner, so a
   * recording started here and abandoned with Back played on through the rest
   * of the app — three and a half minutes of it — with its only Stop button on
   * the screen just left. Read through a ref so leaving checks what is playing
   * then: a prayer-time adhan that took over meanwhile clears `previewingId`,
   * and is not this screen's to stop.
   */
  const previewing = useRef(previewingId);
  previewing.current = previewingId;
  useEffect(
    () => () => {
      if (previewing.current !== null) stopPreview();
    },
    [stopPreview],
  );

  const entries = library(prefs.addedAdhans);
  const selected = selectedAdhan(prefs.addedAdhans, prefs.adhanSelectedId);

  const add = () => {
    setPicking(true);
    setError(null);
    void pickAdhanFile(t)
      .then((result) => {
        if (result.chosen !== null) {
          const id = nextAdhanId(prefs.addedAdhans);
          setPrefs({
            addedAdhans: [
              ...prefs.addedAdhans,
              {
                id,
                name: nameFromFile(result.chosen.name),
                fileName: result.chosen.name,
                detail: formatSize(result.chosen.sizeBytes),
                uri: result.chosen.uri,
              },
            ],
            adhanSelectedId: id,
          });
        } else if (result.detail.length > 0) {
          setError(result.detail);
        }
      })
      .finally(() => setPicking(false));
  };

  const remove = (entry: AdhanEntry) => {
    void forgetChosenAdhan(entry.uri);
    setPrefs({
      addedAdhans: prefs.addedAdhans.filter((a) => a.id !== entry.id),
      adhanSelectedId: entry.id === selected?.id ? null : prefs.adhanSelectedId,
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const active = item.id === selected?.id;
          const name = adhanName(item, t, lang);
          const sounding = item.id === previewingId;
          return (
            <View
              style={[
                styles.row,
                {
                  backgroundColor: active ? palette.successSoft : palette.surface,
                  borderColor: active ? palette.success : palette.border,
                },
              ]}
            >
              <Pressable
                onPress={() => setPrefs({ adhanSelectedId: item.id })}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t('Use {name} at prayer time', { name })}
                style={styles.main}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={active ? palette.success : palette.textMuted}
                />
                <Text style={[styles.name, { color: palette.text }]}>{name}</Text>
              </Pressable>

              {item.builtIn ? null : (
                <Pressable
                  onPress={() => remove(item)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('Remove {name}', { name })}
                  style={styles.action}
                >
                  <Ionicons name="trash-outline" size={20} color={palette.error} />
                </Pressable>
              )}

              {/**
                * The button is the whole interface: it plays, it shows that it is
                * playing, and pressing it again stops. No banner over the top —
                * the user is looking straight at the control they just pressed.
                */}
              <Pressable
                onPress={() => (sounding ? stopPreview() : previewEntry(item))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={sounding ? t('Stop {name}', { name }) : t('Play {name}', { name })}
                style={[styles.action, styles.play, { borderColor: palette.primary }]}
              >
                <Ionicons name={sounding ? 'stop' : 'play'} size={18} color={palette.primary} />
              </Pressable>
            </View>
          );
        }}
        ListFooterComponent={
          <View style={styles.footer}>
            <Pressable
              onPress={add}
              disabled={picking}
              accessibilityRole="button"
              accessibilityLabel={t('Add an adhan from this phone')}
              style={[styles.add, { borderColor: palette.primary }]}
            >
              <Ionicons name="add" size={18} color={palette.primary} />
              <Text style={[styles.addText, { color: palette.primary }]}>
                {picking ? t('Choosing…') : t('Add adhan')}
              </Text>
            </Pressable>

            {error !== null ? (
              <Text style={[styles.meta, { color: palette.error }]}>{error}</Text>
            ) : null}

            {/* Only when it matters: a recording the reader added plays inside
                the app, but a notification's sound has to be built into the app,
                so with the app closed the built-in adhan sounds instead. Said
                here, once chosen, rather than discovered at Fajr. */}
            {selected !== null && !selected.builtIn ? (
              <Text style={[styles.meta, { color: palette.textMuted }]}>
                {t('Plays when Tasmee Hifz is open. With the app closed, the notification uses the built-in adhan.')}
              </Text>
            ) : null}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: space.md, gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flex: 1, fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 11, lineHeight: 16, marginTop: 1 },
  action: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  play: { borderWidth: 1 },
  footer: { gap: space.sm, marginTop: space.sm },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.md,
  },
  addText: { fontSize: 14, fontWeight: '700' },
});
