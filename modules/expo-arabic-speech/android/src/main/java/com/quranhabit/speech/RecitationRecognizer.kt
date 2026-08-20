package com.quranhabit.speech

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.annotation.RequiresApi
import java.util.concurrent.Executor

/**
 * Continuous Arabic recognition for recitation follow-along.
 *
 * `@react-native-voice/voice` is a dead end for this app: a singleton with no
 * way to prefer on-device recognition, no continuous session, and a legacy
 * `com.android.support:appcompat-v7` dependency that breaks the Android build
 * with checkDebugDuplicateClasses. Owning the lifecycle here is the whole point
 * — every quality problem in the previous build was a lifecycle problem.
 *
 * Three strategies, tried in the priority order of spec §4, each verified at
 * runtime rather than assumed:
 *
 *  1. SEGMENTED  RecognizerIntent.EXTRA_SEGMENTED_SESSION (API 31+). One
 *     recognition session survives pauses and delivers repeated
 *     onSegmentResults() instead of ending the utterance, which removes the
 *     restart dead-time that dominated the old implementation's latency.
 *     Per AOSP, the extra's VALUE must be the key of another extra that defines
 *     the end-of-session condition, and that extra must also be set. We key it
 *     on the minimum-length extra with a long value, so a session runs for
 *     ~30 s of segments before we recycle it.
 *  2. ON_DEVICE  createOnDeviceSpeechRecognizer() (API 33+), else
 *     EXTRA_PREFER_OFFLINE. Lower latency, no network, recitation stays private.
 *  3. RELAY      two instances, the next started BEFORE the current is
 *     released, so there is always a live listener. The gap is measured and
 *     reported rather than papered over.
 *
 * Strategy is chosen by probing, and demoted on failure: if segmented mode is
 * silently ignored by the device (no segment results ever arrive) we fall back,
 * report it, and never try it again this session.
 */
