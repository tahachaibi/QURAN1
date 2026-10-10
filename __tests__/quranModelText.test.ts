/**
 * The built-in Quran model writes with full harakat and in ordinary spelling
 * (مَالِكِ, الصِّرَاطَ), where Android's recognizer writes neither. The engine
 * must follow it just the same. The transcripts are the model's own output on
 * Al-Husary's recitation, from the quran-model CI job.
 */
import { replay, type ReplayEvent } from '../src/engine/replay';
import type { SessionConfig } from '../src/engine/session';
import { surahOf, wordIndexOf, words } from '../src/data/quran';
import { vocabulary } from '../src/engine/searchIndex';

const config: SessionConfig = { words, surahOf, vocabulary: vocabulary(), floor: 0, limit: words.length, viewSurah: 1 };

const MODEL_FATIHA = [
  'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ',
  'الرَّحْمَنِ الرَّحِيمِ',
  'مَالِكِ يَوْمِ الدِّينِ',
  'إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ',
  'اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ',
  'صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ',
];

/** each ayah as the model streams it: a growing partial per word, then the final */
function streamed(ayahs: string[]): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  for (const ayah of ayahs) {
    const w = ayah.split(' ');
    for (let n = 1; n <= w.length; n++) events.push({ kind: 'partial', alternatives: [w.slice(0, n).join(' ')], dt: 400 });
    events.push({ kind: 'final', alternatives: [ayah], dt: 300 });
    events.push({ kind: 'segment', dt: 50 });
  }
  return events;
}

describe("the built-in model's transcripts", () => {
  it.each([false, true])('are followed through Al-Fatiha with no mistakes (strict=%s)', (strict) => {
    const out = replay(
      { name: 'model-fatiha', startCursor: wordIndexOf(1, 2), synthetic: true, events: streamed(MODEL_FATIHA) },
      { ...config, strict },
    );
    expect(out.final.cursor).toBe(wordIndexOf(2, 1));
    expect(out.mistakes).toEqual([]);
  });

  it('find the reciter from elsewhere, as Android\'s do', () => {
    const out = replay(
      {
        name: 'model-jump',
        startCursor: wordIndexOf(36, 1),
        synthetic: true,
        events: streamed(['ذَلِكَ الْكِتَابُ لَا رَيْبَ فِيهِ هُدًى لِلْمُتَّقِينَ']),
      },
      config,
    );
    expect(out.final.cursor).toBe(wordIndexOf(2, 3));
  });
});
