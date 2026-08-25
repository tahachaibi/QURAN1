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
  CHANNEL_WARNING,
  planNotifications,
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
export async function ensureChannels(adhanSound: string | null): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_WARNING, {
    name: 'Prayer reminder',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250],
    enableVibrate: true,
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_ADHAN, {
    name: 'Adhan',
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

/** Cancel everything and reschedule from scratch. Returns how many were set. */
export async function rescheduleAll(options: ScheduleOptions, adhanSound: string | null): Promise<number> {
  await ensureChannels(adhanSound);
  await Notifications.cancelAllScheduledNotificationsAsync();

  const planned = planNotifications(options);
  for (const item of planned) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: item.title,
        body: item.body,
        sound: item.channel === CHANNEL_ADHAN ? (adhanSound ?? 'default') : 'default',
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

export const cancelAll = (): Promise<void> => Notifications.cancelAllScheduledNotificationsAsync();
