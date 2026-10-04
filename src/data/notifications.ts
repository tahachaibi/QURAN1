/**
 * Prayer-time notifications (adhan and the five-minute warning).
 *
 * Everything here is scheduled LOCALLY on the device. There is no server, no
 * push token and no account, which keeps the app's promise that nothing leaves
 * the phone except prayer-time and audio requests.
 *
 * Scheduling is idempotent: the whole set is cancelled and rebuilt from the
 * current prayer times, so a rebuild can be triggered whenever the times change
 * without accumulating duplicates.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  CHANNEL_ADHAN,
  CHANNEL_SILENT,
  CHANNEL_WARNING,
  planNotifications,
  soundFor,
  type NotificationPayload,
  type ScheduleOptions,
} from './prayerSchedule';

export * from './prayerSchedule';

/**
 * Create the Android channels.
 *
 * The adhan channel's sound is set HERE and can never be changed afterwards —
 * Android freezes a channel's sound at creation, so changing it later requires a
 * new channel id. That is why the adhan sound is part of the channel identity.
 */
export async function ensureChannels(adhanSound: string | null, lang: 'en' | 'ar' = 'en'): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Names show in Android's own notification settings, so they follow the
  // interface language. Re-registering an existing id updates its name, and
  // only its name: the sound stays frozen as described above.
  const ar = lang === 'ar';
  await Notifications.setNotificationChannelAsync(CHANNEL_WARNING, {
    name: ar ? 'تذكير بالصلاة' : 'Prayer reminder',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250],
    enableVibrate: true,
  });
  /**
   * Prayer time with the bell off: seen, not heard. Importance DEFAULT rather
   * than HIGH so it does not push itself in front of anything — the point of
   * turning a bell off is to be left alone.
   */
  await Notifications.setNotificationChannelAsync(CHANNEL_SILENT, {
    name: ar ? 'وقت الصلاة (صامت)' : 'Prayer time (silent)',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
    enableVibrate: false,
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_ADHAN, {
    name: ar ? 'الأذان' : 'Adhan',
    importance: Notifications.AndroidImportance.MAX,
    // a bundled file name without extension, or 'default' when none is bundled
    sound: adhanSound ?? 'default',
    vibrationPattern: [0, 400, 200, 400],
    enableVibrate: true,
    bypassDnd: false,
  });
}

export async function requestPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/**
 * Cancel OUR scheduled notifications, leaving anything else alone.
 *
 * `cancelAllScheduledNotificationsAsync` cancels every pending notification the
 * app has. Today that is the same set, so this is not a bug fix — it is a
 * landmine removal. The moment anything else schedules a notification (a hifz
 * review reminder is the obvious next one), rebuilding the prayer schedule would
 * silently delete it, and the symptom would appear in a different feature.
 * Filtering on our own payload keeps rescheduling idempotent without claiming
 * ownership of the whole queue.
 */
async function cancelOurs(): Promise<number> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  let cancelled = 0;
  for (const item of scheduled) {
    const data = item.content.data as Partial<NotificationPayload> | null;
    if (data?.kind !== 'adhan' && data?.kind !== 'warning') continue;
    await Notifications.cancelScheduledNotificationAsync(item.identifier);
    cancelled += 1;
  }
  return cancelled;
}

/**
 * One rebuild at a time, and only the latest one asked for.
 *
 * A rebuild is a long run of native calls — channels, the list, a cancel each, a
 * schedule each — and the adhan provider starts one on every return to the app
 * and on every bell, warning or minute-correction tap. Two that overlapped
 * scheduled everything twice: the second listed the queue while the first was
 * still adding to it, so the first's later notifications survived beside the
 * second's whole set, and the adhan posted twice. So each run now waits for the
 * one before it, and a run that a newer request has replaced by the time its
 * turn comes is skipped: the newer one cancels and rebuilds everything anyway.
 */
let queue: Promise<unknown> = Promise.resolve();
let latest = 0;

/** Run `job` after everything already queued; one failure does not block the rest. */
function enqueue<R>(job: () => Promise<R>): Promise<R> {
  const run = queue.catch(() => undefined).then(job);
  queue = run;
  return run;
}

/**
 * Cancel ours and reschedule from scratch. Resolves to how many were set, or to
 * null when a later call replaced this one before it began — that later call's
 * count is then the one that describes the phone.
 */
export function rescheduleAll(options: ScheduleOptions, adhanSound: string | null): Promise<number | null> {
  const ticket = ++latest;
  return enqueue(() => (ticket === latest ? rebuild(options, adhanSound) : Promise.resolve(null)));
}

async function rebuild(options: ScheduleOptions, adhanSound: string | null): Promise<number> {
  await ensureChannels(adhanSound, options.lang);
  await cancelOurs();

  const planned = planNotifications(options);
  for (const item of planned) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: item.title,
        body: item.body,
        // null means "no sound at all": the notice for a prayer whose bell is
        // off. `false` is how expo-notifications spells silence in content.
        sound: soundFor(item.channel, adhanSound) ?? false,
        data: { ...item.data },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: item.at,
        channelId: item.channel,
      },
    });
  }
  return planned.length;
}

/**
 * Take every prayer notification down — ours only, for the same reason.
 *
 * In the same queue as the rebuilds, so one already running cannot put its
 * remaining notifications back afterwards; and it replaces any rebuild still
 * waiting, because it is the newer intention.
 */
export const cancelAll = (): Promise<void> => {
  ++latest;
  return enqueue(async () => {
    await cancelOurs();
  });
};

/**
 * Take down any adhan notification the system is showing right now.
 *
 * Its sound is the bundled adhan, played by the system rather than the app, and
 * on Android it stops only when the notification goes. With the phone locked the
 * app is never told one was posted, so when the app then sounds the adhan itself
 * — the reader unlocking within the grace window — or the reader presses Stop,
 * a posted one must be taken down too: otherwise two adhans play over each other
 * and Stop silences only one of them.
 */
export async function dismissPresentedAdhan(): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync().catch(
    (): Notifications.Notification[] => [],
  );
  for (const notification of presented) {
    if (payloadOf(notification)?.kind !== 'adhan') continue;
    await Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => undefined);
  }
}

/**
 * How a notification behaves when it arrives while the app is OPEN.
 *
 * The adhan notification is muted here, because in the foreground the app plays
 * the recording itself — in full, with a stop button. Without this you would hear
 * the truncated notification sound and the real adhan on top of each other.
 */
export function installForegroundBehaviour(): void {
  Notifications.setNotificationHandler({
    handleNotification: (notification) => {
      const data = notification.request.content.data as Partial<NotificationPayload> | null;
      const isAdhan = data?.kind === 'adhan';
      return Promise.resolve({
        // shouldShowAlert was split into banner and list in SDK 53.
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: !isAdhan,
        shouldSetBadge: false,
      });
    },
  });
}

/** Read the payload off a notification, or null when it is not one of ours. */
export function payloadOf(notification: Notifications.Notification): NotificationPayload | null {
  const data = notification.request.content.data as Partial<NotificationPayload> | null;
  if (data == null || (data.kind !== 'adhan' && data.kind !== 'warning')) return null;
  if (typeof data.prayer !== 'string' || typeof data.at !== 'string') return null;
  return { kind: data.kind, prayer: data.prayer, at: data.at };
}
