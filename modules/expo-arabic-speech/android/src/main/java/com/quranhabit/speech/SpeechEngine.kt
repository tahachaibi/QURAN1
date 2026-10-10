package com.quranhabit.speech

/**
 * What the module needs from a recognizer: Android's own (RecitationRecognizer)
 * or the built-in Quran model (QuranModelRecognizer, compiled only into the
 * test APK; see build.gradle). Both emit the same events, so nothing above the
 * module can tell which one is listening except by the strategy they report.
 */
interface SpeechEngine {
  fun start(options: RecitationRecognizer.Options)
  fun stop()
  fun cancel()
  fun destroy()
  val isActive: Boolean
}
