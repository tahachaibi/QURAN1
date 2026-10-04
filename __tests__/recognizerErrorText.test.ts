/**
 * Recognizer errors, in the reader's language.
 *
 * THE REGRESSION: any error name without a case fell through to the module's
 * own English message. The module's own failures had no case at all, so on a
 * phone without Google speech services an Arabic-interface reader tapped the
 * microphone and got a long English paragraph in the red chip. And SERVER said
 * "restarting" in the one situation where nothing would restart.
 */
import { translate } from '../src/i18n/i18n';
import { recognizerErrorText } from '../src/recognition/errorText';

const ar = (english: string, params?: Record<string, string | number>) => translate('ar', english, params);
const en = (english: string, params?: Record<string, string | number>) => translate('en', english, params);
const LATIN_SENTENCE = /[A-Za-z]{4,} [A-Za-z]{2,} [A-Za-z]{2,}/;

describe('recognizer error text', () => {
  it.each(['unavailable', 'create-failed', 'start-failed', 'start-threw', 'recognizer-unavailable', 'TOO_MANY_REQUESTS', 'UNKNOWN_99'])(
    'is never the module’s English in the Arabic interface: %s',
    (name) => {
      const text = recognizerErrorText({ name, message: 'Some long English advice from the Kotlin side.' }, ar);
      expect(text).not.toContain('English advice');
      expect(text).not.toMatch(LATIN_SENTENCE);
    },
  );

  it('keeps the code of an error it has no sentence for', () => {
    expect(recognizerErrorText({ name: 'UNKNOWN_99', message: 'x' }, en)).toBe('Speech recognition error (UNKNOWN_99).');
  });

  it('does not promise a restart for a server error, which is shown only once retries are spent', () => {
    expect(recognizerErrorText({ name: 'SERVER', message: 'x' }, en)).not.toMatch(/restarting/);
    // a dropped connection still is restarted, silently
    expect(recognizerErrorText({ name: 'SERVER_DISCONNECTED', message: 'x' }, en)).toMatch(/restarting/);
  });
});
