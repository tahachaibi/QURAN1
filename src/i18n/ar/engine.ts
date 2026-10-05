/**
 * Arabic for interface strings added by the engine fixes. Same rules as base.ts.
 * Kept in its own file so fixes in different areas never edit the same file.
 */
import type { ArabicForms } from '../i18n';

export const ENGINE: Record<string, string | ArabicForms> = {
  // the English singular; "{n} words" in base.ts carries every Arabic count
  "1 word": "كلمة واحدة",
  // the bar shown for a few seconds after "I said it right"
  "«{word}» will not be checked again.": "لن تُراجَع كلمة «{word}» بعد الآن.",
  "Undo": "تراجع",
  "Checks this word again and puts the mistake back": "تعيد مراجعة هذه الكلمة وتُرجع الخطأ إلى القائمة",
};
