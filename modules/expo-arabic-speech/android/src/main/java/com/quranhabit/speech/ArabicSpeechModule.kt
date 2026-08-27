package com.quranhabit.speech

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
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
  @Field var possiblyCompleteSilenceMs: Int = 1_800,
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

    /**
     * Where audio would actually come out, and how loud.
     *
     * Added because the adhan reported "playing 3:59" and made no sound, and from
     * inside a media player those two states are indistinguishable. Everything
     * here is read-only and comes from AudioManager: the music-stream volume (the
     * adhan plays on that stream, not the ringer), the audio mode (a phone left
     * in communication mode routes media to the earpiece, which sounds exactly
     * like silence held to a table), and whether anything is playing at all.
     */
    AsyncFunction("audioState") {
      val am = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        ?: return@AsyncFunction mapOf("available" to false)
      val volume = am.getStreamVolume(AudioManager.STREAM_MUSIC)
      val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      mapOf(
        "available" to true,
        "musicVolume" to volume,
        "musicVolumeMax" to max,
        "musicMuted" to (volume == 0),
        "mode" to when (am.mode) {
          AudioManager.MODE_NORMAL -> "normal"
          AudioManager.MODE_IN_CALL -> "in-call"
          AudioManager.MODE_IN_COMMUNICATION -> "in-communication"
          AudioManager.MODE_RINGTONE -> "ringtone"
          else -> "mode-${am.mode}"
        },
        "musicActive" to am.isMusicActive,
        "ringerMode" to when (am.ringerMode) {
          AudioManager.RINGER_MODE_SILENT -> "silent"
          AudioManager.RINGER_MODE_VIBRATE -> "vibrate"
          else -> "normal"
        },
        "route" to buildList {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            for (device in am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
              add(
                when (device.type) {
                  AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
                  AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
                  AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired"
                  AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "bluetooth-a2dp"
                  AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth-sco"
                  else -> "type-${device.type}"
                },
              )
            }
          }
        }.distinct().joinToString(","),
      )
    }

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
