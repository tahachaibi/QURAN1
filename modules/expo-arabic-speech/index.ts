/**
 * expo-arabic-speech — a thin, honest binding over android.speech.
 *
 * All the lifecycle intelligence lives in the Kotlin module (see
 * RecitationRecognizer.kt) and in src/recognition/useRecitationRecognizer.ts.
 * This file is only the boundary.
 */
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';
import { Platform } from 'react-native';

import type {
  ArabicSpeechEvents,
  LanguageStatus,
  SpeechCapabilities,
  StartOptions,
} from './src/ArabicSpeech.types';

export * from './src/ArabicSpeech.types';

/**
 * Declared structurally rather than by extending `NativeModule`.
 *
 * expo-modules-core exports `NativeModule` as `typeof NativeModule` — a VALUE
 * alias — so `extends NativeModule<...>` fails with TS2749. The real class type
 * only exists at an internal path (build/ts-declarations/NativeModule) that is
 * not part of the package's public surface, and reaching into it would break on
 * any patch bump. Spelling out the two emitter members we use is the stable
 * option; §10 warned about exactly this shape of dependency trap.
 */
interface ArabicSpeechModule {
  addListener<K extends keyof ArabicSpeechEvents>(
    eventName: K,
    listener: ArabicSpeechEvents[K],
  ): EventSubscription;
  removeAllListeners(eventName: keyof ArabicSpeechEvents): void;

  isAvailable(): Promise<boolean>;
  supportsOnDevice(): Promise<boolean>;
  capabilities(): Promise<SpeechCapabilities>;
  languageStatus(locale: string): Promise<LanguageStatus>;
  requestLanguageDownload(locale: string): Promise<'requested' | 'unsupported'>;
  start(options: StartOptions): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  isActive(): Promise<boolean>;
}

/**
 * Android-only. On any other platform this throws with a message that names the
 * reason instead of failing as an undefined property access three frames later.
 */
function load(): ArabicSpeechModule {
  if (Platform.OS !== 'android') {
    throw new Error(
      'expo-arabic-speech is Android-only: it wraps android.speech.SpeechRecognizer. ' +
        `This build is running on ${Platform.OS}.`,
    );
  }
  try {
    return requireNativeModule<ArabicSpeechModule>('ArabicSpeech');
  } catch (cause) {
    throw new Error(
      'The ArabicSpeech native module is not linked into this binary. It cannot work in Expo Go — ' +
        'build a dev client with "eas build --profile development --platform android" and install that APK. ' +
        `(underlying: ${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
}

let cached: ArabicSpeechModule | null = null;

export function ArabicSpeech(): ArabicSpeechModule {
  if (cached === null) cached = load();
  return cached;
}

/** True when the native module is present, without throwing. */
export function isArabicSpeechLinked(): boolean {
  try {
    ArabicSpeech();
    return true;
  } catch {
    return false;
  }
}
