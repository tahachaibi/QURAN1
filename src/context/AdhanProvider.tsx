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
  /** true when audio is actually playing */
  playing: boolean;
  /** why it is not playing, when it is not; null when all is well */
  note: string | null;
  /** true when this is the user testing the sound, not an actual prayer time */
  preview: boolean;
  /** silence it and take the banner away */
  dismiss: () => void;
  /** play (again) — used by the banner when auto-play was held back */
  play: (prayer: PrayerName) => void;
  /**
   * Sound it now, on demand, so the user can hear what the adhan will do and find
   * the Stop button before Fajr rather than during it.
   */
  test: (prayer: PrayerName) => void;
}

const AdhanContext = createContext<AdhanContextValue | null>(null);

export function AdhanProvider({ children }: { children: ReactNode }) {
  const { prefs } = useTheme();
  const { session } = useRecitation();
  const [timings, setTimings] = useState<Record<string, string> | null>(null);
  const [prayer, setPrayer] = useState<PrayerName | null>(null);
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

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
  const begin = useCallback((describe: boolean) => {
    setNote(null);
    void playAdhan(
      () => {
        setPlaying(false);
        setPrayer(null);
        setPreview(false);
      },
      // Accepted but not advancing: the case that looks exactly like a working
      // adhan with the volume down, and the one worth naming out loud.
      (detail) => setNote(detail),
    ).then((result) => {
      setPlaying(result.ok);
      if (!result.ok) {
        setNote(result.detail);
        return;
      }
      if (!describe) return;
      /**
       * A successful start is not the same as a sound you can hear. The adhan
       * plays on the MEDIA stream, which has its own volume and its own mute, so
       * a phone with media at zero plays a perfect silent adhan.
       */
      const length =
        result.durationMs === null
          ? 'the recording'
          : `${Math.floor(result.durationMs / 60000)}:${String(
              Math.floor((result.durationMs % 60000) / 1000),
            ).padStart(2, '0')} of adhan`;
      /**
       * Say what the OPERATING SYSTEM reports about output, not just what the
       * player claims. "Playing 3:59" with no sound was reported once, and from
       * inside a media player that is indistinguishable from working — so the
       * volume, the audio mode and the output route go on screen.
       */
      setNote(
        result.output === null
          ? `Playing ${length}. If you hear nothing, raise the MEDIA volume — not the ringer.`
          : `Playing ${length} · ${result.output}`,
      );
    });
  }, []);

  const start = useCallback(
    (which: PrayerName, key: string) => {
      sounded.current = key;
      setPrayer(which);
      setPreview(false);
      if (!hasAdhanSound) {
        setPlaying(false);
        setNote('No adhan recording is bundled in this build yet, so this notice is silent.');
        return;
      }
      if (listening.current) {
        // Playing the adhan into a live microphone would make the app follow its
        // own loudspeaker. The banner offers the button instead.
        setPlaying(false);
        setNote('You are reciting — stop the session first, then tap Play adhan.');
        return;
      }
      begin(false);
    },
    [begin],
  );

  const dismiss = useCallback(() => {
    void stopAdhan();
    setPlaying(false);
    setPrayer(null);
    setNote(null);
    setPreview(false);
  }, []);

  const play = useCallback(
    (which: PrayerName) => {
      setPrayer(which);
      setPreview(false);
      begin(false);
    },
    [begin],
  );

  const test = useCallback(
    (which: PrayerName) => {
      setPreview(true);
      setPrayer(which);
      if (!hasAdhanSound) {
        setPlaying(false);
        setNote('No adhan recording is bundled in this build yet, so there is nothing to hear.');
        return;
      }
      begin(true);
    },
    [begin],
  );

  /**
   * The timer. Re-armed after every check rather than set once per prayer: a
   * single long timeout is exactly what Android's doze mode does not honour.
   */
  useEffect(() => {
    if (!prefs.adhanNotification || timings === null) return;
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
  }, [prefs.adhanNotification, timings, start]);

  /** A notification arriving, or being tapped, is the other way in. */
  useEffect(() => {
    if (!prefs.adhanNotification) return;

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
  }, [prefs.adhanNotification, start]);

  /** Never leave audio running behind a closed app. */
  useEffect(() => () => void stopAdhan(), []);

  return (
    <AdhanContext.Provider value={{ prayer, playing, note, preview, dismiss, play, test }}>
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
