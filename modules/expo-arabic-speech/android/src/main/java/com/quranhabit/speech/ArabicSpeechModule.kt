package com.quranhabit.speech

import android.os.Bundle
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class MissingContextException :
  CodedException("No Android context is available. This module only works in a dev-client or release build, not in Expo Go.")

/**
 * Constructor-parameter `@Field var`, matching how the first-party modules
 * declare records: RecordTypeConverter builds the instance with a no-arg
 * construct() and then writes each field by reflection, so defaults have to live
 * where a no-arg construction can see them.
 */
class StartOptions(
  @Field var locale: String = "ar-SA",
  @Field var maxResults: Int = 5,
  @Field var preferOnDevice: Boolean = true,
  @Field var allowSegmented: Boolean = true,
  @Field var completeSilenceMs: Int = 6_000,
  @Field var possiblyCompleteSilenceMs: Int = 6_000,
  @Field var minimumLengthMs: Int = 30_000,
) : Record {
  fun toOptions() = RecitationRecognizer.Options(
    locale = locale,
    maxResults = maxResults,
    preferOnDevice = preferOnDevice,
    allowSegmented = allowSegmented,
    completeSilenceMs = completeSilenceMs,
    possiblyCompleteSilenceMs = possiblyCompleteSilenceMs,
    minimumLengthMs = minimumLengthMs,
  )
}

class ArabicSpeechModule : Module() {
  private var recognizer: RecitationRecognizer? = null

  private fun engine(): RecitationRecognizer {
    recognizer?.let { return it }
    val context = appContext.reactContext ?: throw MissingContextException()
    val created = RecitationRecognizer(context) { event, payload -> safeSend(event, payload) }
    recognizer = created
    return created
  }

  private fun safeSend(event: String, payload: Bundle) {
    // The RN event emitter may be gone during teardown; a dropped RMS frame is
    // not worth crashing a recitation session over.
    runCatching { sendEvent(event, payload) }
  }

  override fun definition() = ModuleDefinition {
    Name("ArabicSpeech")

    Events("partial", "final", "rms", "error", "endOfSegment", "state")

    AsyncFunction("isAvailable") { engine().isAvailable() }

    AsyncFunction("supportsOnDevice") { engine().supportsOnDevice() }

    AsyncFunction("capabilities") { engine().capabilities() }

    AsyncFunction("languageStatus") { locale: String, promise: Promise ->
      engine().languageStatus(locale) { promise.resolve(it) }
    }

    AsyncFunction("requestLanguageDownload") { locale: String ->
      engine().requestLanguageDownload(locale)
    }

    AsyncFunction("start") { options: StartOptions ->
      engine().start(options.toOptions())
    }

    AsyncFunction("stop") { engine().stop() }

    AsyncFunction("cancel") { engine().cancel() }

    AsyncFunction("isActive") { recognizer?.isActive ?: false }

    OnDestroy {
      recognizer?.destroy()
      recognizer = null
    }

    OnActivityDestroys {
      recognizer?.destroy()
      recognizer = null
    }
  }
}
