/**
 * Arabic for interface strings added by the prayer fixes. Same rules as base.ts.
 * Kept in its own file so fixes in different areas never edit the same file.
 */
import type { ArabicForms } from '../i18n';

export const PRAYER: Record<string, string | ArabicForms> = {
  // prayer times: why there is no position, and what was shown instead
  'Location is unavailable right now — these are the times saved for {day}.':
    'الموقع غير متاح الآن، وهذه الأوقات المحفوظة ليوم {day}.',
  'Location is unavailable right now, so these times are for the place saved last time.':
    'الموقع غير متاح الآن، لذا هذه الأوقات لآخر مكان محفوظ.',
  'Could not find where this phone is right now. Check that Location is on, then tap Try again.':
    'تعذّر تحديد مكان الهاتف الآن. تأكّد من أن الموقع مفعّل، ثم اضغط «أعد المحاولة».',
  'Location is turned off on this phone. Turn it on, then tap Try again.':
    'الموقع مُطفأ في هذا الهاتف. شغّله ثم اضغط «أعد المحاولة».',

  // prayer tab
  'Loading prayer times': 'جارٍ تحميل مواقيت الصلاة',
  // "صلاة" first, so the feminine words after it agree: the names themselves
  // (الفجر، الظهر…) are masculine.
  '{prayer} at {time}': 'صلاة {prayer} الساعة {time}',
  '{prayer} at {time}, next': 'صلاة {prayer} الساعة {time}، وهي القادمة',
  '{prayer} at {time}, passed': 'صلاة {prayer} الساعة {time}، وقد مضى وقتها',
  'Refresh prayer times': 'حدّث مواقيت الصلاة',

  // adhan scheduling
  'The saved prayer times have run out, so no prayer notifications are scheduled. Connect to the internet and refresh them.':
    'نفدت مواقيت الصلاة المحفوظة، فلا توجد إشعارات صلاة مجدولة. اتصل بالإنترنت ثم حدّثها.',

  // adhan banner, when nothing is sounding
  Dismiss: 'إخفاء',

  // adhan library
  'Plays when Tasmee Hifz is open. With the app closed, the notification uses the built-in adhan.':
    'يُرفع هذا الأذان حين يكون التطبيق مفتوحًا. أما إذا كان مغلقًا، فيستعمل الإشعارُ الأذانَ المدمج في التطبيق.',
};
