/**
 * JS-side recognizer session rules (spec §4).
 *
 * The native module owns starting, stopping and relaying recognizers. This hook
 * owns the questions only JS can answer: is the recognizer still alive, has the
 * reciter gone quiet, and has something outside the app taken the microphone.
 *
 * The single most important piece here is the liveness watchdog. An earlier
 * version restarted blindly on a timer, and separately went permanently deaf
 * after screen transitions with no event at all. The watchdog is driven by real
 * audio: RMS says whether there is a voice, so "no results for 2.5 s" only means
 * "dead" when there was something to hear.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, type AppStateStatus } from 'react-native';

import {
  ArabicSpeech,
  isArabicSpeechLinked,
  type LanguageStatus,
  type SpeechCapabilities,
  type SpeechErrorEvent,
  type SpeechStateEvent,
  type SpeechStrategy,
  type TranscriptEvent,
} from '../../modules/expo-arabic-speech';

export type RecognizerStatus = 'idle' | 'starting' | 'listening' | 'paused' | 'error' | 'unavailable';

/** RMS in dB above which we consider the microphone to be hearing a voice. */
const SPEECH_RMS_DB = 1.5;
/** Speech seen but no result for this long means the recognizer is dead (§4). */
const WATCHDOG_MS = 2500;
/**
 * How long a freshly started recognizer is left alone.
 *
 * The §4 rule on its own ("speech but no result for 2.5 s means dead") is unsafe
 * as a blanket policy: a recognizer that simply has not produced its first
 * partial yet looks identical to a dead one, so the watchdog would cancel and
 * restart it every 2.5 seconds forever and nothing would ever be recognised. A
 * new instance gets this long to say its first word.
 */
const WATCHDOG_GRACE_MS = 8000;
/** Consecutive watchdog restarts before we stop and admit something is wrong. */
const MAX_WATCHDOG_RESTARTS = 3;
/** How long a passing notice stays on screen before clearing itself. */
const NOTICE_MS = 4000;
/** How often the watchdog checks. */
const WATCHDOG_TICK_MS = 500;
/** True silence for this long ends the session with a gentle prompt (§4). */
export const SILENCE_TIMEOUT_MS = 3 * 60 * 1000;
/** Smoothing for the voice-level animation; the only continuous animation (§7). */
const LEVEL_ATTACK = 0.5;
const LEVEL_DECAY = 0.12;
/**
 * Minimum gap between writes to the shared level value, and the smallest change
 * worth writing. RMS arrives faster than a screen can show it, and every write
 * walks the animated graph on the JS thread — the same thread doing alignment.
 */
const LEVEL_MIN_INTERVAL_MS = 66;
const LEVEL_MIN_DELTA = 0.02;

export interface RecognizerCallbacks {
  onPartial: (event: TranscriptEvent) => void;
  onFinal: (event: TranscriptEvent) => void;
  onEndOfSegment: () => void;
  /** true silence for SILENCE_TIMEOUT_MS: stop and ask "still there?" */
  onSilenceTimeout: () => void;
  /** call, headset change, backgrounded: pause cleanly, offer one-tap resume */
  onInterrupted: (reason: string) => void;
}

export interface RecognizerHandle {
  status: RecognizerStatus;
  /** last audio-focus event, for the debug overlay only; never pauses a session */
  audioFocus: 'held' | 'lost';
  /** 0..1, smoothed; drives the mic pulse and the voice underline */
  level: Animated.Value;
  strategy: SpeechStrategy | null;
  capabilities: SpeechCapabilities | null;
  languageStatus: LanguageStatus | null;
  lastError: SpeechErrorEvent | null;
  /** measured handover gap in RELAY mode; surfaced honestly, not hidden (§4.3) */
  lastRelayGapMs: number;
  /** how many times the watchdog had to resurrect a dead recognizer */
  watchdogRestarts: number;
  /** true once any transcript has arrived this session */
  heardSomething: boolean;
  /** the Arabic offline model was missing, so recognition went online */
  offlineDropped: boolean;
  linked: boolean;
  start: () => void;
  stop: () => void;
  pause: (reason?: string) => void;
  resume: () => void;
  requestLanguagePack: () => Promise<void>;
}

export interface RecognizerConfig extends RecognizerCallbacks {
  /** recognizer quality varies by locale, so this is a user setting (§4) */
  locale: string;
  preferOnDevice?: boolean;
  allowSegmented?: boolean;
}

