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

import { msg } from '../i18n/i18n';
import {
  ArabicSpeech,
  isArabicSpeechLinked,
  type LanguagePackEvent,
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
/**
 * After asking for the offline pack, how often to look again and for how long.
 * The download runs in the background for a minute or so; reading the status
 * straight after asking only ever found it still pending, so the Install chip
 * stayed up until the app was killed.
 */
const LANGUAGE_POLL_MS = 5000;
const LANGUAGE_POLL_FOR_MS = 2 * 60 * 1000;
/** True silence for this long ends the session with a gentle prompt (§4). */
export const SILENCE_TIMEOUT_MS = 3 * 60 * 1000;
/** Quiet this long and the voice counts as off, for the recitation log. */
const VOICE_OFF_MS = 300;

/**
 * The offline pack is asked for once per app run without anyone tapping
 * anything: recognition on the phone is faster than going online, and most
 * people would never find a chip that asks them to install something.
 */
let packAutoRequested = false;
/** for tests */
export function resetPackAutoRequest(): void {
  packAutoRequested = false;
}
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
  /**
   * The recognizer is gone and nothing will bring it back by itself: the
   * native side gave up, it never started, or the watchdog ran out of
   * restarts. `status` is already 'error', so the error chip says why; the
   * session should stop counting time and holding the screen awake.
   */
  onFailed: () => void;
  /**
   * Every lifecycle change of the native recognizer, for the recitation log:
   * device logs without them could show a gap but not why it happened.
   */
  onState?: (state: string, strategy: string) => void;
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
  /**
   * A passing note about the offline pack, as an English sentence marked with
   * msg(); display it with tr(). Clears itself after a few seconds.
   */
  languageNotice: string | null;
  /** the offline pack's download in progress (Android 14+ reports it), or null */
  languagePack: LanguagePackEvent | null;
  linked: boolean;
  start: () => void;
  stop: () => void;
  pause: (reason?: string) => void;
  resume: () => void;
  requestLanguagePack: () => Promise<void>;
  /** ms epoch when a voice was last heard, 0 if never; read every frame, so a getter, not state */
  lastVoiceAt: () => number;
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
  const [languagePack, setLanguagePack] = useState<LanguagePackEvent | null>(null);
  // read at each start, to write the pack's state at the top of the recitation log
  const languageStatusRef = useRef<LanguageStatus | null>(null);
  /** the last word from the pack's download, which usually happens before any session */
  const lastPackEvent = useRef<LanguagePackEvent | null>(null);
  languageStatusRef.current = languageStatus;
  const [lastError, setLastError] = useState<SpeechErrorEvent | null>(null);
  const [lastRelayGapMs, setLastRelayGapMs] = useState(0);
  const [watchdogRestarts, setWatchdogRestarts] = useState(0);
  /** has ANY result arrived this session — the difference between "quiet" and "deaf" */
  const [heardSomething, setHeardSomething] = useState(false);
  /** the offline model was missing, so the session fell back to online */
  const [offlineDropped, setOfflineDropped] = useState(false);
  const [audioFocus, setAudioFocus] = useState<'held' | 'lost'>('held');
  const [languageNotice, setLanguageNotice] = useState<string | null>(null);

  const level = useRef(new Animated.Value(0)).current;
  const levelValue = useRef(0);

  // Refs, not state: these are written many times a second by RMS events and
  // must never cause a re-render.
  const wantsToListen = useRef(false);
  const lastResultAt = useRef(0);
  const lastSpeechAt = useRef(0);
  /**
   * When a voice was last actually HEARD: unlike lastSpeechAt, never set by
   * starting. The underline's lead reads it (src/engine/lead.ts), and the
   * recitation log records the voice turning on and off from it, so a log
   * shows how far the recognizer's words trail the voice.
   */
  const lastVoiceAt = useRef(0);
  const voiceOn = useRef(false);
  /**
   * When the voice the recognizer has not answered yet began: the first voiced
   * RMS frame since the last result or the last new instance, 0 when there is
   * none. The watchdog measures "speech but no result" from here.
   */
  const speechSinceResultAt = useRef(0);
  const sessionStartedAt = useRef(0);
  const instanceStartedAt = useRef(0);
  const lastLevelWriteAt = useRef(0);
  const consecutiveRestarts = useRef(0);
  const languagePoll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef(config);
  callbacks.current = config;

  const configRef = useRef({ locale: config.locale, preferOnDevice: config.preferOnDevice, allowSegmented: config.allowSegmented });
  configRef.current = { locale: config.locale, preferOnDevice: config.preferOnDevice, allowSegmented: config.allowSegmented };

  /**
   * End this side of a session the recognizer has given up on.
   *
   * Setting 'error' alone was not enough: `wantsToListen` stayed true and the
   * session itself was never told, so it sat in 'listening' with the clock
   * running and the screen held awake, beside a chip saying it was listening.
   * After the watchdog gave up it was worse — `wantsToListen` was false, so the
   * silence timeout and the background pause both skipped it, and it never
   * ended at all. Callers set the error status themselves.
   */
  const fail = useCallback(() => {
    if (!wantsToListen.current) return;
    wantsToListen.current = false;
    if (linked) void ArabicSpeech().stop().catch(() => undefined);
    level.setValue(0);
    levelValue.current = 0;
    callbacks.current.onFailed();
  }, [linked, level]);

  /**
   * Read the offline-pack status again. A rejection is an unknown, not an
   * error worth showing: the status stays whatever it was.
   */
  const refreshLanguageStatus = useCallback(async (): Promise<LanguageStatus | null> => {
    if (!linked) return null;
    try {
      const next = await ArabicSpeech().languageStatus(configRef.current.locale);
      setLanguageStatus(next);
      return next;
    } catch {
      return null;
    }
  }, [linked]);

  const nativeStart = useCallback(() => {
    if (!linked) return;
    const now = Date.now();
    lastResultAt.current = now;
    lastSpeechAt.current = now;
    speechSinceResultAt.current = 0;
    instanceStartedAt.current = now;
    const status = languageStatusRef.current;
    const pack =
      status === null ? 'unknown' : !status.supported ? 'unsupported' : status.localeInstalled === true ? 'installed' : 'missing';
    // with what became of the download asked for at launch, and what the phone
    // says it can do on-device, so a recitation log explains a missing pack
    const download = lastPackEvent.current;
    const onDevice = status?.supportedOnDevice?.some((l) => l.startsWith('ar')) ?? false;
    const pending = status?.pending?.some((l) => l.startsWith('ar')) ?? false;
    callbacks.current.onState?.(
      `pack-${pack}`,
      [
        `download=${download === null ? 'none' : download.state + (download.error ? `/${download.error}` : '')}`,
        `arOnDevice=${onDevice}`,
        `arPending=${pending}`,
        status?.detail ? `detail=${status.detail}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
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
        fail();
      });
  }, [linked, fail]);

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
      speech.addListener('languagePack', (event: LanguagePackEvent) => {
        lastPackEvent.current = event;
        // into the recitation log, so a log shows whether the pack was coming
        callbacks.current.onState?.(`pack-${event.state}`, String(event.percent));
        setLanguagePack(event.state === 'downloading' || event.state === 'scheduled' ? event : null);
        if (event.state === 'installed') {
          // Known at once, even mid-recitation, where the status poll waits.
          setLanguageStatus((s) => (s === null ? s : { ...s, localeInstalled: true }));
          // said only to somebody who asked for it, in Settings: the app's own
          // request at launch stays silent either way
          if (packAskedByUser.current) setLanguageNotice(msg('The Arabic offline pack is installed.'));
        } else if (event.state === 'failed' && packAskedByUser.current) {
          setLanguageNotice(msg('The Arabic offline pack could not be downloaded. Try again from Settings.'));
        }
      }),
      speech.addListener('partial', (event: TranscriptEvent) => {
        lastResultAt.current = Date.now();
        speechSinceResultAt.current = 0;
        consecutiveRestarts.current = 0;
        setHeardSomething(true);
        callbacks.current.onPartial(event);
      }),
      speech.addListener('final', (event: TranscriptEvent) => {
        lastResultAt.current = Date.now();
        speechSinceResultAt.current = 0;
        consecutiveRestarts.current = 0;
        setHeardSomething(true);
        callbacks.current.onFinal(event);
      }),
      speech.addListener('endOfSegment', () => {
        callbacks.current.onEndOfSegment();
      }),
      speech.addListener('rms', ({ level: db }) => {
        const now = Date.now();
        if (db >= SPEECH_RMS_DB) {
          lastSpeechAt.current = now;
          lastVoiceAt.current = now;
          if (speechSinceResultAt.current === 0) speechSinceResultAt.current = now;
          if (!voiceOn.current) {
            voiceOn.current = true;
            callbacks.current.onState?.('voice-on', '');
          }
        } else if (voiceOn.current && now - lastVoiceAt.current > VOICE_OFF_MS) {
          voiceOn.current = false;
          callbacks.current.onState?.('voice-off', '');
        }
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
        // These three are always followed by a state that decides what they
        // meant — 'offline-unavailable' and a restart, 'mic-unavailable', or
        // 'failed' — so turning red here only flashed the error chip, at every
        // session start on a phone without the offline pack.
        const decidedByState =
          event.name === 'LANGUAGE_UNAVAILABLE' || event.name === 'LANGUAGE_NOT_SUPPORTED' || event.name === 'AUDIO';
        if (!event.transient && !decidedByState) setStatus('error');
      }),
      speech.addListener('state', (event: SpeechStateEvent) => {
        setStrategy(event.strategy);
        callbacks.current.onState?.(event.state, event.strategy);
        if (event.relayGapMs > 0) setLastRelayGapMs(event.relayGapMs);
        // Capabilities are read once at launch, before any session could have
        // proved segmented mode, so Settings could never say it was working.
        // Every state event carries the live flag.
        setCapabilities((c) =>
          c !== null && c.segmentedProven !== event.segmentedProven ? { ...c, segmentedProven: event.segmentedProven } : c,
        );
        switch (event.state) {
          case 'restarted':
            // A relayed instance is a new recognizer that has not heard the
            // voice yet; speech from before the handover is not its silence.
            speechSinceResultAt.current = 0;
            if (wantsToListen.current) setStatus('listening');
            break;
          case 'listening':
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
              callbacks.current.onInterrupted(msg('The microphone is in use elsewhere'));
            }
            break;
          case 'offline-unavailable':
            // Not fatal: the session continues online. Announced briefly and
            // then cleared -- as a persistent banner it just covered the page.
            setOfflineDropped(true);
            break;
          case 'failed':
            // The native side sends this for every ending it will not recover
            // from, its own launch failures included, so it is the one place
            // the session has to be told.
            setStatus('error');
            fail();
            break;
          default:
            break;
        }
      }),
    ];
    return () => {
      for (const s of subs) s.remove();
    };
  }, [linked, level, fail]);

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
      //
      // "Nothing has come back" is timed from when the unanswered voice BEGAN,
      // not only from the last result. From the last result alone, a relayed
      // instance — which the grace period never covered, because that starts
      // only from JS — could be judged dead two seconds into an ayah whose
      // first partial was merely slow, and the words in it were lost.
      const started = now - instanceStartedAt.current;
      const unanswered = speechSinceResultAt.current === 0 ? 0 : now - speechSinceResultAt.current;
      if (
        sinceResult > WATCHDOG_MS &&
        unanswered > WATCHDOG_MS &&
        sinceSpeech < WATCHDOG_MS &&
        started > WATCHDOG_GRACE_MS
      ) {
        if (consecutiveRestarts.current >= MAX_WATCHDOG_RESTARTS) {
          setStatus('error');
          setLastError({
            code: -2,
            name: 'no-recognition',
            transient: false,
            message:
              'The microphone is working but the recognizer returned nothing after several restarts. ' +
              'Install the Arabic offline pack, or try a different locale in Settings (ar-EG, ar-MA).',
          });
          fail();
          return;
        }
        consecutiveRestarts.current += 1;
        setWatchdogRestarts((n) => n + 1);
        lastResultAt.current = now;
        speechSinceResultAt.current = 0;
        void ArabicSpeech()
          .cancel()
          .catch(() => undefined)
          .then(() => {
            if (wantsToListen.current) nativeStart();
          });
      }
    }, WATCHDOG_TICK_MS);
    return () => clearInterval(id);
  }, [linked, nativeStart, fail]);

  /** Transient: say it once, then get out of the way. */
  useEffect(() => {
    if (!offlineDropped) return undefined;
    const id = setTimeout(() => setOfflineDropped(false), NOTICE_MS);
    return () => clearTimeout(id);
  }, [offlineDropped]);

  useEffect(() => {
    if (languageNotice === null) return undefined;
    const id = setTimeout(() => setLanguageNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [languageNotice]);

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
        callbacks.current.onInterrupted(msg('Tasmee Hifz went to the background'));
      }
      // Coming back is when the offline pack may have changed: the system's
      // download finished, or the reader installed it in Android settings.
      // Not while a session is live: the probe is a second on-device
      // recognizer, and the one listening should not have to share.
      if (next === 'active' && !wantsToListen.current) void refreshLanguageStatus();
    });
    return () => sub.remove();
  }, [refreshLanguageStatus]);

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
    // whatever this resumes from is over; Settings must not keep it in red
    setLastError(null);
    nativeStart();
  }, [linked, nativeStart]);

  /** set when the person asked for the pack (Settings), not the app at launch */
  const packAskedByUser = useRef(false);
  const requestPack = useCallback(async (byUser: boolean) => {
    if (!linked) return;
    if (byUser) packAskedByUser.current = true;
    let outcome: 'requested' | 'unsupported';
    try {
      outcome = await ArabicSpeech().requestLanguageDownload(configRef.current.locale);
    } catch {
      // Called as `void requestLanguagePack()` from a button, so a rejection
      // here would be unhandled and the tap would look ignored.
      if (byUser) setLanguageNotice(msg('The Arabic offline pack could not be requested. Try again from Settings.'));
      return;
    }
    if (outcome === 'unsupported') {
      if (!byUser) return;
      // The "recognising online" chip leads here on phones with no on-device
      // recognition at all (Android 12), where tapping it used to do nothing.
      setLanguageNotice(msg('Offline Arabic is not available on this phone.'));
      return;
    }
    // The download runs in the background, so keep looking until it lands.
    if (languagePoll.current !== null) clearTimeout(languagePoll.current);
    const deadline = Date.now() + LANGUAGE_POLL_FOR_MS;
    const poll = async (): Promise<void> => {
      languagePoll.current = null;
      // see the AppState listener: never probe beside a live recognizer
      const next = wantsToListen.current ? null : await refreshLanguageStatus();
      if (next?.localeInstalled === true || Date.now() >= deadline) return;
      languagePoll.current = setTimeout(() => void poll(), LANGUAGE_POLL_MS);
    };
    await poll();
  }, [linked, refreshLanguageStatus]);
  const requestLanguagePack = useCallback(() => requestPack(true), [requestPack]);

  // Ask for the offline pack by itself, once per run, when it is missing and
  // on-device recognition is wanted. Android downloads it in the background
  // (it may wait for Wi-Fi); nobody has to find a setting.
  useEffect(() => {
    if (packAutoRequested) return;
    if (configRef.current.preferOnDevice === false) return;
    if (languageStatus === null || !languageStatus.supported || languageStatus.localeInstalled !== false) return;
    packAutoRequested = true;
    void requestPack(false);
  }, [languageStatus, requestPack]);

  const readLastVoiceAt = useCallback(() => lastVoiceAt.current, []);

  // stop the microphone if this hook ever unmounts
  useEffect(
    () => () => {
      wantsToListen.current = false;
      if (languagePoll.current !== null) clearTimeout(languagePoll.current);
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
    languagePack,
    lastError,
    lastRelayGapMs,
    watchdogRestarts,
    heardSomething,
    offlineDropped,
    languageNotice,
    linked,
    start,
    stop,
    pause,
    resume,
    requestLanguagePack,
    lastVoiceAt: readLastVoiceAt,
  };
}
