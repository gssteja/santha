package expo.modules.rtlradio.dsp

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** JNI entry points into libtarangdsp (src/main/cpp). Not thread-safe: use one [Dsp] from one thread. */
internal object NativeDsp {
  init {
    System.loadLibrary("tarangdsp")
  }

  @JvmStatic external fun nativeCreate(): Long
  @JvmStatic external fun nativeDestroy(h: Long)
  @JvmStatic external fun nativeConfigure(h: Long, ch: Int, mode: Int, bw: Int)
  @JvmStatic external fun nativeSetOffset(h: Long, ch: Int, cycles: Int)
  @JvmStatic external fun nativeResetStation(h: Long, ch: Int)
  @JvmStatic external fun nativeSetOptions(h: Long, ch: Int, stereo: Boolean, nr: Boolean)
  @JvmStatic external fun nativeStereoActive(h: Long, ch: Int): Boolean
  @JvmStatic external fun nativeProcess(h: Long, iq: ByteBuffer, n: Int, psd: ByteBuffer?, psdFrames: Int, audioA: ByteBuffer?, audioB: ByteBuffer?): Int
  @JvmStatic external fun nativeMix(audioA: ByteBuffer, audioB: ByteBuffer, frames: Int, ga: Float, gb: Float)
  @JvmStatic external fun nativeRdsInfo(h: Long, ch: Int): Array<String>?
}

class RdsInfo(val pi: String, val pty: String, val ps: String, val rt: String, val synced: Boolean, val groups: Int)

/**
 * Spectrum + two demodulators (channel A and B, anywhere in the 2.4 MHz view) for 2.4 MS/s blocks.
 * All buffers are direct, so nothing is copied across JNI.
 */
class Dsp {
  companion object {
    const val FS = 2_400_000
    const val MAX_BLOCK = 153_600 // 64 ms
    const val FFT_N = 2048
    const val A = 0
    const val B = 1

    val MODES = listOf("AM", "NFM", "WFM", "USB", "LSB", "CW")

    // US RBDS programme types
    val PTY = arrayOf(
      "", "News", "Information", "Sports", "Talk", "Rock", "Classic Rock", "Adult Hits", "Soft Rock", "Top 40",
      "Country", "Oldies", "Soft", "Nostalgia", "Jazz", "Classical", "R&B", "Soft R&B", "Language",
      "Religious Music", "Religious Talk", "Personality", "Public", "College", "", "", "", "", "", "Weather",
      "Emergency Test", "Emergency",
    )

    fun modeIndex(mode: String) = MODES.indexOf(mode).let { if (it < 0) 2 else it }

    /** The mixer works on a 15.625 Hz grid (whole cycles per block); returns cycles per block for [hz]. */
    fun offsetCycles(hz: Long): Int = Math.round(hz.toDouble() * MAX_BLOCK / FS).toInt()
  }

  private var handle = NativeDsp.nativeCreate()

  val iq: ByteBuffer = ByteBuffer.allocateDirect(MAX_BLOCK * 2)
  private val psdBuf: ByteBuffer = ByteBuffer.allocateDirect(FFT_N * 4).order(ByteOrder.nativeOrder())
  /** Interleaved stereo float frames at 48 kHz, ready for AudioTrack.write(ByteBuffer): channel A, or the mix. */
  val audio: ByteBuffer = ByteBuffer.allocateDirect((MAX_BLOCK / 50 + 16) * 8).order(ByteOrder.nativeOrder())
  private val audioB: ByteBuffer = ByteBuffer.allocateDirect((MAX_BLOCK / 50 + 16) * 8).order(ByteOrder.nativeOrder())
  val psd = FloatArray(FFT_N)

  fun configure(ch: Int, mode: String, bw: Int) = NativeDsp.nativeConfigure(handle, ch, modeIndex(mode), bw)

  fun setOffset(ch: Int, cycles: Int) = NativeDsp.nativeSetOffset(handle, ch, cycles)

  fun resetStation(ch: Int) = NativeDsp.nativeResetStation(handle, ch)

  fun setOptions(ch: Int, stereo: Boolean, nr: Boolean) = NativeDsp.nativeSetOptions(handle, ch, stereo, nr)

  fun stereoActive(ch: Int): Boolean = NativeDsp.nativeStereoActive(handle, ch)

  /** Spectrum only, from the first [psdFrames] FFT frames of the [n] samples in [iq]. */
  fun spectrum(n: Int, psdFrames: Int) {
    NativeDsp.nativeProcess(handle, iq, n, psdBuf, psdFrames, null, null)
    psdBuf.asFloatBuffer().get(psd)
  }

  /**
   * Spectrum + demodulation of channel A (and B when [withB]) from the [n] samples in [iq]. Returns the
   * number of stereo frames; call [mix] to combine the two (the result is in [audio]).
   */
  fun demod(n: Int, psdFrames: Int, withB: Boolean): Int {
    val r = NativeDsp.nativeProcess(handle, iq, n, psdBuf, psdFrames, audio, if (withB) audioB else null)
    psdBuf.asFloatBuffer().get(psd)
    return r and 0xffff
  }

  /** audio = clip(A * ga + B * gb); with no B, just A * ga. */
  fun mix(frames: Int, ga: Float, gb: Float) = NativeDsp.nativeMix(audio, audioB, frames, ga, gb)

  fun rdsInfo(ch: Int): RdsInfo? {
    val f = NativeDsp.nativeRdsInfo(handle, ch) ?: return null
    return RdsInfo(f[0], f[1], f[2], f[3], f[4] == "1", f[5].toIntOrNull() ?: 0)
  }

  fun release() {
    if (handle != 0L) {
      NativeDsp.nativeDestroy(handle)
      handle = 0
    }
  }
}
