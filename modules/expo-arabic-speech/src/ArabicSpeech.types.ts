/** Recognizer strategy actually in use; reported so the UI never has to guess. */
export type SpeechStrategy = 'SEGMENTED' | 'ON_DEVICE' | 'RELAY';

export interface SpeechCapabilities {
  sdkInt: number;
  recognitionAvailable: boolean;
  onDeviceAvailable: boolean;
  segmentedAvailable: boolean;
  strategy: SpeechStrategy;
  /** true once a segment result has actually arrived from this device */
  segmentedProven: boolean;
}

export interface LanguageStatus {
  supported: boolean;
  detail?: string;
  installed?: string[];
  pending?: string[];
  supportedOnDevice?: string[];
  online?: string[];
  /** is the requested locale's language pack installed on-device */
  localeInstalled?: boolean;
}

export interface TranscriptEvent {
  /** up to 5 alternatives, best first. Lower ones are often the right one. */
  alternatives: string[];
  confidences?: number[];
  /** ms epoch when the native side emitted it, for the <300ms budget (§5.7) */
  emittedAt: number;
  strategy: SpeechStrategy;
}

export interface RmsEvent {
  /** raw dB from RecognitionListener.onRmsChanged; roughly -2..12 in practice */
  level: number;
}

export interface SpeechErrorEvent {
  code: number;
  name: string;
  /** transient codes (5, 6, 7, 8, 11) are restarted silently (§4) */
  transient: boolean;
  /** a message that names the actual fix, never a generic one (§11) */
  message: string;
}

export interface SpeechStateEvent {
  state:
    | 'starting'
    | 'listening'
    | 'restarted'
    | 'ready'
    | 'speech-start'
    | 'speech-end'
    | 'stopped'
    | 'cancelled'
    | 'failed'
    /**
     * Audio focus was lost. INFORMATIONAL ONLY — audio focus governs playback,
     * not capture, so this must never pause a recitation. A notification chime
     * emits this, and so does the system recognition service taking focus for
     * its own session.
     */
    | 'audio-focus-lost'
    | 'audio-focus-regained'
    /** the microphone really is gone (ERROR_AUDIO); offer a one-tap resume */
    | 'mic-unavailable'
    /**
     * The recognizer has no offline Arabic model, so the offline preference was
     * dropped and the session continues online. Informational: the session is
     * still alive, and this is the difference between recognising something and
     * recognising nothing at all.
     */
    | 'offline-unavailable'
    | 'segmented-unsupported';
  strategy: SpeechStrategy;
  /** measured gap, in ms, between releasing one recognizer and the next (§4.3) */
  relayGapMs: number;
  segmentedProven: boolean;
}

export interface StartOptions {
  locale?: string;
  maxResults?: number;
  preferOnDevice?: boolean;
  allowSegmented?: boolean;
  completeSilenceMs?: number;
  possiblyCompleteSilenceMs?: number;
  minimumLengthMs?: number;
}

export type ArabicSpeechEvents = {
  partial: (event: TranscriptEvent) => void;
  final: (event: TranscriptEvent) => void;
  rms: (event: RmsEvent) => void;
  error: (event: SpeechErrorEvent) => void;
  endOfSegment: () => void;
  state: (event: SpeechStateEvent) => void;
};
