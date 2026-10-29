package expo.modules.rtlradio.dsp

import java.nio.ByteBuffer

/** JNI entry points for the P25 trunked receiver (p25jni.cpp, p25.cpp). */
internal object NativeP25 {
  init {
    System.loadLibrary("tarangdsp")
  }

  @JvmStatic external fun create(): Long
  @JvmStatic external fun destroy(h: Long)
  @JvmStatic external fun setControlChannels(h: Long, hz: LongArray)
  @JvmStatic external fun setFlags(h: Long, ids: IntArray, flags: IntArray)
  @JvmStatic external fun setOptions(h: Long, favoritesOnly: Boolean, hangMs: Int, muted: Boolean)
  @JvmStatic external fun setSystem(h: Long, wacn: Int, sysid: Int, nac: Int)
  @JvmStatic external fun skip(h: Long, nowMs: Long)
  @JvmStatic external fun hold(h: Long, tg: Int)
  @JvmStatic external fun process(h: Long, iq: ByteBuffer, n: Int, hwCenter: Long, nowMs: Long): Long
  @JvmStatic external fun render(h: Long, audio: ByteBuffer, frames: Int): Boolean
  @JvmStatic external fun state(h: Long, nowMs: Long): String
  @JvmStatic external fun takeEvents(h: Long): String?
}

/**
 * P25 trunk-following receiver for 2.4 MS/s blocks: control channel, voice grants, Phase 1 / Phase 2 voice.
 * Use from one thread (the radio thread).
 */
class P25Receiver {
  private var handle = NativeP25.create()

  fun setControlChannels(hz: LongArray) = NativeP25.setControlChannels(handle, hz)

  /** Talkgroup flags: 1 = favorite (followed first), 2 = locked out. */
  fun setFlags(ids: IntArray, flags: IntArray) = NativeP25.setFlags(handle, ids, flags)

  /** [muted]: stay on the control channel (activity only, no calls followed). */
  fun setOptions(favoritesOnly: Boolean, hangMs: Int, muted: Boolean) = NativeP25.setOptions(handle, favoritesOnly, hangMs, muted)

  /** The system's WACN / system ID / NAC, used for the TDMA scrambler until the control channel announces them. */
  fun setSystem(wacn: Int, sysid: Int, nac: Int) = NativeP25.setSystem(handle, wacn, sysid, nac)

  fun skip(nowMs: Long) = NativeP25.skip(handle, nowMs)

  /** Only follow [tg]; -1 releases the hold. */
  fun hold(tg: Int) = NativeP25.hold(handle, tg)

  /** [n] samples in [iq], tuned to [hwCenter]; returns where the dongle should be tuned. */
  fun process(iq: ByteBuffer, n: Int, hwCenter: Long, nowMs: Long): Long = NativeP25.process(handle, iq, n, hwCenter, nowMs)

  /** Writes exactly [frames] stereo 48 kHz frames of call audio to [audio]; true if any of it was call audio. */
  fun render(audio: ByteBuffer, frames: Int): Boolean = NativeP25.render(handle, audio, frames)

  /** Control channel, system, current call, talkgroup activity, call log and receiver stats as JSON. */
  fun state(nowMs: Long): String = NativeP25.state(handle, nowMs)

  /** JSON lines for calls that ended since the last call. */
  fun takeEvents(): List<String> = NativeP25.takeEvents(handle)?.split('\n')?.filter { it.isNotBlank() } ?: emptyList()

  fun release() {
    if (handle != 0L) {
      NativeP25.destroy(handle)
      handle = 0
    }
  }
}