export function useRecitationRecognizer(config: RecognizerConfig): RecognizerHandle {
  const linked = useMemo(() => isArabicSpeechLinked(), []);
  const [status, setStatus] = useState<RecognizerStatus>(linked ? 'idle' : 'unavailable');
  const [strategy, setStrategy] = useState<SpeechStrategy | null>(null);
  const [capabilities, setCapabilities] = useState<SpeechCapabilities | null>(null);
  const [languageStatus, setLanguageStatus] = useState<LanguageStatus | null>(null);
  const [lastError, setLastError] = useState<SpeechErrorEvent | null>(null);
  const [lastRelayGapMs, setLastRelayGapMs] = useState(0);
  const [watchdogRestarts, setWatchdogRestarts] = useState(0);
  /** has ANY result arrived this session — the difference between "quiet" and "deaf" */
  const [heardSomething, setHeardSomething] = useState(false);
  /** the offline model was missing, so the session fell back to online */
  const [offlineDropped, setOfflineDropped] = useState(false);
  const [audioFocus, setAudioFocus] = useState<'held' | 'lost'>('held');

  const level = useRef(new Animated.Value(0)).current;
  const levelValue = useRef(0);

  // Refs, not state: these are written many times a second by RMS events and
  // must never cause a re-render.
  const wantsToListen = useRef(false);
  const lastResultAt = useRef(0);
  const lastSpeechAt = useRef(0);
  const sessionStartedAt = useRef(0);
  const instanceStartedAt = useRef(0);
  const lastLevelWriteAt = useRef(0);
  const consecutiveRestarts = useRef(0);
  const callbacks = useRef(config);
  callbacks.current = config;

  const configRef = useRef({ locale: config.locale, preferOnDevice: config.preferOnDevice, allowSegmented: config.allowSegmented });
  configRef.current = { locale: config.locale, preferOnDevice: config.preferOnDevice, allowSegmented: config.allowSegmented };

  const nativeStart = useCallback(() => {
    if (!linked) return;
    const now = Date.now();
    lastResultAt.current = now;
    lastSpeechAt.current = now;
    instanceStartedAt.current = now;
    void ArabicSpeech()
      .start({
        locale: configRef.current.locale,
        maxResults: 5,
        preferOnDevice: configRef.current.preferOnDevice ?? true,
        allowSegmented: configRef.current.allowSegmented ?? true,
      })
      .catch((e: unknown) => {
        setStatus('error');
        setLastError({
          code: -1,
          name: 'start-threw',
          transient: false,
          message: e instanceof Error ? e.message : String(e),
        });
      });
  }, [linked]);

  // ---------------------------------------------------------------------
  // native event plumbing
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!linked) return;
    const speech = ArabicSpeech();

    void speech.capabilities().then(setCapabilities).catch(() => undefined);
    void speech
      .languageStatus(configRef.current.locale)
      .then(setLanguageStatus)
      .catch(() => undefined);

    const subs = [
      speech.addListener('partial', (event: TranscriptEvent) => {
        lastResultAt.current = Date.now();
        consecutiveRestarts.current = 0;
        setHeardSomething(true);
        callbacks.current.onPartial(event);
      }),
      speech.addListener('final', (event: TranscriptEvent) => {
        lastResultAt.current = Date.now();
        consecutiveRestarts.current = 0;
        setHeardSomething(true);
        callbacks.current.onFinal(event);
      }),
      speech.addListener('endOfSegment', () => {
        callbacks.current.onEndOfSegment();
      }),
      speech.addListener('rms', ({ level: db }) => {
        const now = Date.now();
        if (db >= SPEECH_RMS_DB) lastSpeechAt.current = now;
        // dB in, 0..1 out, with a fast attack and a slow decay so the underline
        // breathes rather than flickers.
        const target = Math.max(0, Math.min(1, (db + 2) / 12));
        const k = target > levelValue.current ? LEVEL_ATTACK : LEVEL_DECAY;
        const next = levelValue.current + (target - levelValue.current) * k;
        const changed = Math.abs(next - levelValue.current) >= LEVEL_MIN_DELTA;
        levelValue.current = next;
        if (changed && now - lastLevelWriteAt.current >= LEVEL_MIN_INTERVAL_MS) {
          lastLevelWriteAt.current = now;
          level.setValue(next);
        }
      }),
      speech.addListener('error', (event: SpeechErrorEvent) => {
        // Transient codes are restarted by the native side without surfacing
        // anything; we keep them only for the debug overlay.
        setLastError(event);
        if (!event.transient) setStatus('error');
      }),
      speech.addListener('state', (event: SpeechStateEvent) => {
        setStrategy(event.strategy);
        if (event.relayGapMs > 0) setLastRelayGapMs(event.relayGapMs);
        switch (event.state) {
          case 'listening':
          case 'restarted':
          case 'ready':
            if (wantsToListen.current) setStatus('listening');
            break;
          case 'audio-focus-lost':
            // Deliberately does nothing to the session. See the note on this
            // state in ArabicSpeech.types.ts: reacting to focus loss is what
            // made the app take the microphone from itself.
            setAudioFocus('lost');
            break;
          case 'audio-focus-regained':
            setAudioFocus('held');
            break;
          case 'mic-unavailable':
            if (wantsToListen.current) {
              wantsToListen.current = false;
              setStatus('paused');
              callbacks.current.onInterrupted('The microphone is in use elsewhere');
            }
            break;
          case 'offline-unavailable':
            // Not fatal: the session continues online. Announced briefly and
            // then cleared -- as a persistent banner it just covered the page.
            setOfflineDropped(true);
            break;
          case 'failed':
            setStatus('error');
            break;
          default:
            break;
        }
      }),
    ];
    return () => {
      for (const s of subs) s.remove();
    };
  }, [linked, level]);

  // ---------------------------------------------------------------------
  // liveness watchdog + silence timeout
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!linked) return;
    const id = setInterval(() => {
      if (!wantsToListen.current) return;
      const now = Date.now();
      const sinceResult = now - lastResultAt.current;
      const sinceSpeech = now - lastSpeechAt.current;

      // True silence for three minutes: don't hold the mic forever.
      if (sinceSpeech > SILENCE_TIMEOUT_MS && now - sessionStartedAt.current > SILENCE_TIMEOUT_MS) {
        wantsToListen.current = false;
        void ArabicSpeech().stop().catch(() => undefined);
        setStatus('paused');
        callbacks.current.onSilenceTimeout();
        return;
      }

      // The watchdog proper: there WAS a voice recently, yet nothing has come
      // back. That is a dead recognizer, not a quiet reciter — but only once the
      // instance has had its grace period, and only a few times before we stop
      // guessing and say so.
      const started = now - instanceStartedAt.current;
      if (sinceResult > WATCHDOG_MS && sinceSpeech < WATCHDOG_MS && started > WATCHDOG_GRACE_MS) {
        if (consecutiveRestarts.current >= MAX_WATCHDOG_RESTARTS) {
          wantsToListen.current = false;
          void ArabicSpeech().stop().catch(() => undefined);
          setStatus('error');
          setLastError({
            code: -2,
            name: 'no-recognition',
            transient: false,
            message:
              'The microphone is working but the recognizer returned nothing after several restarts. ' +
              'Install the Arabic offline pack, or try a different locale in Settings (ar-EG, ar-MA).',
          });
          return;
        }
        consecutiveRestarts.current += 1;
        setWatchdogRestarts((n) => n + 1);
        lastResultAt.current = now;
        void ArabicSpeech()
          .cancel()
          .catch(() => undefined)
          .then(() => {
            if (wantsToListen.current) nativeStart();
          });
      }
    }, WATCHDOG_TICK_MS);
    return () => clearInterval(id);
  }, [linked, nativeStart]);

  /** Transient: say it once, then get out of the way. */
  useEffect(() => {
    if (!offlineDropped) return undefined;
    const id = setTimeout(() => setOfflineDropped(false), NOTICE_MS);
    return () => clearTimeout(id);
  }, [offlineDropped]);

  // ---------------------------------------------------------------------
  // app backgrounding
  // ---------------------------------------------------------------------
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      // Only 'background'. Android reports 'inactive' transiently — during a
      // permission dialog, or when the privacy indicator appears — and treating
      // that as backgrounding is another way to pause a session nobody left.
      if (next === 'background' && wantsToListen.current) {
        wantsToListen.current = false;
        void ArabicSpeech().stop().catch(() => undefined);
        setStatus('paused');
        callbacks.current.onInterrupted('Quran Habit went to the background');
      }
    });
    return () => sub.remove();
  }, []);

  const start = useCallback(() => {
    if (!linked) {
      setStatus('unavailable');
      return;
    }
    wantsToListen.current = true;
    sessionStartedAt.current = Date.now();
    consecutiveRestarts.current = 0;
    setStatus('starting');
    setLastError(null);
    setHeardSomething(false);
    setOfflineDropped(false);
    nativeStart();
  }, [linked, nativeStart]);

  const stop = useCallback(() => {
    wantsToListen.current = false;
    if (linked) void ArabicSpeech().stop().catch(() => undefined);
    level.setValue(0);
    levelValue.current = 0;
    setStatus('idle');
  }, [linked, level]);

  const pause = useCallback(
    (reason?: string) => {
      wantsToListen.current = false;
      if (linked) void ArabicSpeech().stop().catch(() => undefined);
      level.setValue(0);
      levelValue.current = 0;
      setStatus('paused');
      if (reason) callbacks.current.onInterrupted(reason);
    },
    [linked, level],
  );

  const resume = useCallback(() => {
    if (!linked) return;
    wantsToListen.current = true;
    sessionStartedAt.current = Date.now();
    setStatus('starting');
    nativeStart();
  }, [linked, nativeStart]);

  const requestLanguagePack = useCallback(async () => {
    if (!linked) return;
    await ArabicSpeech().requestLanguageDownload(configRef.current.locale);
    const next = await ArabicSpeech().languageStatus(configRef.current.locale);
    setLanguageStatus(next);
  }, [linked]);

  // stop the microphone if this hook ever unmounts
  useEffect(
    () => () => {
      wantsToListen.current = false;
      if (linked) void ArabicSpeech().cancel().catch(() => undefined);
    },
    [linked],
  );

  return {
    status,
    audioFocus,
    level,
    strategy,
    capabilities,
    languageStatus,
    lastError,
    lastRelayGapMs,
    watchdogRestarts,
    heardSomething,
    offlineDropped,
    linked,
    start,
    stop,
    pause,
    resume,
    requestLanguagePack,
  };
}
