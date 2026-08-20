/**
 * The real Madani line layout (QCF V2, 1421H print), imported from QUL.
 *
 * Page boundaries AND line breaks both come from here, so the app renders the
 * printed page rather than a plausible-looking approximation of it. The encoding
 * is one string per page, built by scripts/gen-mushaf-lines.mjs:
 *
 *   s2        a surah band, for surah 2
 *   b         the basmala, on its own line
 *   a29:36    an ayah line covering my word indices 29..36
 *   a29:36^   ...that begins with the previous ayah's end marker
 *   a29:36$   ...that ends with its last ayah's end marker
 *   a-1:-1^   a line carrying only a marker
 *   =         suffix: the line is centred rather than justified
 *
 * Ayah-end markers between words are implied: any ayah whose last word falls
 * inside the range gets its marker straight after that word. That keeps the
 * asset at 113 KB instead of listing 83,668 tokens.
 */
import rawLines from '../assets/quran-lines.json';
import { ayahOf, ayahStartWord, globalAyahOf, TOTAL_PAGES } from './quran';

const RAW = rawLines as unknown as {
  name: string;
  pages: number;
  linesPerPage: number;
  font: string;
  lines: string[];
};

export const LAYOUT_NAME = RAW.name;
export const LINES_PER_PAGE = RAW.linesPerPage;

export type LineToken =
  | { kind: 'word'; index: number }
  | { kind: 'marker'; ayah: number };

export interface MushafLine {
  kind: 'surah' | 'basmala' | 'ayah';
  /** for a surah band */
  surah: number;
  /** centred rather than justified */
  centered: boolean;
  tokens: LineToken[];
}

if (RAW.lines.length !== TOTAL_PAGES) {
  throw new Error(
    `quran-lines.json has ${RAW.lines.length} pages, expected ${TOTAL_PAGES}. ` +
      `Re-run "npm run gen" to regenerate src/assets/.`,
  );
}

const cache = new Map<number, MushafLine[]>();

function decodePage(page: number): MushafLine[] {
  const encoded = RAW.lines[page - 1];
  const out: MushafLine[] = [];

  for (const segment of encoded.split('|')) {
    if (segment.startsWith('s')) {
      out.push({ kind: 'surah', surah: Number(segment.slice(1)), centered: true, tokens: [] });
      continue;
    }
    if (segment === 'b') {
      out.push({ kind: 'basmala', surah: 0, centered: true, tokens: [] });
      continue;
    }
    // aFROM:TO with optional ^ $ = flags
    const centered = segment.endsWith('=');
    const body = centered ? segment.slice(1, -1) : segment.slice(1);
    const startsWithMarker = body.includes('^');
    const endsWithMarker = body.includes('$');
    const [fromRaw, toRaw] = body.replace(/[\^$]/g, '').split(':');
    const from = Number(fromRaw);
    const to = Number(toRaw);

    const tokens: LineToken[] = [];
    if (startsWithMarker) {
      // the marker of the ayah that ended just before this line
      const previous = from >= 0 ? from - 1 : lastWordBefore(out);
      if (previous >= 0) tokens.push({ kind: 'marker', ayah: ayahOf(previous) });
    }
    if (from >= 0) {
      for (let i = from; i <= to; i++) {
        tokens.push({ kind: 'word', index: i });
        const endsAyahHere = i + 1 >= endOfAyah(i);
        if (endsAyahHere && (i < to || endsWithMarker)) {
          tokens.push({ kind: 'marker', ayah: ayahOf(i) });
        }
      }
    }
    out.push({ kind: 'ayah', surah: 0, centered, tokens });
  }
  return out;
}

/** one past the last word index of the ayah containing word i */
function endOfAyah(i: number): number {
  return ayahStartWord[globalAyahOf(i) + 1];
}

/** last word index rendered so far on this page, for a leading marker */
function lastWordBefore(lines: readonly MushafLine[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const tokens = lines[i].tokens;
    for (let k = tokens.length - 1; k >= 0; k--) {
      const t = tokens[k];
      if (t.kind === 'word') return t.index;
    }
  }
  return -1;
}

/** The real lines of a mushaf page, in order. Cached; safe to call per render. */
export function linesOfPage(page: number): MushafLine[] {
  const p = page < 1 ? 1 : page > TOTAL_PAGES ? TOTAL_PAGES : page | 0;
  const hit = cache.get(p);
  if (hit !== undefined) return hit;
  const decoded = decodePage(p);
  cache.set(p, decoded);
  return decoded;
}

/** Total tokens on a page — used by the density fit and by the tests. */
export function tokenCountOfPage(page: number): number {
  return linesOfPage(page).reduce((n, l) => n + l.tokens.length, 0);
}
