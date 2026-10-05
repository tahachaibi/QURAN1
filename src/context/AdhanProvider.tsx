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
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';

import { ADHAN_SOUND, hasAdhanSound } from '../data/adhan';
import { selectedAdhan, type AdhanEntry } from '../data/adhanLibrary';
import { playAdhan, stopAdhan } from '../data/adhanPlayer';
import { adhanKey, dueAdhan, MAX_SLEEP_MS, msUntilCheck, timingsForToday } from '../data/adhanTimer';
import {
  cachedDays,
  dismissPresentedAdhan,
  installForegroundBehaviour,
  payloadOf,
  requestPermission,
  rescheduleAll,
  upcomingDays,
  type PrayerDayTimes,
} from '../data/notifications';
import { fetchPrayerTimes } from '../data/prayer';
import { loadPrayerCache, today } from '../data/storage';
import { adjustTimings } from '../data/prayerOffsets';
import { type PrayerName } from '../data/prayerTimes';
import { useRecitation } from './RecitationProvider';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n/useT';

/**
 * How late a TAP on the notification may still start the adhan — and how long a
 * banner that is not sounding anything stays up before taking itself away.
 */
const TAP_GRACE_MS = 10 * 60_000;

/**
 * Why there are no prayer notifications, in words for the user.
 *
 * Two different problems with two different ways out, so they say which they
 * are. They used to be one string, and the tab drew both alike — so the saved
 * times running out came with an "Open settings" button and a paragraph about
 * notification permission, sending people to a settings page where nothing was
 * wrong.
 */
export interface ScheduleProblem {
  /** 'permission': notifications are refused; 'stale': no saved time is still to come */
  kind: 'permission' | 'stale';
  text: string;
}

export interface AdhanContextValue {
  /** the prayer being announced, or null when nothing is being announced */
  prayer: PrayerName | null;
  /**
   * True while the adhan is actually playing for `prayer`.
   *
   * The banner is also raised for a prayer whose bell is off, while the
   * microphone is live, and when playback failed — and then there is nothing to
   * stop, so the banner must not offer to.
   */
  sounding: boolean;
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
  /**
   * Why there are no prayer notifications, or null when they are scheduled.
   *
   * Scheduling lives here rather than on the prayer tab, so the tab reads the
   * outcome instead of owning it — see the scheduling effect below.
   */
  scheduleError: ScheduleProblem | null;
  /**
   * Read the saved times again, and with them re-check the notification
   * permission and rebuild the schedule.
   *
   * For the prayer tab to call once it has saved new times. Nothing told this
   * provider before, so the first times ever fetched, or the new city's after
   * "Refresh my location", were not scheduled until the app had been to the
   * background and back — and "Check again" re-checked nothing.
   */
  refresh: () => Promise<void>;
}

const AdhanContext = createContext<AdhanContextValue | null>(null);

