/**
 * Sounding the adhan at prayer time, and giving the user one obvious way to stop
 * it (§8).
 *
 * Mounted above the router, next to RecitationProvider, for the same reason: the
 * adhan is not a property of a screen. Maghrib arrives while you are reading
 * hadith, or on the tracker, or nowhere in particular, and the banner has to be
 * able to appear over any of them and survive navigation.
 *
 * Three things can start it, all of them converging on one key per prayer per day
 * so that it is sounded at most once:
 *   - the timer, when the app is open at the moment of the adhan
 *   - an adhan notification arriving while the app is open (its own sound is
 *     muted in that case, see installForegroundBehaviour)
 *   - the user tapping that notification, which is how a closed app gets here
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';

import { hasAdhanSound } from '../data/adhan';
import { selectedAdhan, type AdhanEntry } from '../data/adhanLibrary';
import { playAdhan, stopAdhan } from '../data/adhanPlayer';
import { adhanKey, dueAdhan, msUntilCheck, timingsAreUsable } from '../data/adhanTimer';
import { installForegroundBehaviour, payloadOf } from '../data/notifications';
import { loadPrayerCache } from '../data/storage';
import { adjustTimings } from '../data/prayerOffsets';
import { type PrayerName } from '../data/prayerTimes';
import { useRecitation } from './RecitationProvider';
import { useTheme } from '../theme/ThemeProvider';

/** How late a TAP on the notification may still start the adhan. */
const TAP_GRACE_MS = 10 * 60_000;

export interface AdhanContextValue {
  /** the prayer being announced, or null when nothing is being announced */
  prayer: PrayerName | null;
  /** silence the adhan and take the banner away */
  dismiss: () => void;
  /**
   * Play one entry from the library WITHOUT raising the banner.
   *
   * On the adhan screen the row's own play button is already the control and
   * already shows the state, so a banner over the top would be a second copy of
   * something the user is looking at. The banner is for a prayer time, which
   * arrives unasked; this is a button pressed on purpose.
   */
  previewEntry: (entry: AdhanEntry) => void;
  /** the entry currently sounding as a preview, so its row can show Stop */
  previewingId: string | null;
  stopPreview: () => void;
}

const AdhanContext = createContext<AdhanContextValue | null>(null);

