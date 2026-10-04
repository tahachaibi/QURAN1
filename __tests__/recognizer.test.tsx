/**
 * The JS half of the recognizer: what useRecitationRecognizer does with the
 * events the native module sends.
 *
 * The Kotlin cannot run here, so the native module is a fake emitter and each
 * test plays the event sequence RecitationRecognizer.kt actually produces.
 * Every case below is a regression that shipped:
 *  - a recognizer that gave up left the session 'listening' forever;
 *  - the watchdog cancelled a healthy relayed recognizer before its first word;
 *  - Settings could never show segmented sessions as working;
 *  - recoverable errors flashed the red chip, and old ones stayed red;
 *  - the offline-pack status was never read again after asking for it.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';

import {
  useRecitationRecognizer,
  type RecognizerConfig,
  type RecognizerHandle,
} from '../src/recognition/useRecitationRecognizer';
import type { LanguageStatus } from '../modules/expo-arabic-speech';

// --- the fake native module ---------------------------------------------------
type Listener = (event: never) => void;
const mockListeners = new Map<string, Set<Listener>>();
const mockCalls: string[] = [];
let mockStartRejects = false;
let mockLanguageStatus: LanguageStatus = { supported: true, localeInstalled: false };
let mockDownload: () => Promise<'requested' | 'unsupported'> = () => Promise.resolve('requested');
let mockStatusReads = 0;

const mockModule = {
  addListener: (name: string, fn: Listener) => {
    if (!mockListeners.has(name)) mockListeners.set(name, new Set());
    mockListeners.get(name)?.add(fn);
    return { remove: () => mockListeners.get(name)?.delete(fn) };
  },
  capabilities: () =>
    Promise.resolve({
      sdkInt: 34,
      recognitionAvailable: true,
      onDeviceAvailable: true,
      segmentedAvailable: true,
      strategy: 'SEGMENTED',
      segmentedProven: false,
    }),
  languageStatus: () => {
    mockStatusReads++;
    return Promise.resolve(mockLanguageStatus);
  },
  requestLanguageDownload: () => mockDownload(),
  start: () => {
    mockCalls.push('start');
    return mockStartRejects ? Promise.reject(new Error('boom')) : Promise.resolve();
  },
  stop: () => {
    mockCalls.push('stop');
    return Promise.resolve();
  },
  cancel: () => {
    mockCalls.push('cancel');
    return Promise.resolve();
  },
};

jest.mock('../modules/expo-arabic-speech', () => ({
  ArabicSpeech: () => mockModule,
  isArabicSpeechLinked: () => true,
}));

function emit(name: string, event: unknown = {}): void {
  for (const fn of mockListeners.get(name) ?? []) (fn as (e: unknown) => void)(event);
}
const state = (s: string, extra: Record<string, unknown> = {}) =>
  emit('state', { state: s, strategy: 'RELAY', relayGapMs: 0, segmentedProven: false, ...extra });
const transcript = (kind: 'partial' | 'final') =>
  emit(kind, { alternatives: ['بسم الله'], emittedAt: Date.now(), strategy: 'RELAY' });

// --- mounting -------------------------------------------------------------------
let handle: RecognizerHandle | null = null;
const callbacks = {
  onPartial: jest.fn(),
  onFinal: jest.fn(),
  onEndOfSegment: jest.fn(),
  onSilenceTimeout: jest.fn(),
  onInterrupted: jest.fn(),
  onFailed: jest.fn(),
};
function Probe(): null {
  const config: RecognizerConfig = { locale: 'ar-SA', ...callbacks };
  handle = useRecitationRecognizer(config);
  return null;
}

let appStateHandlers: ((s: AppStateStatus) => void)[] = [];

async function mount(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  await act(async () => undefined);
  return tree;
}

/** Advance fake time in watchdog-sized steps, so every tick sees the clock it would. */
async function advance(ms: number, each?: (t: number) => void): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    await act(async () => {
      each?.(t);
      jest.advanceTimersByTime(100);
    });
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  mockListeners.clear();
  mockCalls.length = 0;
  mockStartRejects = false;
  mockLanguageStatus = { supported: true, localeInstalled: false };
  mockDownload = () => Promise.resolve('requested');
  mockStatusReads = 0;
  handle = null;
  appStateHandlers = [];
  for (const fn of Object.values(callbacks)) fn.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    handler: (s: AppStateStatus) => void,
  ) => {
    appStateHandlers.push(handler);
    return { remove: () => undefined };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('a recognizer that has given up', () => {
  it('ends the session when the native side reports failed', async () => {
    const tree = await mount();
    act(() => handle?.start());
    await act(async () => {
      emit('error', { code: 4, name: 'SERVER', transient: false, message: 'x' });
      state('failed');
    });
    // Before: status went red and nothing else happened — the session stayed
    // 'listening', with its clock running and the screen held awake.
    expect(handle?.status).toBe('error');
    expect(callbacks.onFailed).toHaveBeenCalledTimes(1);
    expect(mockCalls).toContain('stop');
    act(() => tree.unmount());
  });

  it('ends the session when the watchdog runs out of restarts', async () => {
    const tree = await mount();
    act(() => handle?.start());
    // A voice the whole time, and not one result: a deaf recognizer.
    await advance(40_000, () => emit('rms', { level: 6 }));
    expect(handle?.lastError?.name).toBe('no-recognition');
    expect(handle?.status).toBe('error');
    // Before: wantsToListen was cleared without telling anyone, after which
    // even the silence timeout and the background pause skipped the session.
    expect(callbacks.onFailed).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('ends the session when start itself throws', async () => {
    mockStartRejects = true;
    const tree = await mount();
    await act(async () => {
      handle?.start();
    });
    await act(async () => undefined);
    expect(handle?.lastError?.name).toBe('start-threw');
    expect(callbacks.onFailed).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('does not report a failure for a session the reader already stopped', async () => {
    const tree = await mount();
    act(() => handle?.start());
    act(() => handle?.stop());
    await act(async () => state('failed'));
    expect(callbacks.onFailed).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

describe('the liveness watchdog', () => {
  it('gives a relayed recognizer time to say its first word', async () => {
    const tree = await mount();
    act(() => handle?.start());
    // Ten seconds of ordinary recitation: past the cold-start grace period.
    await advance(10_000, (t) => {
      emit('rms', { level: 6 });
      if (t % 1000 === 0) transcript('partial');
    });
    // The ayah ends; the native side relays to a new instance.
    await act(async () => {
      transcript('final');
      state('restarted');
    });
    expect(mockCalls).toEqual(['start']);
    // A 1.5 s breath, then the next ayah. Its first partial is slow — 2.2 s
    // after the voice starts, as on slow mobile data, but inside the 2.5 s the
    // watchdog allows.
    await advance(1500);
    await advance(2200, () => emit('rms', { level: 6 }));
    // Before: "no result for 2.5 s" was counted from the last FINAL, so the
    // watchdog cancelled this healthy instance a second into the ayah, and
    // the words in it were lost.
    expect(mockCalls).toEqual(['start']);
    await act(async () => transcript('partial'));
    expect(callbacks.onPartial).toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('still restarts a recognizer that hears a voice and answers nothing', async () => {
    const tree = await mount();
    act(() => handle?.start());
    await advance(12_000, () => emit('rms', { level: 6 }));
    expect(mockCalls).toContain('cancel');
    act(() => tree.unmount());
  });
});

describe('what Settings shows', () => {
  it('learns that segmented mode works once a session proves it', async () => {
    const tree = await mount();
    expect(handle?.capabilities?.segmentedProven).toBe(false);
    act(() => handle?.start());
    await act(async () => state('restarted', { strategy: 'SEGMENTED', segmentedProven: true }));
    // Before: capabilities were read once at launch and never again.
    expect(handle?.capabilities?.segmentedProven).toBe(true);
    act(() => tree.unmount());
  });

  it('does not flash red for an error the next state recovers from', async () => {
    const tree = await mount();
    act(() => handle?.start());
    await act(async () => state('listening'));
    await act(async () => {
      emit('error', { code: 13, name: 'LANGUAGE_UNAVAILABLE', transient: false, message: 'x' });
    });
    // Before: 'error' until the restart landed, a red chip at every session
    // start on a phone without the offline pack.
    expect(handle?.status).toBe('listening');
    await act(async () => {
      state('offline-unavailable');
      state('restarted');
    });
    expect(handle?.status).toBe('listening');
    expect(callbacks.onFailed).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('forgets the error a resume recovers from', async () => {
    const tree = await mount();
    act(() => handle?.start());
    await act(async () => {
      emit('error', { code: 3, name: 'AUDIO', transient: false, message: 'x' });
      state('mic-unavailable');
    });
    expect(handle?.lastError?.name).toBe('AUDIO');
    act(() => handle?.resume());
    expect(handle?.lastError).toBeNull();
    act(() => tree.unmount());
  });
});

describe('the Arabic offline pack', () => {
  it('keeps looking after asking for it, until it is installed', async () => {
    const tree = await mount();
    expect(handle?.languageStatus?.localeInstalled).toBe(false);
    await act(async () => {
      await handle?.requestLanguagePack();
    });
    // the download runs in the background: still pending straight after asking
    expect(handle?.languageStatus?.localeInstalled).toBe(false);

    mockLanguageStatus = { supported: true, localeInstalled: true };
    await advance(5_100);
    // Before: read once, right after asking, and never again.
    expect(handle?.languageStatus?.localeInstalled).toBe(true);
    const reads = mockStatusReads;
    await advance(20_000);
    expect(mockStatusReads).toBe(reads);
    act(() => tree.unmount());
  });

  it('reads it again when the app comes back to the foreground', async () => {
    const tree = await mount();
    mockLanguageStatus = { supported: true, localeInstalled: true };
    await act(async () => {
      for (const h of appStateHandlers) h('active');
    });
    expect(handle?.languageStatus?.localeInstalled).toBe(true);
    act(() => tree.unmount());
  });

  it('says so when this phone cannot have it', async () => {
    mockDownload = () => Promise.resolve('unsupported');
    const tree = await mount();
    await act(async () => {
      await handle?.requestLanguagePack();
    });
    expect(handle?.languageNotice).toBe('Offline Arabic is not available on this phone.');
    act(() => tree.unmount());
  });

  it('does not reject when the request itself fails', async () => {
    mockDownload = () => Promise.reject(new Error('main thread'));
    const tree = await mount();
    await act(async () => {
      // the chip calls this as `void requestLanguagePack()`
      await expect(handle?.requestLanguagePack()).resolves.toBeUndefined();
    });
    expect(handle?.languageNotice).not.toBeNull();
    act(() => tree.unmount());
  });
});
