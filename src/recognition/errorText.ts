/**
 * What a recognizer error says to the reader, in their language.
 *
 * The native module writes its advice in English, because Kotlin has no idea
 * which language the interface is in. Every error carries a stable `name`,
 * though, so the sentence is chosen here from the name. The English below
 * mirrors errorAdvice() in RecitationRecognizer.kt. An unknown name is shown as
 * its code in a translated sentence, never as the module's English.
 */
import type { T } from '../i18n/i18n';

export function recognizerErrorText(error: { name: string; message: string }, t: T): string {
  switch (error.name) {
    case 'INSUFFICIENT_PERMISSIONS':
      return t('Microphone permission was denied. Grant it in Settings > Apps > Tasmee Hifz > Permissions > Microphone.');
    case 'LANGUAGE_NOT_SUPPORTED':
      return t(
        'This recognizer has no Arabic model. Try a different locale in Settings (ar-EG, ar-MA), or install Arabic under Settings > System > Languages & input > Voice input > Google > Offline speech recognition.',
      );
    case 'LANGUAGE_UNAVAILABLE':
      return t('The Arabic offline pack is not downloaded yet. Tap “Install Arabic offline pack” on the recitation screen.');
    case 'AUDIO':
      return t(
        'The microphone could not be read. Something else is holding it — end any call, voice recorder or assistant, then tap resume.',
      );
    case 'NETWORK':
    case 'NETWORK_TIMEOUT':
      return t(
        'The recognizer fell back to the network and could not reach it. Install the Arabic offline pack to work fully offline.',
      );
    case 'SERVER':
      // Retried natively first; this is only shown once it has given up.
      return t('The recognition service stopped responding. Tap the microphone to try again.');
    case 'SERVER_DISCONNECTED':
      return t('The recognition service dropped the session; restarting.');
    case 'NO_MATCH':
    case 'SPEECH_TIMEOUT':
      return t('Nothing recognized in that window; restarting.');
    case 'RECOGNIZER_BUSY':
      return t('The recognition service is busy; restarting.');
    case 'CLIENT':
      return t('The recognition service reported a client error; restarting.');
    case 'no-recognition':
      return t(
        'The microphone is working but the recognizer returned nothing after several restarts. Install the Arabic offline pack, or try a different locale in Settings (ar-EG, ar-MA).',
      );
    // The names below are the module's own failures (RecitationRecognizer.kt
    // emitError) and the hook's. Each used to fall through to the English
    // message, which on a phone without Google speech services put a long
    // English paragraph in the red chip of an Arabic interface.
    case 'unavailable':
      return t('No speech recognition service is installed on this phone. Install or enable the Google app, then try again.');
    case 'create-failed':
      return t('The speech recognizer could not be started. Check that the microphone permission is granted.');
    case 'start-failed':
    case 'start-threw':
      return t('The speech recognizer could not start listening. Tap the microphone to try again.');
    case 'recognizer-unavailable':
      return t(
        'The speech recognition service keeps failing to start. Close other apps using voice input, or check that Google speech services are installed and enabled, then tap the microphone again.',
      );
    default:
      // TOO_MANY_REQUESTS, CANNOT_CHECK_SUPPORT, UNKNOWN_n: rare enough that
      // the code itself is the useful part, and it reads the same in any language.
      return t('Speech recognition error ({name}).', { name: error.name });
  }
}
