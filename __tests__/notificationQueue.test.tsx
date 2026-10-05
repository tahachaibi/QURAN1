/**
 * Scheduling against the device: one rebuild at a time, and the adhan the
 * system is playing taken down when the app plays its own.
 *
 * expo-notifications is stood in for by a queue in memory whose every call
 * takes a moment, the way the native module's do — that delay is the whole of
 * the bug these pin. Two rebuilds that overlapped scheduled everything twice.
 *
 * In the app project, with the device-facing modules: notifications.ts reaches
 * React Native and the Expo SDK, which is what that project is for.
 */
import * as Notifications from 'expo-notifications';

import { cancelAll, dismissPresentedAdhan, rescheduleAll } from '../src/data/notifications';

type Scheduled = { identifier: string; content: { data: Record<string, unknown> } };
const mockQueue = new Map<string, Scheduled>();
let mockNextId = 0;
const mockPause = () => new Promise((resolve) => setTimeout(resolve, 1));
/** Called after each notification is scheduled, to start something mid-rebuild. */
let mockOnSchedule: (() => void) | null = null;

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationChannelAsync: jest.fn(() => mockPause()),
  getAllScheduledNotificationsAsync: jest.fn(async () => {
    await mockPause();
    return [...mockQueue.values()];
  }),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
    await mockPause();
    mockQueue.delete(id);
  }),
  scheduleNotificationAsync: jest.fn(async (request: { content: { data: Record<string, unknown> } }) => {
    await mockPause();
    const identifier = `n${(mockNextId += 1)}`;
    mockQueue.set(identifier, { identifier, content: request.content });
    mockOnSchedule?.();
    return identifier;
  }),
  getPresentedNotificationsAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
  setNotificationHandler: jest.fn(),
}));

const TIMINGS = {
  Fajr: '05:14 (+01)',
  Dhuhr: '12:30 (+01)',
  Asr: '15:45 (+01)',
  Maghrib: '18:20 (+01)',
  Isha: '19:50 (+01)',
};
const NOW = new Date(2026, 3, 20, 4, 0);
const options = (warnBefore: boolean) => ({
  days: [{ date: '2026-04-20', timings: TIMINGS }],
  warnBefore,
  adhan: true,
  now: NOW,
});
const ours = () => [...mockQueue.values()].filter((n) => n.content.data.kind !== undefined);

beforeEach(() => {
  mockQueue.clear();
  mockOnSchedule = null;
  jest.mocked(Notifications.dismissNotificationAsync).mockClear();
});

describe('rescheduleAll', () => {
  it('schedules a day once, however the rebuilds overlap', async () => {
    // A second rebuild asked for while the first is three notifications in —
    // two bell taps in a row. It used to list the queue part-way, cancel what it
    // saw, and leave the first's later notifications next to its own full set.
    let second: Promise<unknown> | null = null;
    mockOnSchedule = () => {
      if (second === null && ours().length === 3) second = rescheduleAll(options(true), 'adhan');
    };
    await rescheduleAll(options(true), 'adhan');
    await second;
    expect(second).not.toBeNull();
    expect(ours()).toHaveLength(10);
    const keys = ours().map((n) => `${String(n.content.data.kind)}:${String(n.content.data.prayer)}`);
    expect(new Set(keys).size).toBe(10);
  });

  it('skips a rebuild that a newer one replaced before its turn', async () => {
    const running = rescheduleAll(options(true), 'adhan');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const replaced = rescheduleAll(options(true), 'adhan');
    const newest = rescheduleAll(options(false), 'adhan');
    expect(await running).toBe(10);
    expect(await replaced).toBeNull();
    expect(await newest).toBe(5);
    // the newest settings are the ones on the phone
    expect(ours()).toHaveLength(5);
    expect(ours().every((n) => n.content.data.kind === 'adhan')).toBe(true);
  });

  it('leaves notifications that are not ours alone', async () => {
    mockQueue.set('hifz', { identifier: 'hifz', content: { data: {} } });
    await rescheduleAll(options(false), 'adhan');
    await rescheduleAll(options(false), 'adhan');
    expect(mockQueue.has('hifz')).toBe(true);
    expect(ours()).toHaveLength(5);
  });

  it('is not stopped for good by one failure', async () => {
    jest.mocked(Notifications.scheduleNotificationAsync).mockRejectedValueOnce(new Error('boom'));
    await expect(rescheduleAll(options(false), 'adhan')).rejects.toThrow('boom');
    expect(await rescheduleAll(options(false), 'adhan')).toBe(5);
  });
});

describe('cancelAll', () => {
  it('waits for a running rebuild, so nothing is put back afterwards', async () => {
    let cancelled: Promise<void> | null = null;
    mockOnSchedule = () => {
      if (cancelled === null && ours().length === 3) cancelled = cancelAll();
    };
    await rescheduleAll(options(true), 'adhan');
    await cancelled;
    expect(cancelled).not.toBeNull();
    expect(ours()).toEqual([]);
  });
});

describe('dismissPresentedAdhan', () => {
  const presented = (identifier: string, data: Record<string, unknown>) => ({
    request: { identifier, content: { data } },
  });

  it('takes down the adhan the system is playing, and nothing else', async () => {
    jest.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([
      presented('a', { kind: 'adhan', prayer: 'Maghrib', at: NOW.toISOString() }),
      presented('w', { kind: 'warning', prayer: 'Isha', at: NOW.toISOString() }),
      presented('x', { something: 'else' }),
    ] as never);
    await dismissPresentedAdhan();
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('a');
  });

  it('copes with the system refusing to say', async () => {
    jest.mocked(Notifications.getPresentedNotificationsAsync).mockRejectedValue(new Error('no'));
    await expect(dismissPresentedAdhan()).resolves.toBeUndefined();
  });
});
