/**
 * Per-ayah audio (spec §8, Listen tab).
 *
 * cdn.islamic.network serves one MP3 per ayah keyed by the GLOBAL ayah number,
 * at `/quran/audio/{bitrate}/{reciter}/{globalAyah}.mp3`.
 *
 * The bitrate is part of the path, and it differs per reciter — 128 for most,
 * 192 or 64 or 32 for others. Hard-coding one guess per reciter means a wrong
 * guess is a silent 404 and a reciter that simply never plays, so the player
 * PROBES instead: it tries the candidate bitrates in order and remembers the one
 * that worked. That way the list is useful even where a bitrate is wrong, and a
 * genuinely unavailable reciter can be reported as unavailable rather than
 * appearing to be broken playback.
 */
export interface Reciter {
  id: string;
  name: string;
  arabicName: string;
  /** bitrates to try, best first */
  bitrates: number[];
  /** murattal (measured) or mujawwad (melodic) */
  style?: 'murattal' | 'mujawwad';
}

/** Bitrates tried for any reciter whose own list is exhausted. */
export const FALLBACK_BITRATES = [128, 64, 192, 32] as const;

export const RECITERS: readonly Reciter[] = [
  { id: 'ar.alafasy', name: 'Mishary Rashid Alafasy', arabicName: 'مشاري راشد العفاسي', bitrates: [128, 64] },
  { id: 'ar.abdulbasitmurattal', name: 'Abdul Basit Abdus Samad', arabicName: 'عبد الباسط عبد الصمد', bitrates: [192, 128, 64], style: 'murattal' },
  { id: 'ar.abdulsamad', name: 'Abdul Basit Abdus Samad', arabicName: 'عبد الباسط عبد الصمد', bitrates: [64, 128], style: 'mujawwad' },
  { id: 'ar.abdurrahmaansudais', name: 'Abdur Rahman As-Sudais', arabicName: 'عبد الرحمن السديس', bitrates: [192, 128, 64] },
  { id: 'ar.mahermuaiqly', name: 'Maher Al Muaiqly', arabicName: 'ماهر المعيقلي', bitrates: [128, 64] },
  { id: 'ar.husary', name: 'Mahmoud Khalil Al-Husary', arabicName: 'محمود خليل الحصري', bitrates: [128, 64], style: 'murattal' },
  { id: 'ar.husarymujawwad', name: 'Mahmoud Khalil Al-Husary', arabicName: 'محمود خليل الحصري', bitrates: [128, 64], style: 'mujawwad' },
  { id: 'ar.minshawi', name: 'Mohamed Siddiq Al-Minshawi', arabicName: 'محمد صديق المنشاوي', bitrates: [128, 64], style: 'murattal' },
  { id: 'ar.minshawimujawwad', name: 'Mohamed Siddiq Al-Minshawi', arabicName: 'محمد صديق المنشاوي', bitrates: [64, 128], style: 'mujawwad' },
  { id: 'ar.hudhaify', name: 'Ali Al-Hudhaify', arabicName: 'علي الحذيفي', bitrates: [128, 64, 32] },
  { id: 'ar.shaatree', name: 'Abu Bakr Ash-Shaatree', arabicName: 'أبو بكر الشاطري', bitrates: [128, 64] },
  { id: 'ar.ahmedajamy', name: 'Ahmed ibn Ali Al-Ajamy', arabicName: 'أحمد بن علي العجمي', bitrates: [128, 64] },
  { id: 'ar.hanirifai', name: 'Hani Ar-Rifai', arabicName: 'هاني الرفاعي', bitrates: [192, 128, 64] },
  { id: 'ar.abdullahbasfar', name: 'Abdullah Basfar', arabicName: 'عبد الله بصفر', bitrates: [192, 128, 64, 32] },
  { id: 'ar.saoodshuraym', name: 'Saood Ash-Shuraym', arabicName: 'سعود الشريم', bitrates: [64, 128] },
  { id: 'ar.muhammadayyoub', name: 'Muhammad Ayyoub', arabicName: 'محمد أيوب', bitrates: [128, 64, 32] },
  { id: 'ar.muhammadjibreel', name: 'Muhammad Jibreel', arabicName: 'محمد جبريل', bitrates: [128, 64, 32] },
  { id: 'ar.ibrahimakhbar', name: 'Ibrahim Akhdar', arabicName: 'إبراهيم الأخضر', bitrates: [32, 64, 128] },
  { id: 'ar.aymanswoaid', name: 'Ayman Sowaid', arabicName: 'أيمن سويد', bitrates: [64, 128] },
  { id: 'ar.parhizgar', name: 'Shahriar Parhizgar', arabicName: 'شهریار پرهیزگار', bitrates: [48, 64, 128] },
];

export const reciterById = (id: string): Reciter =>
  RECITERS.find((r) => r.id === id) ?? RECITERS[0];

/** Every bitrate worth trying for a reciter, best guess first, no duplicates. */
export function bitrateCandidates(reciterId: string): number[] {
  const reciter = reciterById(reciterId);
  return [...new Set([...reciter.bitrates, ...FALLBACK_BITRATES])];
}

/** `globalAyah` is 1-based, matching quran-data.json's second column. */
export function ayahAudioUrl(globalAyah: number, reciterId: string, bitrate: number): string {
  return `https://cdn.islamic.network/quran/audio/${bitrate}/${reciterId}/${globalAyah}.mp3`;
}

/** Free-text search over both names, for the reciter picker. */
export function searchReciters(query: string): readonly Reciter[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return RECITERS;
  return RECITERS.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.arabicName.includes(query.trim()) ||
      r.id.toLowerCase().includes(q) ||
      (r.style ?? '').includes(q),
  );
}

/** Display label that disambiguates the two recordings some reciters have. */
export const reciterLabel = (r: Reciter): string =>
  r.style === undefined ? r.name : `${r.name} · ${r.style}`;
