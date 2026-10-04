/**
 * Arabic for interface strings added by the hifz fixes. Same rules as base.ts.
 * Kept in its own file so fixes in different areas never edit the same file.
 */
import type { ArabicForms } from '../i18n';

export const HIFZ: Record<string, string | ArabicForms> = {
  // settings: recognizer
  "Standard recognition": "التعرّف العادي",

  // settings: restoring a backup
  "That file is far too large to be a Tasmee Hifz backup.": "هذا الملف أكبر بكثير من أن يكون نسخة احتياطية من التطبيق.",
  "This backup holds nothing newer than what is already on this phone. Nothing was changed.": "لا تحوي هذه النسخة الاحتياطية شيئًا أحدث مما على هذا الهاتف. لم يتغيّر شيء.",
  "Backup made on {date}.": "أُنشئت هذه النسخة الاحتياطية في {date}.",
  "The oldest session will not be kept: the history is full.": "لن تُحفظ أقدم جلسة، فالسجل ممتلئ.",
  "The {n} oldest sessions will not be kept: the history is full.": {
    two: "لن تُحفظ أقدم جلستين، فالسجل ممتلئ.",
    few: "لن تُحفظ أقدم {n} جلسات، فالسجل ممتلئ.",
    many: "لن تُحفظ أقدم {n} جلسة، فالسجل ممتلئ.",
    other: "لن تُحفظ أقدم {n} جلسة، فالسجل ممتلئ.",
  },
  "The oldest mistake will not be kept: the history is full.": "لن يُحفظ أقدم خطأ، فالسجل ممتلئ.",
  "The {n} oldest mistakes will not be kept: the history is full.": {
    two: "لن يُحفظ أقدم خطأين، فالسجل ممتلئ.",
    few: "لن يُحفظ أقدم {n} أخطاء، فالسجل ممتلئ.",
    many: "لن يُحفظ أقدم {n} خطأً، فالسجل ممتلئ.",
    other: "لن يُحفظ أقدم {n} خطأ، فالسجل ممتلئ.",
  },
  "Part of this file could not be read, so not everything in it can be restored.": "تعذّرت قراءة جزء من هذا الملف، فلن يُسترجع كل ما فيه.",
  "Backup restored.": "استُرجعت النسخة الاحتياطية.",
  "Part of the backup could not be written. Restore it again to finish.": "تعذّرت كتابة جزء من النسخة الاحتياطية. أعد الاسترجاع لإكماله.",
  "Nothing could be restored. Nothing was changed.": "تعذّر استرجاع أي شيء. لم يتغيّر شيء.",
};
