/**
 * The calculation methods Aladhan supports.
 *
 * DELIBERATELY NOT A HARDCODED LIST. Method ids are an API's internal numbering,
 * and the only place they are authoritative is the API itself. I could not reach
 * api.aladhan.com from the machine this was written on, so writing out "21 is
 * Morocco, 3 is Muslim World League" from memory would have shipped a settings
 * screen whose labels might not match the numbers it sends — the worst kind of
 * wrong, because every prayer time would look deliberate.
 *
 * So the list is fetched from /v1/methods on the device, cached, and shown with
 * whatever names the API itself gives. Until it has been fetched once the app
 * keeps using the method it always used, and the screen says so.
 *
 * The parser is tolerant on purpose (the same lesson as the reciter list, whose
 * endpoint I got wrong once): accept the documented object-map shape, accept a
 * plain array, ignore anything without a numeric id and a name.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const METHODS_URL = 'https://api.aladhan.com/v1/methods';
const CACHE_KEY = 'quranhabit.prayerMethods.v1';

/**
 * What the app sends when the user has not chosen. 2 is what every build so far
 * has used, so leaving it alone means an update does not silently move anybody's
 * prayer times.
 */
export const FALLBACK_METHOD = 2;

export interface CalculationMethod {
  id: number;
  name: string;
  /** the method's own angles, when the API reports them — shown as evidence */
  detail: string | null;
}

/** Pull methods out of whatever shape the response is in. */
export function parseMethods(payload: unknown): CalculationMethod[] {
  const data = (payload as { data?: unknown })?.data ?? payload;
  const entries: unknown[] = Array.isArray(data)
    ? data
    : data !== null && typeof data === 'object'
      ? Object.values(data as Record<string, unknown>)
      : [];

  const out: CalculationMethod[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue;
    const row = entry as { id?: unknown; name?: unknown; params?: unknown };
    const id = typeof row.id === 'number' ? row.id : Number(row.id);
    if (!Number.isFinite(id) || !Number.isInteger(id) || id < 0) continue;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (name.length === 0) continue;
    out.push({ id, name, detail: describeParams(row.params) });
  }

  // Aladhan's map is keyed by shorthand, so the order is not meaningful; sort by
  // id so the list is stable between fetches.
  out.sort((a, b) => a.id - b.id);
  return out.filter((m, i) => i === 0 || out[i - 1].id !== m.id);
}

function describeParams(params: unknown): string | null {
  if (params === null || typeof params !== 'object') return null;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (typeof value === 'number' || typeof value === 'string') parts.push(`${key} ${value}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export async function loadCachedMethods(): Promise<CalculationMethod[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw === null) return [];
    return parseMethods(JSON.parse(raw));
  } catch {
    return [];
  }
}

export interface MethodsResult {
  methods: CalculationMethod[];
  /** why the list is empty or stale, phrased for a human (§11) */
  note: string | null;
}

/** Fetch and cache. Falls back to the cache, then to nothing — never throws. */
export async function fetchMethods(): Promise<MethodsResult> {
  try {
    const response = await fetch(METHODS_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = (await response.json()) as unknown;
    const methods = parseMethods(json);
    if (methods.length === 0) throw new Error('no methods in the response');
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(json));
    return { methods, note: null };
  } catch (e) {
    const cached = await loadCachedMethods();
    if (cached.length > 0) {
      return { methods: cached, note: "Showing the list saved earlier — you're offline." };
    }
    return {
      methods: [],
      note: `The list of calculation methods could not be loaded (${
        e instanceof Error ? e.message : String(e)
      }). Connect once and it will be saved for offline use.`,
    };
  }
}

export const methodName = (methods: readonly CalculationMethod[], id: number): string =>
  methods.find((m) => m.id === id)?.name ?? `Method ${id}`;
