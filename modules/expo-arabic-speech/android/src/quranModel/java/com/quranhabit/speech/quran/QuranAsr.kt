package com.quranhabit.speech.quran

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.LongBuffer

/**
 * Tarteel's Quran speech model (whisper-tiny-ar-quran), run on the phone.
 *
 * A line-for-line port of QuranAsr in scripts/quran-model/verify.py, which CI
 * runs on real recitations against the original model before any APK may
 * carry these files. Three graphs from assets/quran-model:
 *   features  30 s of 16 kHz audio -> log-mel
 *   encoder   log-mel -> encoder states
 *   decoder   tokens + states -> the two best next tokens per position
 * Not thread-safe: one recognizer thread uses it.
 */
class QuranAsr private constructor(
  private val env: OrtEnvironment,
  private val features: OrtSession,
  private val encoder: OrtSession,
  private val decoder: OrtSession,
  private val pieces: Array<ByteArray>,
  private val prompt: LongArray,
  private val eot: Int,
  private val beginSuppress: Set<Int>,
  val sampleRate: Int,
  val nSamples: Int,
) {
  /** Encoder states for `length` samples of audio, padded to 30 s. The caller closes it. */
  fun encode(pcm: FloatArray, length: Int): OnnxTensor {
    val padded = FloatArray(nSamples)
    System.arraycopy(pcm, 0, padded, 0, minOf(length, nSamples))
    OnnxTensor.createTensor(env, FloatBuffer.wrap(padded), longArrayOf(1, nSamples.toLong())).use { input ->
      features.run(mapOf("pcm" to input)).use { feats ->
        val result = encoder.run(mapOf("input_features" to feats.get(0) as OnnxTensor))
        // detach the states from the result, so it can be closed here
        val states = result.get(0) as OnnxTensor
        val copy = OnnxTensor.createTensor(env, states.floatBuffer, states.info.shape)
        result.close()
        return copy
      }
    }
  }

  /**
   * Greedy decoding that keeps whatever part of `draft` (the last pass's
   * tokens) the model agrees with: verify.py checks this gives exactly the
   * plain greedy answer, only in fewer calls.
   */
  fun decode(states: OnnxTensor, draft: IntArray): IntArray {
    val p = prompt.size
    val tokens = ArrayList<Long>(p + draft.size + 16)
    for (t in prompt) tokens.add(t)
    for (t in draft) if (t < eot) tokens.add(t.toLong())
    var frm = p - 1
    while (tokens.size - p < MAX_NEW) {
      val top2 = run(tokens, states, frm)
      val end = tokens.size
      for (j in top2.indices) {
        val pos = frm + j
        val first = top2[j][0].toInt()
        val second = top2[j][1].toInt()
        val pred = if (pos == p - 1 && first in beginSuppress) second else first
        if (pos == end - 1) {
          if (pred == eot) return textTokens(tokens, p, tokens.size)
          tokens.add(pred.toLong())
          frm = tokens.size - 1
          break
        }
        if (pred.toLong() != tokens[pos + 1]) {
          if (pred == eot) return textTokens(tokens, p, pos + 1)
          while (tokens.size > pos + 1) tokens.removeAt(tokens.size - 1)
          tokens.add(pred.toLong())
          frm = tokens.size - 1
          break
        }
      }
      // a loop the model has fallen into: the same four tokens three times
      val n = tokens.size - p
      if (n >= 12 && (0 until 4).all { k ->
          val a = tokens[tokens.size - 1 - k]
          a == tokens[tokens.size - 5 - k] && a == tokens[tokens.size - 9 - k]
        }
      ) {
        return textTokens(tokens, p, tokens.size - 8)
      }
    }
    return textTokens(tokens, p, tokens.size)
  }

  fun text(tokens: IntArray): String {
    var size = 0
    for (t in tokens) if (t in 0 until eot) size += pieces[t].size
    val out = ByteArray(size)
    var at = 0
    for (t in tokens) {
      if (t !in 0 until eot) continue
      val piece = pieces[t]
      System.arraycopy(piece, 0, out, at, piece.size)
      at += piece.size
    }
    return String(out, Charsets.UTF_8).trim()
  }

  private fun run(tokens: List<Long>, states: OnnxTensor, from: Int): Array<LongArray> {
    val ids = LongArray(tokens.size) { tokens[it] }
    OnnxTensor.createTensor(env, LongBuffer.wrap(ids), longArrayOf(1, ids.size.toLong())).use { input ->
      OnnxTensor.createTensor(env, from.toLong()).use { fromPos ->
        decoder.run(mapOf("input_ids" to input, "encoder_hidden_states" to states, "from_pos" to fromPos)).use { r ->
          @Suppress("UNCHECKED_CAST")
          return (r.get(0).value as Array<Array<LongArray>>)[0]
        }
      }
    }
  }

  private fun textTokens(tokens: List<Long>, from: Int, to: Int): IntArray =
    IntArray(maxOf(0, to - from)) { tokens[from + it].toInt() }

  companion object {
    private const val MAX_NEW = 200
    private const val DIR = "quran-model"

    /** Whether this build carries the model at all. */
    fun bundled(context: Context): Boolean =
      runCatching { context.assets.list(DIR)?.contains("decoder.onnx") == true }.getOrDefault(false)

    @Volatile private var shared: QuranAsr? = null

    /** Loaded once per process: about a second, and the sessions are reused by every session after. */
    @Synchronized
    fun load(context: Context): QuranAsr {
      shared?.let { return it }
      val env = OrtEnvironment.getEnvironment()
      val options = OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(4)
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      }
      fun asset(name: String): ByteArray = context.assets.open("$DIR/$name").use { it.readBytes() }

      val config = JSONObject(String(asset("config.json"), Charsets.UTF_8))
      val promptJson = config.getJSONArray("prompt")
      val prompt = LongArray(promptJson.length()) { promptJson.getLong(it) }
      val suppressJson = config.getJSONArray("beginSuppress")
      val beginSuppress = (0 until suppressJson.length()).map { suppressJson.getInt(it) }.toSet()

      val tokenBytes = ByteBuffer.wrap(asset("tokens.bin")).order(ByteOrder.LITTLE_ENDIAN)
      val eot = tokenBytes.int
      val pieces = Array(eot) {
        val n = tokenBytes.short.toInt() and 0xffff
        ByteArray(n).also { piece -> tokenBytes.get(piece) }
      }
      check(eot == config.getInt("eot")) { "tokens.bin and config.json disagree on end-of-text" }

      val loaded = QuranAsr(
        env = env,
        features = env.createSession(asset("features.onnx"), options),
        encoder = env.createSession(asset("encoder.onnx"), options),
        decoder = env.createSession(asset("decoder.onnx"), options),
        pieces = pieces,
        prompt = prompt,
        eot = eot,
        beginSuppress = beginSuppress,
        sampleRate = config.getInt("sampleRate"),
        nSamples = config.getInt("nSamples"),
      )
      shared = loaded
      return loaded
    }
  }
}
