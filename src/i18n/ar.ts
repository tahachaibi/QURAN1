/**
 * Arabic for every interface string, keyed by the English it replaces.
 *
 * The entries live in src/i18n/ar/: base.ts holds the original set, and each
 * area of the app adds its own strings in its own file, so two pieces of work
 * never edit the same file. A key defined twice takes the later file's value.
 */
import type { ArabicForms } from './i18n';
import { BASE } from './ar/base';
import { ENGINE } from './ar/engine';
import { RECOGNITION } from './ar/recognition';
import { READING } from './ar/reading';
import { PRAYER } from './ar/prayer';
import { HIFZ } from './ar/hifz';
import { SCREENS } from './ar/screens';
import { COPY } from './ar/copy';

export const AR: Record<string, string | ArabicForms> = { ...BASE, ...ENGINE, ...RECOGNITION, ...READING, ...PRAYER, ...HIFZ, ...SCREENS, ...COPY };
