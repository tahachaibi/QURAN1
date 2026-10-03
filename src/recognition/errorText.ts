/**
 * What a recognizer error says to the reader, in their language.
 *
 * The native module writes its advice in English, because Kotlin has no idea
 * which language the interface is in. Every error carries a stable `name`,
 * though, so the sentence is chosen here from the name. The English below
 * mirrors errorAdvice() in RecitationRecognizer.kt. An unknown name falls back
 * to whatever the module said, in English, which beats saying nothing.
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
      return t("The Arabic offline pack is not downloaded yet. Tap 'Install Arabic offline' on the recitation screen.");
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
    default:
      return error.message;
  }
}
