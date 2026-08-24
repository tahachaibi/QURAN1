/**
 * Full-surah recitation audio (spec §8, Listen tab).
 *
 * Two deliberate changes from the first version.
 *
 * WHOLE SURAHS, not ayah files. Chaining one MP3 per ayah meant a gap and a
 * fresh network request at every verse, which is not how anyone listens to the
 * Quran. QuranicAudio serves one file per surah per reciter:
 *
 *   https://download.quranicaudio.com/quran/{relativePath}{surah:03}.mp3
 *
 * THE RECITER LIST IS FETCHED, not hard-coded. The list is keyed by folder name
 * (`yasser_ad-dussary/`), and a wrong folder is a silent 404. I cannot reach the
 * API from my environment to check any of them, so guessing a hundred names would
 * be shipping a hundred maybe-broken entries. Instead the app asks the API for the
 * real list on first use and caches it; the small bundled list below is only the
 * cold-start fallback, and every path in it is one I have seen written down.
 */
export interface Reciter {
  /** stable id: the relative path, which is unique per recording */
  id: string;
  name: string;
  arabicName?: string;
  /** folder under /quran/, always ending in a slash */
  path: string;
  /** murattal / mujawwad / studio etc., when the source distinguishes them */
  style?: string;
}

export const RECITERS_ENDPOINT = 'https://api.quranicaudio.com/v2/reciters';
const AUDIO_BASE = 'https://download.quranicaudio.com/quran/';

/**
 * Cold-start list. Every path here is one I have seen quoted verbatim in
 * QuranicAudio's own app or docs — not inferred from a naming pattern. The real
 * list is hundreds long and arrives from the API.
 */
export const BUILTIN_RECITERS: readonly Reciter[] = [
  { id: 'yasser_ad-dussary/', name: 'Yasser Al-Dosari', arabicName: 'ياسر الدوسري', path: 'yasser_ad-dussary/' },
  { id: 'mahmood_khaleel_al-husaree/', name: 'Mahmoud Khalil Al-Husary', arabicName: 'محمود خليل الحصري', path: 'mahmood_khaleel_al-husaree/' },
  { id: 'abdullaah_3awwaad_al-juhaynee/', name: 'Abdullah Awad Al-Juhani', arabicName: 'عبد الله عواد الجهني', path: 'abdullaah_3awwaad_al-juhaynee/' },
  { id: 'abdullaah_alee_jaabir_studio/', name: 'Abdullah Ali Jabir', arabicName: 'عبد الله علي جابر', path: 'abdullaah_alee_jaabir_studio/', style: 'studio' },
  { id: 'alhusaynee_al3azazee_with_children/', name: "Al-Hussayni Al-'Azazy", arabicName: 'الحسيني العزازي', path: 'alhusaynee_al3azazee_with_children/', style: 'with children' },
];

/** `surah` is 1..114. */
export function surahAudioUrl(surah: number, path: string): string {
  const s = surah < 1 ? 1 : surah > 114 ? 114 : Math.floor(surah);
  const folder = path.endsWith('/') ? path : `${path}/`;
  return `${AUDIO_BASE}${folder}${String(s).padStart(3, '0')}.mp3`;
}

export const reciterLabel = (r: Reciter): string =>
  r.style === undefined || r.style.length === 0 ? r.name : `${r.name} · ${r.style}`;

/** Free-text search over both names, the style and the folder. */
export function searchReciters(all: readonly Reciter[], query: string): readonly Reciter[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return all;
  return all.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      (r.arabicName ?? '').includes(query.trim()) ||
      (r.style ?? '').toLowerCase().includes(q) ||
      r.path.toLowerCase().includes(q),
  );
}

// ---------------------------------------------------------------------------
// parsing the API response
// ---------------------------------------------------------------------------

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const pick = (o: Record<string, unknown>, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = str(o[k]);
    if (v !== undefined) return v;
  }
  return undefined;
};

/**
 * Turn an API payload into reciters, tolerantly.
 *
 * Written to survive the shapes this endpoint is documented and reported to
 * return — a bare array or one wrapped in `reciters`/`data`, snake_case or
 * camelCase keys, and reciters that carry several recordings in a nested list —
 * because I cannot call it from here to see which it actually is. Anything
 * without both a name and a path is dropped rather than guessed at, and a payload
 * that yields nothing leaves the caller on its existing list.
 */
export function parseReciters(payload: unknown): Reciter[] {
  const root =
    Array.isArray(payload)
      ? payload
      : payload !== null && typeof payload === 'object'
        ? ((payload as Record<string, unknown>).reciters ??
          (payload as Record<string, unknown>).data ??
          (payload as Record<string, unknown>).results)
        : undefined;
  if (!Array.isArray(root)) return [];

  const out: Reciter[] = [];
  const seen = new Set<string>();

  const add = (name: string, path: string, arabicName?: string, style?: string) => {
    const folder = path.endsWith('/') ? path : `${path}/`;
    if (seen.has(folder)) return;
    seen.add(folder);
    out.push({ id: folder, name, path: folder, arabicName, style });
  };

  for (const entry of root) {
    if (entry === null || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const name = pick(o, 'name', 'english_name', 'englishName', 'title');
    if (name === undefined) continue;
    const arabicName = pick(o, 'arabic_name', 'arabicName', 'name_arabic');

    // a reciter may carry several recordings, each with its own folder
    const nested = ['moshaf', 'recitations', 'audio', 'styles', 'qirat'].
      map((k) => o[k]).
      find((v): v is unknown[] => Array.isArray(v));

    if (nested !== undefined && nested.length > 0) {
      let added = 0;
      for (const sub of nested) {
        if (sub === null || typeof sub !== 'object') continue;
        const s = sub as Record<string, unknown>;
        const path = pick(s, 'relative_path', 'relativePath', 'path', 'server');
        if (path === undefined) continue;
        add(name, path, arabicName, pick(s, 'name', 'style', 'title'));
        added++;
      }
      if (added > 0) continue;
    }

    const path = pick(o, 'relative_path', 'relativePath', 'path');
    if (path === undefined) continue;
    add(name, path, arabicName, pick(o, 'style'));
  }

  out.sort((a, b) => a.name.localeCompare(b.name) || (a.style ?? '').localeCompare(b.style ?? ''));
  return out;
}

/** Ask the API for the full list. Throws on network or parse failure. */
export async function fetchReciters(signal?: AbortSignal): Promise<Reciter[]> {
  const response = await fetch(RECITERS_ENDPOINT, { signal });
  if (!response.ok) throw new Error(`reciter list: HTTP ${response.status}`);
  const parsed = parseReciters((await response.json()) as unknown);
  if (parsed.length === 0) throw new Error('reciter list: nothing usable in the response');
  return parsed;
}
