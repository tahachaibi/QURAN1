/**
 * The adhan library: which recording sounds, and what happens when it is gone.
 *
 * The failure worth guarding: a selection pointing at a recording the user has
 * since deleted. If that resolved to nothing, deleting a file would silence the
 * call to prayer — so it falls back to something that exists instead.
 */
import {
  BUNDLED_ADHAN,
  library,
  nameFromFile,
  nextAdhanId,
  selectedAdhan,
  storedToEntry,
  type StoredAdhan,
} from '../src/data/adhanLibrary';

const added = (id: string, fileName: string): StoredAdhan => ({
  id,
  name: nameFromFile(fileName),
  fileName,
  detail: '2.1 MB',
  uri: `file:///data/${fileName}`,
});

describe('library', () => {
  it('always offers what ships with the app', () => {
    const all = library([]);
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all[0].builtIn).toBe(true);
    expect(all[0].asset).not.toBeNull();
    expect(all[0].uri).toBeNull();
  });

  it('puts the built-in first and additions after, in the order they were added', () => {
    const all = library([added('added-1', 'one.mp3'), added('added-2', 'two.mp3')]);
    expect(all[0].builtIn).toBe(true);
    expect(all.slice(1).map((e) => e.id)).toEqual(['added-1', 'added-2']);
  });

  it('marks additions as removable and gives them a URI, not an asset', () => {
    const entry = storedToEntry(added('added-1', 'one.mp3'));
    expect(entry.builtIn).toBe(false);
    expect(entry.asset).toBeNull();
    expect(entry.uri).toBe('file:///data/one.mp3');
  });
});

describe('selectedAdhan', () => {
  it('returns what is selected', () => {
    const list = [added('added-1', 'one.mp3')];
    expect(selectedAdhan(list, 'added-1')?.fileName).toBe('one.mp3');
    expect(selectedAdhan(list, BUNDLED_ADHAN.id)?.builtIn).toBe(true);
  });

  it('falls back to something that exists rather than to silence', () => {
    // A recording the user deleted must not be the reason a prayer goes
    // unannounced.
    const list = [added('added-1', 'one.mp3')];
    expect(selectedAdhan(list, 'added-9')?.builtIn).toBe(true);
    expect(selectedAdhan([], 'added-9')?.builtIn).toBe(true);
  });

  it('treats no selection as the first entry', () => {
    expect(selectedAdhan([], null)?.builtIn).toBe(true);
  });
});

describe('nextAdhanId', () => {
  it('never collides with a built-in or an existing addition', () => {
    const list = [added('added-1', 'one.mp3'), added('added-2', 'two.mp3')];
    const id = nextAdhanId(list);
    expect(list.map((e) => e.id)).not.toContain(id);
    expect(library(list).map((e) => e.id)).not.toContain(id);
  });

  it('copes with gaps left by deletions', () => {
    const list = [added('added-3', 'three.mp3')];
    expect(nextAdhanId(list)).not.toBe('added-3');
  });
});

describe('nameFromFile', () => {
  it('turns a file name into something a person recognises', () => {
    expect(nameFromFile('adhan_makkah.mp3')).toBe('adhan makkah');
    expect(nameFromFile('Adhan-Abd-Elmajid.wav')).toBe('Adhan Abd Elmajid');
    expect(nameFromFile('my  adhan .m4a')).toBe('my adhan');
  });

  it('keeps the file name when there is nothing else left', () => {
    expect(nameFromFile('.mp3')).toBe('.mp3');
    expect(nameFromFile('adhan')).toBe('adhan');
  });
});
