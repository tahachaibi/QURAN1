/**
 * The adhan library, on its own screen.
 *
 * A list of recordings with a play button each is not a setting — it is a place
 * you go to, look around, listen, and choose. It lived inside the prayer tab as
 * an expander and pushed the prayer times off the screen the moment it opened,
 * which is the wrong trade: the times are what that tab is for.
 */
import { useState } from 'react';
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
import { useTheme } from '../src/theme/ThemeProvider';
import { radius, space } from '../src/theme/theme';

export default function AdhanScreen() {
  const { palette, prefs, setPrefs } = useTheme();
  const { playEntry, playing, dismiss } = useAdhan();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = library(prefs.addedAdhans);
  const selected = selectedAdhan(prefs.addedAdhans, prefs.adhanSelectedId);

  const add = () => {
    setPicking(true);
    setError(null);
    void pickAdhanFile()
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
        ListHeaderComponent={
          <Text style={[styles.intro, { color: palette.textMuted }]}>
            Tap a recording to use it at prayer time. Tap play to hear it — that changes nothing.
          </Text>
        }
        renderItem={({ item }) => {
          const active = item.id === selected?.id;
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
                accessibilityLabel={`Use ${item.name} at prayer time`}
                style={styles.main}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={active ? palette.success : palette.textMuted}
                />
                <View style={styles.text}>
                  <Text style={[styles.name, { color: palette.text }]}>{item.name}</Text>
                  <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                    {item.fileName} · {item.detail}
                  </Text>
                </View>
              </Pressable>

              {item.builtIn ? null : (
                <Pressable
                  onPress={() => remove(item)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.name}`}
                  style={styles.action}
                >
                  <Ionicons name="trash-outline" size={20} color={palette.error} />
                </Pressable>
              )}

              <Pressable
                onPress={() => (playing ? dismiss() : playEntry(item, 'Fajr'))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={playing ? 'Stop' : `Play ${item.name}`}
                style={[styles.action, styles.play, { borderColor: palette.primary }]}
              >
                <Ionicons name={playing ? 'stop' : 'play'} size={18} color={palette.primary} />
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
              accessibilityLabel="Add an adhan from this phone"
              style={[styles.add, { borderColor: palette.primary }]}
            >
              <Ionicons name="add" size={18} color={palette.primary} />
              <Text style={[styles.addText, { color: palette.primary }]}>
                {picking ? 'Choosing…' : 'Add adhan'}
              </Text>
            </Pressable>

            {error !== null ? (
              <Text style={[styles.meta, { color: palette.error }]}>{error}</Text>
            ) : null}

            <Text style={[styles.meta, { color: palette.textMuted }]}>
              An adhan you add plays in the app, with the Stop button. The notification for when the
              app is closed uses the included recording — Android fixes a notification&apos;s sound
              when the channel is made, and it has to come from inside the app.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: space.md, gap: space.sm },
  intro: { fontSize: 12, lineHeight: 18, marginBottom: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  text: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700' },
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
