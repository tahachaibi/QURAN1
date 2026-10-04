/**
 * Arabic for interface strings added by the reading fixes. Same rules as base.ts.
 * Kept in its own file so fixes in different areas never edit the same file.
 */
import type { ArabicForms } from '../i18n';

export const READING: Record<string, string | ArabicForms> = {
  // the mushaf page, read aloud by TalkBack in Hidden mode
  "Hidden word": "كلمة مخفية",
};
