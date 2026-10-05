/**
 * Arabic for interface strings added by the reading fixes. Same rules as base.ts.
 * Kept in its own file so fixes in different areas never edit the same file.
 */
import type { ArabicForms } from '../i18n';

export const READING: Record<string, string | ArabicForms> = {
  // the mushaf page, read aloud by TalkBack in Hidden mode
  "Hidden word": "كلمة مخفية",

  // the mic button on a paused session
  "Resume reciting": "تابع التلاوة",
  "Carries on the paused session from where you stopped": "يُكمل الجلسة المتوقفة من حيث توقفت",

  // resetting the session clock and figures
  "Reset session stats?": "أتصفّر إحصاءات الجلسة؟",
  "This clears the time and mistakes for this session.": "سيُمحى الوقت والأخطاء المسجّلة في هذه الجلسة.",
  "Reset": "صفّر",

  // the range button: one tap there, one tap on the page
  "Starts at your current word; then tap the last word of the range": "يبدأ من كلمتك الحالية، ثم اضغط على آخر كلمة في المقطع",

  // the summary card, when the weakest ayah passed
  "weakest {ref}": "الأضعف {ref}",
};
