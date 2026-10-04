/**
 * Every interface string has its Arabic, and every Arabic entry is used.
 *
 * Without this, a string added next month would quietly show in English to an
 * Arabic reader, and nobody would notice until a user did. The scan is
 * literal: it reads every t('…') call in the app's source. A string built at
 * runtime cannot be checked, so the convention is that t() only ever receives
 * a literal. The second test fails on any call that breaks it.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { AR } from '../src/i18n/ar';
import { interpolate, translate } from '../src/i18n/i18n';

const ROOT = join(__dirname, '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const files = [...sources(join(ROOT, 'app')), ...sources(join(ROOT, 'src'))].filter(
  (f) =>
    !f.endsWith(join('src', 'i18n', 'ar.ts')) &&
    !f.endsWith(join('src', 'i18n', 'i18n.ts')) &&
    !f.includes(join('src', 'i18n', 'ar') + '/'),
);

/** Matches t('…') and msg('…'), with any quote, where the argument is one plain literal. */
const LITERAL = /\b(?:t|msg)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]/g;
/** Any t( call at all, to catch the ones that are not a literal. */
const ANY_CALL = /\bt\(\s*([^\s)])/g;

const unescape = (s: string, quote: string): string =>
  s.replace(new RegExp(`\\\\${quote === '`' ? '`' : quote}`, 'g'), quote).replace(/\\n/g, '\n').replace(/\\\\/g, '\\');

const used = new Map<string, string>();
const nonLiteral: string[] = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(LITERAL)) used.set(unescape(m[2], m[1]), file);
  for (const m of src.matchAll(ANY_CALL)) {
    if (!`'"\``.includes(m[1])) nonLiteral.push(`${file.slice(ROOT.length + 1)}: t(${m[1]}…`);
  }
}

describe('the Arabic dictionary', () => {
  it('finds the strings it is checking', () => {
    expect(used.size).toBeGreaterThan(100);
  });

  it('only ever sees literal strings passed to t()', () => {
    expect(nonLiteral).toEqual([]);
  });

  it('has Arabic for every interface string', () => {
    const missing = [...used.keys()].filter((k) => !(k in AR));
    expect(missing).toEqual([]);
  });

  it('carries no entries nothing uses', () => {
    const unused = Object.keys(AR).filter((k) => !used.has(k));
    expect(unused).toEqual([]);
  });

  /** every Arabic string of an entry, plain or one per plural form */
  const forms = (ar: (typeof AR)[string]): string[] =>
    typeof ar === 'string' ? [ar] : Object.values(ar).filter((v): v is string => typeof v === 'string');

  it('keeps every {placeholder} in the Arabic too', () => {
    const names = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
    // A plural form may drop {n} ("آيتان" already says two); nothing else may go missing.
    const broken = Object.entries(AR).filter(([en, ar]) =>
      forms(ar).some((f) => {
        const want = names(en).filter((n) => typeof ar === 'string' || n !== 'n');
        return !want.every((n) => names(f).includes(n)) || !names(f).every((n) => names(en).includes(n));
      }),
    );
    expect(broken).toEqual([]);
  });

  it('gives plural forms only to strings that are counted by {n}', () => {
    const wrong = Object.entries(AR).filter(([en, ar]) => typeof ar !== 'string' && !en.includes('{n}'));
    expect(wrong).toEqual([]);
  });

  it('contains Arabic, not a pasted English copy', () => {
    const untranslated = Object.entries(AR).filter(([, ar]) => forms(ar).some((f) => !/[؀-ۿ]/.test(f)));
    expect(untranslated).toEqual([]);
  });
});

describe('translate', () => {
  it('picks the Arabic plural form by the count', () => {
    const say = (n: number) => translate('ar', '{n} verses', { n });
    expect([1, 2, 3, 10, 11, 99, 100, 103, 111].map(say)).toEqual([
      'آية واحدة',
      'آيتان',
      '3 آيات',
      '10 آيات',
      '11 آية',
      '99 آية',
      '100 آية',
      '103 آيات',
      '111 آية',
    ]);
  });

  it('is English unchanged in English, and fills placeholders', () => {
    expect(translate('en', '{n} to review', { n: 3 })).toBe('3 to review');
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  it('falls back to English for a string with no entry', () => {
    expect(translate('ar', 'a sentence nobody wrote')).toBe('a sentence nobody wrote');
  });
});
