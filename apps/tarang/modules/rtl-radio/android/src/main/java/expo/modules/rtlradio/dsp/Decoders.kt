package expo.modules.rtlradio.dsp

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** JNI entry points for the ADS-B decoder (adsb.cpp) and rtl_433's sensor decoders (r433.c). */
internal object NativeDecoders {
  init {
    System.loadLibrary("tarangdsp")
  }

  @JvmStatic external fun adsbCreate(): Long
  @JvmStatic external fun adsbDestroy(h: Long)
  @JvmStatic external fun adsbSetReceiver(h: Long, known: Boolean, lat: Double, lon: Double)
  @JvmStatic external fun adsbProcess(h: Long, iq: ByteBuffer, n: Int, nowMs: Long): Int
  @JvmStatic external fun adsbSnapshot(h: Long, out: ByteBuffer, nowMs: Long): Int
  @JvmStatic external fun adsbMessages(h: Long): Long

  @JvmStatic external fun sensorsCreate(rate: Int): Long
  @JvmStatic external fun sensorsDestroy(h: Long)
  @JvmStatic external fun sensorsReset(h: Long, centerHz: Int)
  @JvmStatic external fun sensorsProcess(h: Long, iq: ByteBuffer, n: Int): Int
  @JvmStatic external fun sensorsTake(h: Long): String?
  @JvmStatic external fun sensorsDecoders(h: Long): Int
}

/** One aircraft as the decoder last heard it. Optional values are null until a message carries them. */
class Plane(
  val icao: Int,
  val lat: Double,
  val lon: Double,
  val hasPos: Boolean,
  val ground: Boolean,
  val nonIcao: Boolean,
  val alt: Int?,
  val gnssAlt: Int?,
  val gs: Float?,
  val track: Float?,
  val heading: Float?,
  val vr: Int?,
  val squawk: String?,
  val emergency: Int,
  val category: Int,
  val rssi: Float,
  val messages: Int,
  val seenAgoMs: Int,
  val posAgoMs: Int,
  val flight: String,
) {
  val hex: String get() = (if (nonIcao) "~" else "") + "%06x".format(icao)
}

/** Mode S / ADS-B receiver for 2.4 MS/s blocks at 1090 MHz. Use from one thread. */
class AdsbDecoder {
  companion object {
    private const val RECORD = 88 // sizeof(tarang::AircraftRecord)
    private const val MAX = 512
  }

  private var handle = NativeDecoders.adsbCreate()
  private val out: ByteBuffer = ByteBuffer.allocateDirect(RECORD * MAX).order(ByteOrder.LITTLE_ENDIAN)

  fun setReceiver(lat: Double?, lon: Double?) =
    NativeDecoders.adsbSetReceiver(handle, lat != null && lon != null, lat ?: 0.0, lon ?: 0.0)

  /** Returns the messages accepted from the [n] samples in [iq]. */
  fun process(iq: ByteBuffer, n: Int, nowMs: Long): Int = NativeDecoders.adsbProcess(handle, iq, n, nowMs)

  val messages: Long get() = NativeDecoders.adsbMessages(handle)

  fun snapshot(nowMs: Long): List<Plane> {
    val n = NativeDecoders.adsbSnapshot(handle, out, nowMs)
    val list = ArrayList<Plane>(n)
    val b = out
    val cs = ByteArray(8)
    for (i in 0 until n) {
      val o = i * RECORD
      val flags = b.getInt(o + 4)
      for (k in 0 until 8) cs[k] = b.get(o + 76 + k)
      val len = cs.indexOfFirst { it.toInt() == 0 }.let { if (it < 0) 8 else it }
      val squawk = b.getInt(o + 48)
      list.add(
        Plane(
          icao = b.getInt(o),
          lat = b.getDouble(o + 8),
          lon = b.getDouble(o + 16),
          hasPos = flags and 1 != 0,
          ground = flags and 2 != 0,
          nonIcao = flags and 4 != 0,
          alt = if (flags and 8 != 0) b.getInt(o + 24) else null,
          gnssAlt = if (flags and 256 != 0) b.getInt(o + 28) else null,
          gs = if (flags and 16 != 0) b.getFloat(o + 32) else null,
          track = if (flags and 32 != 0) b.getFloat(o + 36) else null,
          heading = b.getFloat(o + 40).takeIf { it >= 0 },
          vr = if (flags and 64 != 0) b.getInt(o + 44) else null,
          squawk = if (flags and 128 != 0) "%04x".format(squawk) else null,
          emergency = b.getInt(o + 52),
          category = b.getInt(o + 56),
          rssi = b.getFloat(o + 60),
          messages = b.getInt(o + 64),
          seenAgoMs = b.getInt(o + 68),
          posAgoMs = b.getInt(o + 72),
          flight = String(cs, 0, len, Charsets.US_ASCII),
        ),
      )
    }
    return list
  }

  fun release() {
    if (handle != 0L) {
      NativeDecoders.adsbDestroy(handle)
      handle = 0
    }
  }
}

/** rtl_433's device decoders for CU8 samples at [rate]. Use from one thread. */
class SensorDecoder(rate: Int) {
  private var handle = NativeDecoders.sensorsCreate(rate)

  val decoders: Int get() = NativeDecoders.sensorsDecoders(handle)

  /** After every retune. */
  fun reset(centerHz: Long) = NativeDecoders.sensorsReset(handle, centerHz.toInt())

  /** Runs the [n] samples in [iq] through the decoders; returns the messages decoded. */
  fun process(iq: ByteBuffer, n: Int): Int = NativeDecoders.sensorsProcess(handle, iq, n)

  /** JSON messages (one per line) decoded since the last call. */
  fun take(): List<String> = NativeDecoders.sensorsTake(handle)?.split('\n')?.filter { it.isNotBlank() } ?: emptyList()

  fun release() {
    if (handle != 0L) {
      NativeDecoders.sensorsDestroy(handle)
      handle = 0
    }
  }
}
