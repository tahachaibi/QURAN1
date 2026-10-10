/**
 * Arabic for interface strings added by the recognition fixes. Same rules as base.ts.
 * Kept in its own file so fixes in different areas never edit the same file.
 */
import type { ArabicForms } from '../i18n';

export const RECOGNITION: Record<string, string | ArabicForms> = {
  // the built-in Quran model (test APK)
  'Built-in Quran model (test)': 'نموذج القرآن المدمج (تجريبي)',
  'Built-in Quran model': 'نموذج القرآن المدمج',
  'Recognizes your recitation on the phone with a model trained on the Quran, instead of Android’s recognizer. Takes effect the next time you tap the microphone.':
    'يتعرّف على تلاوتك داخل الهاتف بنموذج مدرَّب على القرآن بدل محرّك أندرويد. يسري عند الضغط على الميكروفون في المرة القادمة.',
  // the underline's lead
  'Underline ahead of the recognizer': 'تقدّم الخط قبل تأكيد التعرّف',
  'The recognizer confirms each word a moment after you say it. This moves the underline on with your voice, at your own pace, and the recognizer then confirms it.':
    'يؤكّد محرّك التعرّف كل كلمة بعد نطقك بها بلحظة. هذا الخيار يُقدّم الخط مع صوتك وبحسب سرعتك، ثم يؤكّده المحرّك.',
  // the offline pack, downloaded by the app itself
  'The Arabic offline pack is installed.': 'ثُبّتت حزمة العربية للعمل دون اتصال.',
  'The Arabic offline pack could not be downloaded. Try again from Settings.':
    'تعذّر تنزيل حزمة العربية للعمل دون اتصال. حاول مجددًا من الإعدادات.',
  // src/recognition/errorText.ts
  'The recognition service stopped responding. Tap the microphone to try again.':
    'توقفت خدمة التعرّف عن الاستجابة. اضغط الميكروفون لتعيد المحاولة.',
  'No speech recognition service is installed on this phone. Install or enable the Google app, then try again.':
    'لا توجد على هذا الهاتف خدمة للتعرّف على الكلام. ثبّت تطبيق Google أو فعّله، ثم أعد المحاولة.',
  'The speech recognizer could not be started. Check that the microphone permission is granted.':
    'تعذّر تشغيل أداة التعرّف على الكلام. تأكّد من منح إذن الميكروفون.',
  'The speech recognizer could not start listening. Tap the microphone to try again.':
    'تعذّر على أداة التعرّف بدء الاستماع. اضغط الميكروفون لتعيد المحاولة.',
  'The speech recognition service keeps failing to start. Close other apps using voice input, or check that Google speech services are installed and enabled, then tap the microphone again.':
    'تتعثّر خدمة التعرّف على الكلام كلما بدأت. أغلق التطبيقات الأخرى التي تستعمل الإدخال الصوتي، أو تأكّد من تثبيت خدمات Google للكلام وتفعيلها، ثم اضغط الميكروفون من جديد.',
  'Speech recognition error ({name}).': 'خطأ في التعرّف على الكلام ({name}).',

  // src/recognition/useRecitationRecognizer.ts
  'The Arabic offline pack could not be requested. Try again from Settings.':
    'تعذّر طلب حزمة العربية دون اتصال. أعد المحاولة من الإعدادات.',
  'Offline Arabic is not available on this phone.': 'العربية دون اتصال غير متاحة على هذا الهاتف.',
};
