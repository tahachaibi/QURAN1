/**
 * Arabic for interface strings added by the hifz fixes. Same rules as base.ts.
 * Kept in its own file so fixes in different areas never edit the same file.
 */
import type { ArabicForms } from '../i18n';

export const HIFZ: Record<string, string | ArabicForms> = {
  // settings: restoring a backup
  "That file is far too large to be a Tasmee Hifz backup.": "هذا الملف أكبر بكثير من أن يكون نسخة احتياطية من التطبيق.",
};
