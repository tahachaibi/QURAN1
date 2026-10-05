/**
 * Arabic for interface strings added by the screens fixes. Same rules as base.ts.
 * Kept in its own file so fixes in different areas never edit the same file.
 */
import type { ArabicForms } from '../i18n';

export const SCREENS: Record<string, string | ArabicForms> = {
  // Hadith tab. The adhkar card no longer claims every du'a comes from the
  // two Sahihs: most cite only islambook.com, as the adhkar screen says.
  "each with its source": "مع بيان مصدر كلّ ذكر",
  // A search shows a fair share of each collection, and says when it was cut.
  "Showing the first {n} matches. Add a word to narrow it.": {
    one: "تُعرض أول نتيجة. أضف كلمة لتضييق البحث.",
    two: "تُعرض أول نتيجتين. أضف كلمة لتضييق البحث.",
    few: "تُعرض أول {n} نتائج. أضف كلمة لتضييق البحث.",
    many: "تُعرض أول {n} نتيجةً. أضف كلمة لتضييق البحث.",
    other: "تُعرض أول {n} نتيجة. أضف كلمة لتضييق البحث.",
  },

  // Adhkar: a finished tally stays finished; a long press starts it over.
  "Tap to count; long-press to start over": "اضغط للعدّ، واضغط مطوّلًا لتبدأ العدّ من جديد",
};
