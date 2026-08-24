/**
 * The reciter-list parser.
 *
 * The API cannot be reached from the environment this was written in, so the
 * parser is deliberately tolerant of the shapes it is documented and reported to
 * return. These tests are the substitute for calling it: each one is a shape the
 * endpoint plausibly emits, plus the malformed cases that must not produce a
 * broken reciter.
 */
import {
  BUILTIN_RECITERS,
  parseReciters,
  reciterLabel,
  searchReciters,
  surahAudioUrl,
  type Reciter,
} from '../src/data/audio';

describe('surah audio URLs', () => {
  it('zero-pads the surah and keeps one slash', () => {
    expect(surahAudioUrl(1, 'yasser_ad-dussary/')).toBe(
      'https://download.quranicaudio.com/quran/yasser_ad-dussary/001.mp3',
    );
    // a path without its trailing slash must not produce a double or missing one
    expect(surahAudioUrl(114, 'yasser_ad-dussary')).toBe(
      'https://download.quranicaudio.com/quran/yasser_ad-dussary/114.mp3',
    );
    expect(surahAudioUrl(36, 'mahmood_khaleel_al-husaree/')).toContain('/036.mp3');
  });

  it('clamps out-of-range surahs rather than building a 404', () => {
    expect(surahAudioUrl(0, 'x/')).toContain('/001.mp3');
    expect(surahAudioUrl(999, 'x/')).toContain('/114.mp3');
  });
});

describe('parseReciters tolerates the shapes the endpoint may return', () => {
  it('a bare array with snake_case keys', () => {
    const out = parseReciters([
      { id: 1, name: 'Yasser Al-Dosari', arabic_name: 'ياسر الدوسري', relative_path: 'yasser_ad-dussary/' },
    ]);
    expect(out).toEqual([
      {
        id: 'yasser_ad-dussary/',
        name: 'Yasser Al-Dosari',
        path: 'yasser_ad-dussary/',
        arabicName: 'ياسر الدوسري',
        style: undefined,
      },
    ]);
  });

  it('a wrapped array, camelCase keys, missing trailing slash', () => {
    const out = parseReciters({ reciters: [{ name: 'Husary', relativePath: 'mahmood_khaleel_al-husaree' }] });
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe('mahmood_khaleel_al-husaree/');
  });

  it('flattens a reciter that carries several recordings', () => {
    const out = parseReciters({
      data: [
        {
          name: 'Abdul Basit',
          arabic_name: 'عبد الباسط',
          moshaf: [
            { name: 'Murattal', relative_path: 'abdul_basit/murattal/' },
            { name: 'Mujawwad', relative_path: 'abdul_basit/mujawwad/' },
          ],
        },
      ],
    });
    expect(out.map((r) => r.path)).toEqual(['abdul_basit/mujawwad/', 'abdul_basit/murattal/']);
    expect(out.every((r) => r.name === 'Abdul Basit')).toBe(true);
    expect(out.map((r) => r.style).sort()).toEqual(['Mujawwad', 'Murattal']);
  });

  it('falls back to the reciter path when a nested list has no usable paths', () => {
    const out = parseReciters([
      { name: 'Someone', relative_path: 'someone/', recitations: [{ name: 'no path here' }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe('someone/');
  });

  it('drops entries that are missing a name or a path instead of inventing one', () => {
    expect(parseReciters([{ relative_path: 'nameless/' }])).toEqual([]);
    expect(parseReciters([{ name: 'Pathless' }])).toEqual([]);
    expect(parseReciters([{ name: '   ', relative_path: 'blank/' }])).toEqual([]);
  });

  it('deduplicates by folder, since the folder is the recording', () => {
    const out = parseReciters([
      { name: 'A', relative_path: 'same/' },
      { name: 'B', relative_path: 'same' },
    ]);
    expect(out).toHaveLength(1);
  });

  it('returns nothing for junk, so the caller keeps the list it has', () => {
    for (const junk of [null, undefined, 42, 'hello', {}, { reciters: 'nope' }, [null, 7, 'x']]) {
      expect(parseReciters(junk)).toEqual([]);
    }
  });

  it('sorts by name so the picker is scannable', () => {
    const out = parseReciters([
      { name: 'Zayd', relative_path: 'z/' },
      { name: 'Adam', relative_path: 'a/' },
      { name: 'Musa', relative_path: 'm/' },
    ]);
    expect(out.map((r) => r.name)).toEqual(['Adam', 'Musa', 'Zayd']);
  });
});

describe('the bundled fallback list', () => {
  it('has Yasser Al-Dosari, and every path ends in a slash', () => {
    expect(BUILTIN_RECITERS.some((r) => r.name.includes('Yasser'))).toBe(true);
    for (const r of BUILTIN_RECITERS) {
      expect(r.path.endsWith('/')).toBe(true);
      expect(r.id).toBe(r.path);
    }
  });

  it('has no duplicate paths', () => {
    const paths = BUILTIN_RECITERS.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('search and labels', () => {
  const list: Reciter[] = [
    { id: 'a/', name: 'Yasser Al-Dosari', arabicName: 'ياسر الدوسري', path: 'a/' },
    { id: 'b/', name: 'Husary', path: 'b/', style: 'mujawwad' },
  ];

  it('matches on latin name, arabic name, style and folder', () => {
    expect(searchReciters(list, 'dosari')).toHaveLength(1);
    expect(searchReciters(list, 'الدوسري')).toHaveLength(1);
    expect(searchReciters(list, 'mujawwad')).toHaveLength(1);
    expect(searchReciters(list, 'b/')).toHaveLength(1);
    expect(searchReciters(list, '')).toHaveLength(2);
    expect(searchReciters(list, 'nobody')).toHaveLength(0);
  });

  it('only appends a style when there is one', () => {
    expect(reciterLabel(list[0])).toBe('Yasser Al-Dosari');
    expect(reciterLabel(list[1])).toBe('Husary · mujawwad');
  });
});