export function AdhanProvider({ children }: { children: ReactNode }) {
  const { prefs } = useTheme();
  const { session } = useRecitation();
  const [timings, setTimings] = useState<Record<string, string> | null>(null);
  const [prayer, setPrayer] = useState<PrayerName | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  /** The adhan already sounded, so none is sounded twice. */
  const sounded = useRef<string | null>(null);
  /**
   * Recitation status read through a ref: the timer effect must not be torn down
   * and rebuilt every time the session changes, or a start/stop during the last
   * seconds before the adhan would reset the countdown.
   */
  const listening = useRef(false);
  listening.current = session.status === 'listening';

  useEffect(() => {
    installForegroundBehaviour();
  }, []);

  /**
   * Today's times, from the cache the prayer tab writes.
   *
   * The cache holds the API's raw answer, so the user's per-prayer corrections
   * have to be applied HERE too. Miss this and the adhan sounds at the
   * astronomical time while the tab displays the corrected one — the same bug in
   * two places, disagreeing with each other.
   */
  const refreshTimings = useCallback(async () => {
    const cache = await loadPrayerCache();
    if (cache === null) {
      setTimings(null);
      return;
    }
    if (!timingsAreUsable(cache.day, new Date())) {
      setTimings(null);
      return;
    }
    setTimings(adjustTimings(cache.timings, prefs.prayerOffsets));
  }, [prefs.prayerOffsets]);

  useEffect(() => {
    void refreshTimings();
    const sub = AppState.addEventListener('change', (state) => {
      // Only 'background' means gone (Android reports 'inactive' transiently).
      if (state === 'active') void refreshTimings();
    });
    return () => sub.remove();
  }, [refreshTimings]);

  /**
   * The one place playback is started, so the three ways in cannot drift apart.
   *
   * `describe` asks for the diagnostic line — used by the Hear-it-now test, where
   * the whole point is to find out what the phone did. A real adhan at a real
   * prayer time stays quiet about internals unless something went wrong.
   */
  /**
   * The one place a prayer-time adhan is started, so the ways in cannot drift.
   *
   * It no longer reports what it did. The diagnostics that used to come back here
   * — duration, media volume, audio mode, output route — existed to find one bug:
   * a phone stuck in communication mode routing media to the earpiece. That is
   * found, and fixed in the player. Instrumentation earns its place while
   * something is broken and becomes clutter the moment it is not.
   */
  const begin = useCallback(
    (entry?: AdhanEntry) => {
      void playAdhan(
        entry ?? selectedAdhan(prefs.addedAdhans, prefs.adhanSelectedId),
        () => setPrayer(null),
      );
    },
    [prefs.addedAdhans, prefs.adhanSelectedId],
  );

  const start = useCallback(
    (which: PrayerName, key: string) => {
      sounded.current = key;
      setPrayer(which);
      /**
       * The bell for this prayer decides whether it is HEARD, not whether it is
       * SEEN. A prayer with its bell off still raises the banner — the reciter
       * asked to be told, not to be shouted at — it just does not play.
       */
      if (prefs.bells[which] === false) return;
      if (!hasAdhanSound && prefs.addedAdhans.length === 0) return;
      if (listening.current) {
        // Playing the adhan into a live microphone would make the app follow its
        // own loudspeaker.
        return;
      }
      begin();
    },
    [begin, prefs.addedAdhans, prefs.bells],
  );

  const dismiss = useCallback(() => {
    void stopAdhan();
    setPrayer(null);
    setPreviewingId(null);
  }, []);

  const previewEntry = useCallback((entry: AdhanEntry) => {
    setPreviewingId(entry.id);
    void playAdhan(entry, () => setPreviewingId(null)).then((result) => {
      if (!result.ok) setPreviewingId(null);
    });
  }, []);

  const stopPreview = useCallback(() => {
    setPreviewingId(null);
    void stopAdhan();
  }, []);

  /**
   * The timer. Re-armed after every check rather than set once per prayer: a
   * single long timeout is exactly what Android's doze mode does not honour.
   */
  useEffect(() => {
    // No global on/off any more: a bell per prayer replaced it, and a prayer
    // with its bell off still raises a silent notice, so the timer always runs.
    if (timings === null) return;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      if (cancelled) return;
      const now = new Date();
      const due = dueAdhan(timings, now, sounded.current);
      if (due !== null) start(due.prayer, due.key);
      handle = setTimeout(tick, msUntilCheck(timings, now));
    };
    tick();

    return () => {
      cancelled = true;
      if (handle !== undefined) clearTimeout(handle);
    };
  }, [timings, start]);

  /** A notification arriving, or being tapped, is the other way in. */
  useEffect(() => {
    const consider = (notification: Notifications.Notification, graceMs: number) => {
      const payload = payloadOf(notification);
      if (payload === null || payload.kind !== 'adhan') return;
      const at = new Date(payload.at);
      if (Number.isNaN(at.getTime())) return;
      const late = Date.now() - at.getTime();
      if (late < -30_000 || late > graceMs) return;
      const key = adhanKey(payload.prayer, at);
      if (key === sounded.current) return;
      /**
       * Take the notification down BEFORE playing. Its own sound is the bundled
       * adhan, and on Android a posted notification's sound stops when the
       * notification goes away — without this, opening the app from the
       * notification means hearing the adhan twice, half a second apart.
       */
      void Notifications.dismissNotificationAsync(notification.request.identifier).catch(
        () => undefined,
      );
      start(payload.prayer, key);
    };

    const received = Notifications.addNotificationReceivedListener((n) => consider(n, TAP_GRACE_MS));
    const responded = Notifications.addNotificationResponseReceivedListener((response) =>
      consider(response.notification, TAP_GRACE_MS),
    );
    // The tap that launched the app cold: no listener was mounted when it arrived.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response !== null) consider(response.notification, TAP_GRACE_MS);
    });

    return () => {
      received.remove();
      responded.remove();
    };
  }, [start]);

  /** Never leave audio running behind a closed app. */
  useEffect(() => () => void stopAdhan(), []);

  return (
    <AdhanContext.Provider value={{ prayer, dismiss, previewEntry, previewingId, stopPreview }}>
      {children}
    </AdhanContext.Provider>
  );
}

export function useAdhan(): AdhanContextValue {
  const value = useContext(AdhanContext);
  if (value === null) {
    throw new Error('useAdhan was called outside AdhanProvider, which belongs in app/_layout.tsx.');
  }
  return value;
}
