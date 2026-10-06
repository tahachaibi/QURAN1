package com.quranhabit.speech

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.ParcelFileDescriptor
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import java.util.ArrayDeque
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * The microphone, owned by the app instead of by the recognizer (the STREAM
 * strategy, Android 13+).
 *
 * WHY: when the recognizer owns the microphone, every new recognition session
 * has to open it again. On real devices that handover is where recitation was
 * lost: a session that never got the microphone back sat deaf until Android's
 * own silence limit ended it, 8 to 12 seconds later, and every word said in
 * that time was gone. Here one AudioRecord runs for the whole recitation and
 * its audio is written into a pipe that the recognizer reads
 * (RecognizerIntent.EXTRA_AUDIO_SOURCE). A recognizer session can end and a new
 * one start without the microphone ever closing, and the audio captured while
 * there was no session to read it is queued and handed to the next one, so
 * nothing said during a restart is lost.
 *
 * The writer never blocks: the pipe is non-blocking, and a session that stops
 * reading only grows the queue, which is bounded. A queue that keeps growing
 * while a session is attached is the signal that the recognizer is not reading
 * the pipe at all, which is how a device that ignores EXTRA_AUDIO_SOURCE is
 * detected (see RecitationRecognizer's stream check).
 */
class MicPump(
  /** voice level on the same rough scale as onRmsChanged; called on the capture thread */
  private val onLevel: (Double) -> Unit,
  /** the microphone stopped delivering audio altogether; called on the capture thread */
  private val onLost: () -> Unit,
) {
  @Volatile private var running = false
  private var record: AudioRecord? = null
  private var capture: Thread? = null
  private var writer: Thread? = null

  /** Frames waiting for a session to read them. Guarded by `lock`. */
  private val queue = ArrayDeque<ByteArray>()
  /** The write end of the current session's pipe, or null between sessions. Guarded by `lock`. */
  private var sink: ParcelFileDescriptor? = null
  private val lock = ReentrantLock()
  private val hasWork = lock.newCondition()

  /** set when a session is attached but has left more than MAX_BACKLOG_FRAMES unread */
  @Volatile var backlogged = false
    private set

  /** frames at speech level since the current session was attached */
  @Volatile var speechFramesSinceAttach = 0
    private set

  val isRunning: Boolean get() = running

  /** Open the microphone. False if it could not be opened; nothing is left running then. */
  @SuppressLint("MissingPermission") // RECORD_AUDIO is checked before any session starts
  fun start(): Boolean {
    if (running) return true
    val min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (min <= 0) return false
    val rec = try {
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(min, FRAME_BYTES * 25),
      )
    } catch (e: Exception) {
      return false
    }
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      return false
    }
    try {
      rec.startRecording()
    } catch (e: Exception) {
      rec.release()
      return false
    }
    if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      rec.release()
      return false
    }
    lock.withLock {
      queue.clear()
      backlogged = false
    }
    record = rec
    running = true
    capture = Thread({ captureLoop(rec) }, "tasmee-mic").apply {
      priority = Thread.MAX_PRIORITY
      start()
    }
    writer = Thread({ writeLoop() }, "tasmee-mic-writer").apply { start() }
    return true
  }

  /**
   * Hand the audio to a new session. `writeEnd` is the write side of the pipe
   * whose read side went to the recognizer. Whatever was queued while there was
   * no session is delivered first.
   */
  fun attach(writeEnd: ParcelFileDescriptor) {
    try {
      val fd = writeEnd.fileDescriptor
      val flags = Os.fcntlInt(fd, OsConstants.F_GETFL, 0)
      Os.fcntlInt(fd, OsConstants.F_SETFL, flags or OsConstants.O_NONBLOCK)
    } catch (e: ErrnoException) {
      // A blocking pipe still works; the writer just cannot detect a stall as early.
    }
    val old: ParcelFileDescriptor?
    lock.withLock {
      old = sink
      sink = writeEnd
      // Hand over at most half the backlog limit, so a new session starts with
      // room to catch up rather than already counted as not reading.
      while (queue.size > MAX_BACKLOG_FRAMES / 2) queue.removeFirst()
      backlogged = false
      speechFramesSinceAttach = 0
    }
    closeQuietly(old)
  }

  /** The session is gone; keep queueing for the next one. */
  fun detach() {
    val old: ParcelFileDescriptor?
    lock.withLock {
      old = sink
      sink = null
      backlogged = false
    }
    closeQuietly(old)
  }

  fun stop() {
    if (!running && record == null) return
    running = false
    runCatching { record?.stop() }
    runCatching { capture?.join(500) }
    runCatching { writer?.join(500) }
    runCatching { record?.release() }
    record = null
    capture = null
    writer = null
    detach()
    lock.withLock { queue.clear() }
  }

  private fun captureLoop(rec: AudioRecord) {
    var frames = 0
    while (running) {
      val frame = ByteArray(FRAME_BYTES)
      var read = 0
      while (read < FRAME_BYTES && running) {
        val n = rec.read(frame, read, FRAME_BYTES - read)
        if (n < 0) {
          // ERROR_DEAD_OBJECT / ERROR_INVALID_OPERATION: the microphone is gone
          if (running) {
            running = false
            onLost()
          }
          return
        }
        if (n == 0) Thread.sleep(5) else read += n
      }
      if (read < FRAME_BYTES) return

      val level = levelOf(frame)
      if (level >= SPEECH_LEVEL) speechFramesSinceAttach++
      if (++frames % LEVEL_EVERY_FRAMES == 0) onLevel(level)

      lock.withLock {
        queue.addLast(frame)
        if (queue.size > MAX_BACKLOG_FRAMES) {
          // Bounded: keep the most recent audio, which is what the next session
          // needs, and record that an attached session is not keeping up.
          while (queue.size > MAX_BACKLOG_FRAMES) queue.removeFirst()
          if (sink != null) backlogged = true
        }
        hasWork.signalAll()
      }
    }
  }

  private fun writeLoop() {
    while (running) {
      var frame: ByteArray? = null
      var out: ParcelFileDescriptor? = null
      lock.withLock {
        while (running && (queue.isEmpty() || sink == null)) hasWork.await(100, TimeUnit.MILLISECONDS)
        if (running) {
          frame = queue.peekFirst()
          out = sink
        }
      }
      if (!running) return
      val bytes = frame ?: continue
      val fd = out ?: continue
      val written = try {
        Os.write(fd.fileDescriptor, bytes, 0, bytes.size)
      } catch (e: ErrnoException) {
        if (e.errno == OsConstants.EAGAIN) {
          // The session has not caught up; the frame stays queued.
          Thread.sleep(10)
          continue
        }
        // EPIPE or EBADF: this session is gone. Drop the sink and keep the
        // frame for the next one.
        lock.withLock { if (sink === fd) sink = null }
        continue
      } catch (e: Exception) {
        lock.withLock { if (sink === fd) sink = null }
        continue
      }
      // A 640-byte write to a pipe is atomic (under PIPE_BUF): all or EAGAIN.
      if (written == bytes.size) {
        lock.withLock { if (queue.peekFirst() === bytes) queue.removeFirst() }
      }
    }
  }

  private fun closeQuietly(fd: ParcelFileDescriptor?) {
    runCatching { fd?.close() }
  }

  companion object {
    const val SAMPLE_RATE = 16_000
    private const val FRAME_MS = 20
    /** 20 ms of 16 kHz mono PCM16 */
    const val FRAME_BYTES = SAMPLE_RATE / 1000 * FRAME_MS * 2
    /** three seconds of audio */
    private const val MAX_BACKLOG_FRAMES = 150
    /** a level every 60 ms, about the rate onRmsChanged arrives at */
    private const val LEVEL_EVERY_FRAMES = 3
    /** the level the JS side treats as a voice (SPEECH_RMS_DB there) */
    const val SPEECH_LEVEL = 1.5

    /**
     * RMS of a frame, mapped onto onRmsChanged's rough range (about -2 to 10)
     * so the JS watchdog and the level meter read it the same way: -45 dBFS,
     * a quiet room, is 0, and -20 dBFS, a voice at arm's length, is about 8.
     */
    fun levelOf(frame: ByteArray): Double {
      var sum = 0.0
      var i = 0
      while (i + 1 < frame.size) {
        val s = ((frame[i + 1].toInt() shl 8) or (frame[i].toInt() and 0xff)).toShort().toDouble()
        sum += s * s
        i += 2
      }
      val rms = sqrt(sum / (frame.size / 2)) / 32768.0
      val dbfs = if (rms <= 1e-9) -120.0 else 20.0 * log10(rms)
      return (dbfs + 45.0) / 3.0
    }
  }
}
