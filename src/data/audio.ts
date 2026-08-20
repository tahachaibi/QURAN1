/**
 * Per-ayah audio (spec §8, Listen tab).
 *
 * cdn.islamic.network serves one MP3 per ayah keyed by the GLOBAL ayah number,
 * which is exactly the coordinate the data layer already carries. Playback is
 * the only thing in the app besides prayer times that touches the network, and
 * failing to reach it must never look like an error.
 */
export interface Reciter {
  id: string;
  name: string;
  arabicName: string;
  bitrate: number;
}

export const RECITERS: readonly Reciter[] = [
  { id: 'ar.alafasy', name: 'Mishary Alafasy', arabicName: 'مشاري العفاسي', bitrate: 128 },
  { id: 'ar.abdulbasitmurattal', name: 'Abdul Basit (Murattal)', arabicName: 'عبد الباسط', bitrate: 192 },
  { id: 'ar.husary', name: 'Mahmoud Khalil Al-Husary', arabicName: 'محمود الحصري', bitrate: 128 },
  { id: 'ar.minshawi', name: 'Mohamed Siddiq Al-Minshawi', arabicName: 'محمد صديق المنشاوي', bitrate: 128 },
  { id: 'ar.shaatree', name: 'Abu Bakr Ash-Shaatree', arabicName: 'أبو بكر الشاطري', bitrate: 128 },
  { id: 'ar.hudhaify', name: 'Ali Al-Hudhaify', arabicName: 'علي الحذيفي', bitrate: 128 },
];

export const reciterById = (id: string): Reciter => RECITERS.find((r) => r.id === id) ?? RECITERS[0];

/** `globalAyah` is 1-based, matching quran-data.json's second column. */
export function ayahAudioUrl(globalAyah: number, reciterId: string): string {
  const reciter = reciterById(reciterId);
  return `https://cdn.islamic.network/quran/audio/${reciter.bitrate}/${reciter.id}/${globalAyah}.mp3`;
}