class RecitationRecognizer(
  private val context: Context,
  private val emit: (event: String, payload: Bundle) -> Unit,
) {
  enum class Strategy { SEGMENTED, ON_DEVICE, RELAY }

  data class Options(
    val locale: String = "ar-SA",
    val maxResults: Int = 5,
    val preferOnDevice: Boolean = true,
    val allowSegmented: Boolean = true,
    /** complete / possibly-complete silence windows: a breath must not end it */
    val completeSilenceMs: Int = 6_000,
    val possiblyCompleteSilenceMs: Int = 6_000,
    /** minimum session length; doubles as the segmented-session end condition */
    val minimumLengthMs: Int = 30_000,
  )

  private val main = Handler(Looper.getMainLooper())
  private val executor = Executor { main.post(it) }
  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private var options = Options()
  private var strategy = Strategy.RELAY

  // Written from stop()/cancel() on the JS thread and read on the main thread
  // by the listener, so both have to be volatile.
  @Volatile private var active = false
  @Volatile private var generation = 0

  /** set once this device has proved it ignores EXTRA_SEGMENTED_SESSION */
  private var segmentedFailed = false

  /** the live recognizer, and the outgoing one during a relay handover */
  private var current: SpeechRecognizer? = null
  private var outgoing: SpeechRecognizer? = null

  /** set once a segment result actually arrives, proving segmented mode works */
  private var segmentedProven = false
  private var segmentedAttempts = 0

  private var focusRequest: AudioFocusRequest? = null
  private var relayStartedAt = 0L
  private var lastResultAt = 0L

  val isActive: Boolean get() = active
  val currentStrategy: String get() = strategy.name

  // -------------------------------------------------------------------------
  // capability probing
  // -------------------------------------------------------------------------

  fun isAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(context)

  fun supportsOnDevice(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

  fun supportsSegmented(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

  fun capabilities(): Bundle = Bundle().apply {
    putInt("sdkInt", Build.VERSION.SDK_INT)
    putBoolean("recognitionAvailable", isAvailable())
    putBoolean("onDeviceAvailable", supportsOnDevice())
    putBoolean("segmentedAvailable", supportsSegmented())
    putString("strategy", strategy.name)
    putBoolean("segmentedProven", segmentedProven)
  }

  /**
   * Ask the recognizer which Arabic locales are installed on-device, pending
   * download, or online-only (API 33+). The point is to DETECT a missing
   * offline language pack rather than fail silently at start().
   */
  fun languageStatus(locale: String, onResult: (Bundle) -> Unit) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || !supportsOnDevice()) {
      onResult(
        Bundle().apply {
          putBoolean("supported", false)
          putString(
            "detail",
            "On-device recognition needs Android 13 or newer; this device reports API ${Build.VERSION.SDK_INT}.",
          )
        },
      )
      return
    }
    languageStatusTiramisu(locale, onResult)
  }

  /**
   * Kept in its own @RequiresApi method so no API-33 type is ever resolved on an
   * older device: the anonymous RecognitionSupportCallback below references
   * RecognitionSupport in its signature, and a version check inside a shared
   * method would not stop the verifier from touching it.
   */
  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun languageStatusTiramisu(locale: String, onResult: (Bundle) -> Unit) {
    val probe = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
    var settled = false
    val finish = { bundle: Bundle ->
      if (!settled) {
        settled = true
        probe.destroy()
        onResult(bundle)
      }
    }
    probe.checkRecognitionSupport(
      buildIntent(locale, segmented = false),
      executor,
      object : RecognitionSupportCallback {
        override fun onSupportResult(support: RecognitionSupport) {
          finish(
            Bundle().apply {
              putBoolean("supported", true)
              putStringArray("installed", support.installedOnDeviceLanguages.toTypedArray())
              putStringArray("pending", support.pendingOnDeviceLanguages.toTypedArray())
              putStringArray("supportedOnDevice", support.supportedOnDeviceLanguages.toTypedArray())
              putStringArray("online", support.onlineLanguages.toTypedArray())
              putBoolean(
                "localeInstalled",
                support.installedOnDeviceLanguages.any { it.startsWith(languageOf(locale)) },
              )
            },
          )
        }

        override fun onError(error: Int) {
          finish(
            Bundle().apply {
              putBoolean("supported", false)
              putString("detail", "checkRecognitionSupport failed: ${errorName(error)}")
            },
          )
        }
      },
    )
    // don't hang the JS promise if the service never answers
    main.postDelayed(
      {
        finish(
          Bundle().apply {
            putBoolean("supported", false)
            putString("detail", "checkRecognitionSupport timed out after 4s")
          },
        )
      },
      LANGUAGE_PROBE_TIMEOUT_MS,
    )
  }

  /** Ask the system to download the offline pack for `locale` (API 33+). */
  fun requestLanguageDownload(locale: String): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || !supportsOnDevice()) {
      return "unsupported"
    }
    triggerDownloadTiramisu(locale)
    return "requested"
  }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun triggerDownloadTiramisu(locale: String) {
    val downloader = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
    downloader.triggerModelDownload(buildIntent(locale, segmented = false))
    main.postDelayed({ downloader.destroy() }, DOWNLOADER_LIFETIME_MS)
  }

  // -------------------------------------------------------------------------
  // session lifecycle
  // -------------------------------------------------------------------------

  fun start(options: Options) {
    this.options = options
    if (!isAvailable()) {
      emitError(
        "unavailable",
        "No speech recognition service is installed. On a Google-services device, install or enable the Google app; " +
          "on an AOSP build install a RecognitionService provider.",
      )
      return
    }
    active = true
    segmentedAttempts = 0
    requestAudioFocus()
    strategy = chooseStrategy()
    emitState("starting")
    launch(fresh = true)
  }

  private fun chooseStrategy(): Strategy = when {
    options.allowSegmented && supportsSegmented() && !segmentedFailed -> Strategy.SEGMENTED
    options.preferOnDevice && supportsOnDevice() -> Strategy.ON_DEVICE
    else -> Strategy.RELAY
  }

  fun stop() {
    active = false
    generation++
    main.post {
      current?.let { runCatching { it.stopListening() } }
      releaseAll()
      abandonAudioFocus()
      emitState("stopped")
    }
  }

  fun cancel() {
    active = false
    generation++
    main.post {
      current?.let { runCatching { it.cancel() } }
      releaseAll()
      abandonAudioFocus()
      emitState("cancelled")
    }
  }

  fun destroy() {
    cancel()
  }

  private fun releaseAll() {
    runCatching { current?.destroy() }
    runCatching { outgoing?.destroy() }
    current = null
    outgoing = null
  }

  /**
   * Start a recognizer. In RELAY mode the new instance is created and started
   * BEFORE the old one is destroyed, so there is never a moment without a live
   * listener; the measured handover gap is reported so the UI can mask it
   * honestly rather than pretend nothing was lost.
   */
  private fun launch(fresh: Boolean) {
    if (!active) return
    main.post {
      if (!active) return@post
      val myGeneration = ++generation
      val previous = current
      val recognizer = createRecognizer()
      if (recognizer == null) {
        emitError("create-failed", "Could not create a SpeechRecognizer. Is RECORD_AUDIO granted?")
        return@post
      }
      recognizer.setRecognitionListener(Listener(myGeneration))
      current = recognizer

      val gap = if (relayStartedAt == 0L) 0L else System.currentTimeMillis() - relayStartedAt
      relayStartedAt = System.currentTimeMillis()

      runCatching {
        recognizer.startListening(buildIntent(options.locale, segmented = strategy == Strategy.SEGMENTED))
      }.onFailure {
        emitError("start-failed", "startListening threw: ${it.message}")
        return@post
      }

      // now it is safe to let the previous instance go
      if (previous != null) {
        outgoing = previous
        main.postDelayed({
          runCatching { previous.cancel() }
          runCatching { previous.destroy() }
          if (outgoing === previous) outgoing = null
        }, RELAY_OVERLAP_MS)
      }

      emitState(if (fresh) "listening" else "restarted", gap)
    }
  }

  private fun createRecognizer(): SpeechRecognizer? = runCatching {
    if (strategy == Strategy.ON_DEVICE && supportsOnDevice()) {
      createOnDeviceTiramisu()
    } else {
      SpeechRecognizer.createSpeechRecognizer(context)
    }
  }.getOrNull()

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun createOnDeviceTiramisu(): SpeechRecognizer =
    SpeechRecognizer.createOnDeviceSpeechRecognizer(context)

  private fun buildIntent(locale: String, segmented: Boolean): Intent =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, locale)
      putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, true)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)

      // Five alternatives on partials AND finals. For Quranic Arabic the
      // correct reading is frequently NOT the top hypothesis (spec §4).
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, options.maxResults)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)

      // Stretched silence windows: a breath must never end the session.
      putExtra(
        RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS,
        options.completeSilenceMs,
      )
      putExtra(
        RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,
        options.possiblyCompleteSilenceMs,
      )
      putExtra(
        RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS,
        options.minimumLengthMs,
      )

      if (options.preferOnDevice) {
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      }

      if (segmented && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        // Per AOSP: the value is the KEY of the extra that ends the session,
        // and that extra must be set in the same intent (it is, above).
        putExtra(
          RecognizerIntent.EXTRA_SEGMENTED_SESSION,
          RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS,
        )
        segmentedAttempts++
      }
    }

  // -------------------------------------------------------------------------
  // audio focus
  // -------------------------------------------------------------------------

  /**
   * Request audio focus so other apps stop playing sound into the microphone.
   *
   * Losing that focus is reported but NEVER treated as losing the microphone.
   * Audio focus governs PLAYBACK, not capture, and the two are routinely
   * confused. Pausing recitation on focus loss made the app take the microphone
   * from itself: the system recognition service requests focus for its own
   * session the moment it starts listening, which revokes ours, so every session
   * paused immediately with "another app took the microphone" while no other app
   * was involved. A notification chime would have done the same.
   *
   * Real microphone loss arrives as ERROR_AUDIO from the recognizer, which is
   * handled in the listener below as a recoverable interruption.
   */
  private fun requestAudioFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
        .setAudioAttributes(attributes)
        .setOnAudioFocusChangeListener { change ->
          when (change) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK,
            -> emitState("audio-focus-lost")
            AudioManager.AUDIOFOCUS_GAIN -> emitState("audio-focus-regained")
            else -> Unit
          }
        }
        .build()
      focusRequest = request
      audioManager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
    }
  }

  private fun abandonAudioFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
      focusRequest = null
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(null)
    }
  }

  // -------------------------------------------------------------------------
  // listener
  // -------------------------------------------------------------------------

  private inner class Listener(private val myGeneration: Int) : RecognitionListener {
    private val stale: Boolean get() = myGeneration != generation

    override fun onReadyForSpeech(params: Bundle?) {
      if (stale) return
      emitState("ready")
    }

    override fun onBeginningOfSpeech() {
      if (stale) return
      emitState("speech-start")
    }

    override fun onRmsChanged(rmsdB: Float) {
      if (stale) return
      // The JS liveness watchdog is driven by REAL audio, not guesses: it needs
      // to know whether the silence is the recognizer dying or the reciter
      // pausing (spec §4).
      emit("rms", Bundle().apply { putDouble("level", rmsdB.toDouble()) })
    }

    override fun onBufferReceived(buffer: ByteArray?) = Unit

    override fun onEndOfSpeech() {
      if (stale) return
      emitState("speech-end")
    }

    override fun onError(error: Int) {
      if (stale) return
      val transient = error in TRANSIENT_ERRORS
      emit(
        "error",
        Bundle().apply {
          putInt("code", error)
          putString("name", errorName(error))
          putBoolean("transient", transient)
          putString("message", errorAdvice(error))
        },
      )
      if (!active) return
      if (transient) {
        // restart silently; the session is not over because the recognizer
        // heard nothing for a moment
        main.postDelayed({ if (active) launch(fresh = false) }, RESTART_DELAY_MS)
        return
      }
      if (error == SpeechRecognizer.ERROR_AUDIO) {
        // The ONLY signal that actually means the microphone is gone. Recoverable
        // by tapping resume once whatever holds it lets go, so it is an
        // interruption rather than a failed session.
        active = false
        abandonAudioFocus()
        emitState("mic-unavailable")
        return
      }
      active = false
      abandonAudioFocus()
      emitState("failed")
    }

    override fun onResults(results: Bundle?) {
      if (stale) return
      lastResultAt = System.currentTimeMillis()
      emitTranscript("final", results)
      // A non-segmented session is finished after its results. Relay onwards.
      if (active && strategy != Strategy.SEGMENTED) {
        launch(fresh = false)
      }
    }

    override fun onPartialResults(partialResults: Bundle?) {
      if (stale) return
      lastResultAt = System.currentTimeMillis()
      emitTranscript("partial", partialResults)
    }

    override fun onSegmentResults(segmentResults: Bundle) {
      if (stale) return
      // Arriving here proves the device honours segmented mode.
      segmentedProven = true
      lastResultAt = System.currentTimeMillis()
      emitTranscript("final", segmentResults)
    }

    override fun onEndOfSegmentedSession() {
      if (stale) return
      emit("endOfSegment", Bundle())
      if (!segmentedProven && segmentedAttempts >= SEGMENTED_PROBES) {
        // The device accepted the extra but never delivered a segment: demote.
        segmentedFailed = true
        strategy = if (options.preferOnDevice && supportsOnDevice()) Strategy.ON_DEVICE else Strategy.RELAY
        emitState("segmented-unsupported")
      }
      if (active) launch(fresh = false)
    }

    override fun onEvent(eventType: Int, params: Bundle?) = Unit
  }

  private fun emitTranscript(event: String, bundle: Bundle?) {
    if (bundle == null) return
    val alternatives = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
    if (alternatives.isNullOrEmpty()) return
    val confidences = bundle.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
    emit(
      event,
      Bundle().apply {
        putStringArray("alternatives", alternatives.toTypedArray())
        if (confidences != null) putDoubleArray("confidences", DoubleArray(confidences.size) { confidences[it].toDouble() })
        putLong("emittedAt", System.currentTimeMillis())
        putString("strategy", strategy.name)
      },
    )
  }

  private fun emitState(state: String, gapMs: Long = 0L) {
    emit(
      "state",
      Bundle().apply {
        putString("state", state)
        putString("strategy", strategy.name)
        putLong("relayGapMs", gapMs)
        putBoolean("segmentedProven", segmentedProven)
      },
    )
  }

  private fun emitError(code: String, message: String) {
    emit(
      "error",
      Bundle().apply {
        putInt("code", -1)
        putString("name", code)
        putBoolean("transient", false)
        putString("message", message)
      },
    )
  }

  companion object {
    /** How long the outgoing recognizer is kept alive during a relay handover. */
    private const val RELAY_OVERLAP_MS = 120L
    /** Delay before restarting after a transient error. Keep well under 150ms. */
    private const val RESTART_DELAY_MS = 60L
    /** Segmented sessions to try before deciding the device ignores the extra. */
    private const val SEGMENTED_PROBES = 2
    /** Give up on checkRecognitionSupport rather than hang the JS promise. */
    private const val LANGUAGE_PROBE_TIMEOUT_MS = 4_000L
    /** How long the throwaway download-trigger recognizer is kept alive. */
    private const val DOWNLOADER_LIFETIME_MS = 1_000L

    /**
     * Codes that mean "nothing was heard just now", not "the session is over".
     * Values verified against AOSP SpeechRecognizer: 5 CLIENT, 6 SPEECH_TIMEOUT,
     * 7 NO_MATCH, 8 RECOGNIZER_BUSY, 11 SERVER_DISCONNECTED.
     */
    private val TRANSIENT_ERRORS = setOf(
      SpeechRecognizer.ERROR_CLIENT,
      SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
      SpeechRecognizer.ERROR_NO_MATCH,
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
      SpeechRecognizer.ERROR_SERVER_DISCONNECTED,
    )

    fun errorName(code: Int): String = when (code) {
      SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "NETWORK_TIMEOUT"
      SpeechRecognizer.ERROR_NETWORK -> "NETWORK"
      SpeechRecognizer.ERROR_AUDIO -> "AUDIO"
      SpeechRecognizer.ERROR_SERVER -> "SERVER"
      SpeechRecognizer.ERROR_CLIENT -> "CLIENT"
      SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "SPEECH_TIMEOUT"
      SpeechRecognizer.ERROR_NO_MATCH -> "NO_MATCH"
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "RECOGNIZER_BUSY"
      SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "INSUFFICIENT_PERMISSIONS"
      SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "TOO_MANY_REQUESTS"
      SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "SERVER_DISCONNECTED"
      SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "LANGUAGE_NOT_SUPPORTED"
      SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "LANGUAGE_UNAVAILABLE"
      SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT -> "CANNOT_CHECK_SUPPORT"
      else -> "UNKNOWN_$code"
    }

    /** Error messages must name the actual fix (spec §11). */
    fun errorAdvice(code: Int): String = when (code) {
      SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
        "Microphone permission was denied. Grant it in Settings > Apps > Quran Habit > Permissions > Microphone."
      SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ->
        "This recognizer has no Arabic model. Try a different locale in Settings (ar-EG, ar-MA), or install Arabic under " +
          "Settings > System > Languages & input > Voice input > Google > Offline speech recognition."
      SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
        "The Arabic offline pack is not downloaded yet. Tap 'Install Arabic offline' on the recitation screen."
      SpeechRecognizer.ERROR_AUDIO ->
        "The microphone could not be read. Something else is holding it — end any call, voice recorder or " +
          "assistant, then tap resume."
      SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
        "The recognizer fell back to the network and could not reach it. Install the Arabic offline pack to work fully offline."
      SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_SERVER_DISCONNECTED ->
        "The recognition service dropped the session; restarting."
      SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
        "Nothing recognized in that window; restarting."
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY ->
        "The recognition service is busy; restarting."
      SpeechRecognizer.ERROR_CLIENT ->
        "The recognition service reported a client error; restarting."
      else -> "Recognition error ${errorName(code)}."
    }

    fun languageOf(locale: String): String = locale.substringBefore('-')
  }
}