export function AdhanProvider({ children }: { children: ReactNode }) {
  const { prefs } = useTheme();
  const { t, lang } = useT();
  const { session } = useRecitation();
  /**
   * Every saved day, each with its own date, already corrected by the user's
   * offsets; null when nothing has ever been saved.
   *
   * Several days, not one. With only today's times there was nothing to
   * schedule after Isha, so tomorrow's Fajr was never scheduled, and on a day
   * the times were not fetched every prayer was filed under yesterday and
   * dropped as past.
   */
  const [days, setDays] = useState<PrayerDayTimes[] | null>(null);
  const [prayer, setPrayer] = useState<PrayerName | null>(null);
  const [sounding, setSounding] = useState(false);
  const [scheduleError, setScheduleError] = useState<ScheduleProblem | null>(null);
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
  /** Takes down a banner that is not sounding anything; see `start`. */
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** `sounding`, for that timer to read when it fires rather than when it was set. */
  const soundingRef = useRef(false);
  soundingRef.current = sounding;
  /** A background refresh in flight, so a quick return to the app does not start a second. */
  const toppingUp = useRef(false);

  useEffect(() => {
    installForegroundBehaviour();
  }, []);

  /**
   * The saved days, from the cache the prayer tab and `topUp` write.
   *
   * The cache holds the API's raw answer, so the user's per-prayer corrections
   * have to be applied HERE too. Miss this and the adhan sounds at the
   * astronomical time while the tab displays the corrected one — the same bug in
   * two places, disagreeing with each other.
   */
  const refreshTimings = useCallback(async () => {
    const cache = await loadPrayerCache();
    setDays(
      cache === null
        ? null
        : cachedDays(cache).map((day) => ({ date: day.date, timings: adjustTimings(day.timings, prefs.prayerOffsets) })),
    );
  }, [prefs.prayerOffsets]);
  /**
   * The same, under one identity for the life of the provider. The prayer tab
   * builds its loader on it, and a loader rebuilt on every minute-correction tap
   * would fetch the times again on every tap.
   */
  const latestRefresh = useRef(refreshTimings);
  latestRefresh.current = refreshTimings;
  const refresh = useCallback(() => latestRefresh.current(), []);

  /**
   * Keep the saved days topped up, from wherever the app is open.
   *
   * The prayer tab used to be the only thing that ever fetched, and the app opens
   * on the Quran tab — so somebody who recited every day but rarely pressed
   * Prayer ran out of scheduled days, and kept the old city's times after
   * travelling. Once a day, quietly: `quiet` never asks for a permission or
   * shows a dialog. And only once the prayer tab has fetched at least once,
   * because that first time is where the location and notification questions
   * are asked, in context, rather than out of nowhere at launch.
   */
  const topUp = useCallback(async () => {
    if (toppingUp.current) return;
    const cache = await loadPrayerCache();
    if (cache === null || cache.day === today()) return;
    toppingUp.current = true;
    try {
      await fetchPrayerTimes({ quiet: true, t, lang });
    } catch {
      // Nothing to say from here: the prayer tab explains problems when it is opened.
    } finally {
      toppingUp.current = false;
    }
    await refreshTimings();
  }, [refreshTimings, t, lang]);

  useEffect(() => {
    void refreshTimings().then(topUp);
    const sub = AppState.addEventListener('change', (state) => {
      // Only 'background' means gone (Android reports 'inactive' transiently).
      if (state === 'active') void refreshTimings().then(topUp);
    });
    return () => sub.remove();
  }, [refreshTimings, topUp]);

  const clearQuietTimer = useCallback(() => {
    if (quietTimer.current !== null) clearTimeout(quietTimer.current);
    quietTimer.current = null;
  }, []);

  /**
   * The one place a prayer-time adhan is started, so the ways in cannot drift.
   *
   * It no longer reports what it did. The diagnostics that used to come back here
   * — duration, media volume, audio mode, output route — existed to find one bug:
   * a phone stuck in communication mode routing media to the earpiece. That is
   * found, and fixed in the player. Instrumentation earns its place while
   * something is broken and becomes clutter the moment it is not.
   */
  const begin = useCallback(() => {
    // A prayer-time adhan replaces any preview, so that row stops showing Stop —
    // and the adhan screen, which stops a preview when it is left, does not
    // silence the real adhan by mistake.
    setPreviewingId(null);
    setSounding(true);
    void playAdhan(selectedAdhan(prefs.addedAdhans, prefs.adhanSelectedId), () => {
      setSounding(false);
      setPrayer(null);
    }).then((result) => {
      // Nothing came out: the banner stays as a silent notice, and goes the way
      // every silent one does.
      if (!result.ok) setSounding(false);
    });
  }, [prefs.addedAdhans, prefs.adhanSelectedId]);

  const start = useCallback(
    (which: PrayerName, key: string) => {
      sounded.current = key;
      /**
       * Whatever the system is already playing goes first. With the phone locked
       * the notification sounds its own adhan and the app is never told; unlock
       * within the grace window and the timer starts the app's adhan too — two at
       * once, and Stop silenced only one. Before the bell and microphone checks,
       * because a prayer that must stay quiet must not be left sounding either.
       */
      void dismissPresentedAdhan();
      setPrayer(which);
      setSounding(false);
      /**
       * A banner that sounds nothing — bell off, microphone live, playback
       * failed — used to stay over the header and the back button on every
       * screen until tapped. It is a notice, so it takes itself away; a playing
       * adhan clears it when it ends.
       */
      clearQuietTimer();
      quietTimer.current = setTimeout(() => {
        quietTimer.current = null;
        setPrayer((current) => (current === which && !soundingRef.current ? null : current));
      }, TAP_GRACE_MS);
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
    [begin, clearQuietTimer, prefs.addedAdhans, prefs.bells],
  );

  const dismiss = useCallback(() => {
    void stopAdhan();
    // The system's copy too, or Stop leaves the notification's adhan playing.
    void dismissPresentedAdhan();
    clearQuietTimer();
    setPrayer(null);
    setSounding(false);
    setPreviewingId(null);
  }, [clearQuietTimer]);

  const previewEntry = useCallback(
    (entry: AdhanEntry) => {
      // Playing anything stops whatever was playing, a prayer's adhan included,
      // and its banner must not stay behind offering to stop a silence.
      clearQuietTimer();
      setPrayer(null);
      setSounding(false);
      setPreviewingId(entry.id);
      void playAdhan(entry, () => setPreviewingId(null)).then((result) => {
        if (!result.ok) setPreviewingId(null);
      });
    },
    [clearQuietTimer],
  );

  const stopPreview = useCallback(() => {
    setPreviewingId(null);
    void stopAdhan();
  }, []);

  /**
   * Scheduling the prayer notifications — HERE, not on the prayer tab.
   *
   * It used to live in app/(tabs)/index.tsx, whose effect was the only caller of
   * `rescheduleAll` in the whole app. The app opens on the Quran tab
   * (app/index.tsx redirects there), so anyone who read Quran, listened, or used
   * the tracker and never pressed Prayer had NO prayer notifications scheduled at
   * all, and nothing on screen to tell them. This provider is mounted above the
   * router and already refreshes on every foreground, which is exactly the
   * lifetime a schedule wants.
   *
   * Every saved day from today on is passed, each with the date it belongs to,
   * up to MAX_DAYS_AHEAD — so tonight already holds tomorrow's Fajr, and a week
   * without opening the app still has its adhan. A day is only scheduled if its
   * own times were fetched: `planNotifications` never copies one day's times
   * onto another, and drops anything already past.
   */
  useEffect(() => {
    if (days === null) return;
    let cancelled = false;
    void (async () => {
      const granted = await requestPermission();
      if (cancelled) return;
      if (!granted) {
        setScheduleError({
          kind: 'permission',
          text: t(
            'Notifications are turned off for Tasmee Hifz, so the adhan and reminders cannot reach you while the app is closed. Turn them on in Settings > Apps > Tasmee Hifz > Notifications.',
          ),
        });
        return;
      }
      const set = await rescheduleAll(
        {
          days: upcomingDays(days),
          warnBefore: prefs.prayerWarning,
          // Always planned; the bells decide which of them make a sound.
          adhan: true,
          bells: prefs.bells,
          lang,
        },
        hasAdhanSound ? ADHAN_SOUND : null,
      );
      // null: a newer rebuild replaced this one, and it reports for itself.
      if (cancelled || set === null) return;
      setScheduleError(
        set === 0
          ? {
              kind: 'stale',
              text: t(
                'The saved prayer times have run out, so no prayer notifications are scheduled. Connect to the internet and refresh them.',
              ),
            }
          : null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [days, prefs.prayerWarning, prefs.bells, lang, t]);

  /**
   * The timer. Re-armed after every check rather than set once per prayer: a
   * single long timeout is exactly what Android's doze mode does not honour.
   *
   * Each check takes the times for the day it is ON, so the timer follows the
   * calendar across midnight by itself instead of applying yesterday's times to
   * today until the app next comes to the foreground.
   */
  useEffect(() => {
    // No global on/off any more: a bell per prayer replaced it, and a prayer
    // with its bell off still raises a silent notice, so the timer always runs.
    if (days === null) return;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      if (cancelled) return;
      const now = new Date();
      const timings = timingsForToday(days, now);
      if (timings !== null) {
        const due = dueAdhan(timings, now, sounded.current);
        if (due !== null) start(due.prayer, due.key);
      }
      handle = setTimeout(tick, timings === null ? MAX_SLEEP_MS : msUntilCheck(timings, now));
    };
    tick();

    return () => {
      cancelled = true;
      if (handle !== undefined) clearTimeout(handle);
    };
  }, [days, start]);

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

  /** Never leave audio running, or a timer pending, behind a closed app. */
  useEffect(
    () => () => {
      clearQuietTimer();
      void stopAdhan();
    },
    [clearQuietTimer],
  );

  /**
   * Memoised, and it has to be.
   *
   * This provider reads the live recitation session (it holds the adhan back
   * while the microphone is open), so it re-renders on every partial the
   * recogniser emits — about three a second while somebody is reciting. As an
   * inline object literal its value was therefore a NEW object three times a
   * second, and every useAdhan() consumer re-rendered with it: the banner, the
   * prayer tab, the adhan screen. None of their inputs had changed. The
   * recitation was simply being paid for twice.
   */
  const value = useMemo<AdhanContextValue>(
    () => ({
      prayer,
      sounding,
      dismiss,
      previewEntry,
      previewingId,
      stopPreview,
      scheduleError,
      refresh,
    }),
    [prayer, sounding, dismiss, previewEntry, previewingId, stopPreview, scheduleError, refresh],
  );

  return (
    <AdhanContext.Provider value={value}>
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
