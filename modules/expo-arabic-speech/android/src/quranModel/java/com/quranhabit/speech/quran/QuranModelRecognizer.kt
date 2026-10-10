package com.quranhabit.speech.quran

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.quranhabit.speech.MicPump
import com.quranhabit.speech.RecitationRecognizer
import com.quranhabit.speech.SpeechEngine
import java.util.ArrayDeque
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Follow-along with the built-in Quran model instead of Android's recognizer
 * (test APK only; see build.gradle).
 *
 * The model reads a stretch of audio and writes what was said, so live
 * following is built from passes: the microphone audio is cut into
 * utterances at pauses, and while one is being recited it is transcribed
 * again and again as it grows, each pass starting as soon as the last one
 * ends. Every pass is sent as a "partial" with the whole utterance so far, and
 * the last one, after the pause, as a "final": exactly the shape of Android's
 * recognizer, so nothing above the module has to know which one is listening.
 *
 * Each pass is also reported as a state ("pass-<ms>ms-<s>s"), so a recitation
 * log shows how long passes take on the phone.
 */
class QuranModelRecognizer(
  private val context: Context,
  private val send: (event: String, payload: Bundle) -> Unit,
) : SpeechEngine {

  private val main = Handler(Looper.getMainLooper())

  /** every event leaves from the main thread, as Android's recognizer's do */
  private fun emit(event: String, payload: Bundle) {
    main.post { send(event, payload) }
  }

  private class Utterance {
    var samples = FloatArray(16_000 * 4)
    var size = 0
    var ended = false
    /** samples covered by the last pass */
    var passed = 0
    /** the last pass's tokens: the draft for the next */
    var draft = IntArray(0)
    /** the last pass's text, reused as the final when nothing was heard after it */
    var lastText: String? = null
    /** frames with a voice in them; a click or a breath has almost none */
    var voicedFrames = 0

    fun append(frame: FloatArray, n: Int) {
      if (size + n > samples.size) samples = samples.copyOf(maxOf(samples.size * 2, size + n))
      System.arraycopy(frame, 0, samples, size, n)
      size += n
    }
  }

  private val lock = ReentrantLock()
  private val changed = lock.newCondition()
  /** the utterance being recited, or null between them; guarded by lock */
  private var current: Utterance? = null
  /** utterances that ended and still owe their final pass; guarded by lock */
  private val ending = ArrayDeque<Utterance>()

  @Volatile private var active = false
  @Volatile private var generation = 0
  private var capture: Thread? = null
  private var worker: Thread? = null
  private var record: AudioRecord? = null

  override val isActive: Boolean get() = active

  override fun start(options: RecitationRecognizer.Options) {
    if (active) return
    // the last session's microphone thread lets go of the microphone first
    runCatching { capture?.join(500) }
    active = true
    val myGeneration = ++generation
    lock.withLock {
      current = null
      ending.clear()
    }
    emitState("starting")
    worker = Thread({ work(myGeneration) }, "tasmee-quran-asr").apply { start() }
  }

  override fun stop() = end("stopped")

  override fun cancel() = end("cancelled")

  override fun destroy() = end("cancelled")

  private fun end(state: String) {
    if (!active) return
    active = false
    generation++
    runCatching { record?.stop() }
    lock.withLock { changed.signalAll() }
    emitState(state)
  }

  // -------------------------------------------------------------------------
  // the recognizer thread: load, open the microphone, then passes
  // -------------------------------------------------------------------------

  private fun work(myGeneration: Int) {
    // The microphone first: loading the model takes about a second the first
    // time, and what the reciter says meanwhile is kept for the first pass.
    if (!openMicrophone(myGeneration)) return
    emitState("listening")
    emitState("ready")
    val asr = try {
      QuranAsr.load(context)
    } catch (e: Throwable) {
      fail("model-failed", "The built-in Quran model could not be loaded: ${e.message}")
      return
    }

    while (stillMine(myGeneration)) {
      val job: Pair<Utterance, Boolean>? = lock.withLock {
        val finishing = ending.peekFirst()
        val live = current
        when {
          finishing != null -> finishing to true
          live != null && live.voicedFrames >= MIN_VOICED_FRAMES && live.size - live.passed >= MIN_NEW_SAMPLES ->
            live to false
          else -> {
            changed.await(50, TimeUnit.MILLISECONDS)
            null
          }
        }
      }
      if (job == null) continue
      val (utterance, final) = job
      val (audio, length) = lock.withLock { utterance.samples.copyOf(utterance.size) to utterance.size }

      if (final) {
        val cached = utterance.lastText
        val noise = utterance.voicedFrames < MIN_VOICED_FRAMES
        if (noise || (cached != null && utterance.passed == length)) {
          // a click or a breath: nothing to say; or nothing heard since the last
          // pass: its text is the final
          lock.withLock { ending.pollFirst() }
          if (!noise && cached != null && stillMine(myGeneration)) emitTranscript("final", cached)
          continue
        }
      }

      val started = SystemClock.elapsedRealtime()
      val text = try {
        asr.encode(audio, length).use { states ->
          val tokens = asr.decode(states, utterance.draft)
          utterance.draft = tokens
          asr.text(tokens).also { utterance.lastText = it }
        }
      } catch (e: Throwable) {
        fail("model-failed", "The built-in Quran model failed: ${e.message}")
        return
      }
      val took = SystemClock.elapsedRealtime() - started
      lock.withLock {
        utterance.passed = length
        if (final) ending.pollFirst()
      }
      if (!stillMine(myGeneration)) return
      emitState("pass-${took}ms-${"%.1f".format(length / SAMPLE_RATE.toDouble())}s")
      emitTranscript(if (final) "final" else "partial", text)
    }
  }

  // -------------------------------------------------------------------------
  // the capture thread: frames, level, and where utterances begin and end
  // -------------------------------------------------------------------------

  @SuppressLint("MissingPermission") // checked by the app before any session starts
  private fun openMicrophone(myGeneration: Int): Boolean {
    val min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val rec = runCatching {
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(min, FRAME_SAMPLES * 2 * 25),
      )
    }.getOrNull()
    if (rec == null || rec.state != AudioRecord.STATE_INITIALIZED) {
      rec?.release()
      fail("create-failed", "The microphone could not be opened. Is RECORD_AUDIO granted?")
      return false
    }
    runCatching { rec.startRecording() }
    if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      rec.release()
      fail("create-failed", "The microphone could not be started.")
      return false
    }
    record = rec
    capture = Thread({ captureLoop(rec, myGeneration) }, "tasmee-quran-mic").apply {
      priority = Thread.MAX_PRIORITY
      start()
    }
    return true
  }

  private fun captureLoop(rec: AudioRecord, myGeneration: Int) {
    val pcm = ShortArray(FRAME_SAMPLES)
    val bytes = ByteArray(FRAME_SAMPLES * 2)
    val frame = FloatArray(FRAME_SAMPLES)
    // the last few frames before speech, so a word's first consonant is kept
    val preRoll = ArrayDeque<FloatArray>()
    var silentFrames = 0
    var frames = 0
    try {
      while (stillMine(myGeneration)) {
        var read = 0
        while (read < FRAME_SAMPLES && stillMine(myGeneration)) {
          val n = rec.read(pcm, read, FRAME_SAMPLES - read)
          if (n < 0) {
            if (stillMine(myGeneration)) {
              active = false
              emitState("mic-unavailable")
            }
            return
          }
          read += n
        }
        if (read < FRAME_SAMPLES) return
        for (i in 0 until FRAME_SAMPLES) {
          frame[i] = pcm[i] / 32768f
          bytes[2 * i] = (pcm[i].toInt() and 0xff).toByte()
          bytes[2 * i + 1] = (pcm[i].toInt() shr 8).toByte()
        }
        val level = MicPump.levelOf(bytes)
        if (++frames % LEVEL_EVERY_FRAMES == 0) emit("rms", Bundle().apply { putDouble("level", level) })
        val voiced = level >= MicPump.SPEECH_LEVEL

        lock.withLock {
          var live = current
          if (live == null) {
            preRoll.addLast(frame.copyOf())
            if (preRoll.size > PRE_ROLL_FRAMES) preRoll.removeFirst()
            if (voiced) {
              live = Utterance()
              for (f in preRoll) live.append(f, f.size)
              preRoll.clear()
              live.voicedFrames = 1
              current = live
              silentFrames = 0
              emitState("speech-start")
            }
          } else {
            live.append(frame, FRAME_SAMPLES)
            if (voiced) live.voicedFrames++
            silentFrames = if (voiced) 0 else silentFrames + 1
            val pause = silentFrames >= END_SILENCE_FRAMES
            val long = live.size >= MAX_UTTERANCE_SAMPLES
            if (pause || long) {
              live.ended = true
              ending.addLast(live)
              current = null
              emitState("speech-end")
            }
          }
          changed.signalAll()
        }
      }
    } finally {
      runCatching { rec.stop() }
      runCatching { rec.release() }
      if (record === rec) record = null
    }
  }

  // -------------------------------------------------------------------------

  private fun stillMine(myGeneration: Int): Boolean = active && generation == myGeneration

  private fun fail(code: String, message: String) {
    active = false
    emit(
      "error",
      Bundle().apply {
        putInt("code", -1)
        putString("name", code)
        putBoolean("transient", false)
        putString("message", message)
      },
    )
    emitState("failed")
  }

  private fun emitTranscript(event: String, text: String) {
    emit(
      event,
      Bundle().apply {
        putStringArray("alternatives", arrayOf(text))
        putLong("emittedAt", System.currentTimeMillis())
        putString("strategy", STRATEGY)
      },
    )
  }

  private fun emitState(state: String) {
    emit(
      "state",
      Bundle().apply {
        putString("state", state)
        putString("strategy", STRATEGY)
        putLong("relayGapMs", 0L)
        putBoolean("segmentedProven", false)
      },
    )
  }

  companion object {
    /** Whether this build carries the model files; called by name from ArabicSpeechModule. */
    @JvmStatic
    fun bundled(context: Context): Boolean = QuranAsr.bundled(context)

    const val STRATEGY = "QURAN_MODEL"
    private const val SAMPLE_RATE = 16_000
    /** 20 ms */
    private const val FRAME_SAMPLES = 320
    /** a level about every 60 ms, as Android's recognizer reports it */
    private const val LEVEL_EVERY_FRAMES = 3
    /** 300 ms kept from before the voice began */
    private const val PRE_ROLL_FRAMES = 15
    /** a pause of 700 ms ends an utterance */
    private const val END_SILENCE_FRAMES = 35
    /** and 25 s ends one regardless: the model reads at most 30 s */
    private const val MAX_UTTERANCE_SAMPLES = SAMPLE_RATE * 25
    /** a new pass once 300 ms more has been heard */
    private const val MIN_NEW_SAMPLES = SAMPLE_RATE * 3 / 10
    /** 200 ms of voice before anything is transcribed: less is a click or a breath */
    private const val MIN_VOICED_FRAMES = 10
  }
}
