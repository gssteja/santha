package expo.modules.rtlradio.usb

import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.hardware.usb.UsbRequest
import android.util.Log
import java.nio.ByteBuffer
import java.util.concurrent.TimeoutException

class RtlSdrException(message: String) : Exception(message)

/**
 * RTL2832U driver over the Android USB host API, so no separate "SDR driver" app is needed.
 *
 * A Kotlin port of the parts of osmocom librtlsdr (librtlsdr.c, GPL-2.0-or-later) that this app uses:
 * baseband init, sample rate, IF/xtal correction, tuner probing (Rafael R820T/R820T2/R828D only, which
 * covers the NESDR SMArt and RTL-SDR Blog sticks) and bulk streaming. Register sequences follow the C code
 * line for line; the tuner itself lives in [R82xx].
 */
class RtlSdr private constructor(
  private val conn: UsbDeviceConnection,
  private val iface: UsbInterface,
  private val endpoint: UsbEndpoint,
  val manufacturer: String,
  val product: String,
) {
  companion object {
    private const val TAG = "RtlSdr"

    const val DEF_RTL_XTAL_FREQ = 28_800_000L

    private const val CTRL_IN = UsbConstants.USB_TYPE_VENDOR or UsbConstants.USB_DIR_IN
    private const val CTRL_OUT = UsbConstants.USB_TYPE_VENDOR or UsbConstants.USB_DIR_OUT
    private const val CTRL_TIMEOUT = 300

    // blocks
    private const val DEMODB = 0
    private const val USBB = 1
    private const val SYSB = 2
    private const val IICB = 6

    // usb_reg
    private const val USB_SYSCTL = 0x2000
    private const val USB_EPA_CTL = 0x2148
    private const val USB_EPA_MAXPKT = 0x2158

    // sys_reg
    private const val DEMOD_CTL = 0x3000
    private const val GPO = 0x3001
    private const val GPOE = 0x3003
    private const val GPD = 0x3004
    private const val DEMOD_CTL_1 = 0x300b

    private val FIR_DEFAULT = intArrayOf(
      -54, -36, -41, -40, -32, -14, 14, 53, // 8 bit signed
      101, 156, 215, 273, 327, 372, 404, 421, // 12 bit signed
    )

    /** Tenths of a dB, as librtlsdr reports them for the R82xx tuners. */
    val R82XX_GAINS = intArrayOf(
      0, 9, 14, 27, 37, 77, 87, 125, 144, 157, 166, 197, 207, 229, 254, 280, 297, 328,
      338, 364, 372, 386, 402, 421, 434, 439, 445, 480, 496,
    )

    // USB transfers in flight while streaming. 24 x 16 KiB is ~80 ms of samples at 2.4 MS/s.
    private const val NUM_TRANSFERS = 24
    private const val TRANSFER_BYTES = 16 * 1024

    fun isSupported(device: UsbDevice): Boolean =
      device.vendorId == 0x0bda && (device.productId == 0x2832 || device.productId == 0x2838)

    /** Opens and initialises the dongle. The caller must already hold USB permission for it. */
    fun open(manager: UsbManager, device: UsbDevice): RtlSdr {
      val conn = manager.openDevice(device) ?: throw RtlSdrException("Couldn't open the dongle - is another app using it?")
      try {
        val iface = device.getInterface(0)
        if (!conn.claimInterface(iface, true)) throw RtlSdrException("Couldn't claim the dongle's USB interface")
        val ep = (0 until iface.endpointCount).map { iface.getEndpoint(it) }
          .firstOrNull { it.type == UsbConstants.USB_ENDPOINT_XFER_BULK && it.direction == UsbConstants.USB_DIR_IN }
          ?: throw RtlSdrException("The dongle has no bulk input endpoint")
        val dev = RtlSdr(conn, iface, ep, device.manufacturerName ?: "", device.productName ?: "")
        dev.init()
        return dev
      } catch (e: Exception) {
        conn.close()
        throw e
      }
    }
  }

  private val fir = FIR_DEFAULT.copyOf()
  private var rtlXtal = DEF_RTL_XTAL_FREQ
  private var tunXtal = DEF_RTL_XTAL_FREQ
  private var corr = 0
  private lateinit var tuner: R82xx

  var rate = 0
    private set
  var centerFreq = 0L
    private set
  var tunerName = ""
    private set

  @Volatile private var streaming = false
  private var streamThread: Thread? = null
  @Volatile var lost = false
    private set

  // ---------- register access ----------

  private fun readArray(block: Int, addr: Int, buf: ByteArray, len: Int): Int =
    conn.controlTransfer(CTRL_IN, 0, addr, block shl 8, buf, len, CTRL_TIMEOUT)

  private fun writeArray(block: Int, addr: Int, buf: ByteArray, len: Int): Int =
    conn.controlTransfer(CTRL_OUT, 0, addr, (block shl 8) or 0x10, buf, len, CTRL_TIMEOUT)

  internal fun i2cWrite(i2cAddr: Int, buf: ByteArray, len: Int): Int = writeArray(IICB, i2cAddr, buf, len)

  internal fun i2cRead(i2cAddr: Int, buf: ByteArray, len: Int): Int = readArray(IICB, i2cAddr, buf, len)

  private fun i2cReadReg(i2cAddr: Int, reg: Int): Int {
    val b = byteArrayOf(reg.toByte())
    writeArray(IICB, i2cAddr, b, 1)
    b[0] = 0
    readArray(IICB, i2cAddr, b, 1)
    return b[0].toInt() and 0xff
  }

  private fun readReg(block: Int, addr: Int, len: Int): Int {
    val data = ByteArray(2)
    val r = conn.controlTransfer(CTRL_IN, 0, addr, block shl 8, data, len, CTRL_TIMEOUT)
    if (r < 0) Log.w(TAG, "readReg failed with $r")
    return ((data[1].toInt() and 0xff) shl 8) or (data[0].toInt() and 0xff)
  }

  private fun writeReg(block: Int, addr: Int, value: Int, len: Int): Int {
    val data = ByteArray(2)
    data[0] = (if (len == 1) value and 0xff else (value shr 8) and 0xff).toByte()
    data[1] = (value and 0xff).toByte()
    val r = conn.controlTransfer(CTRL_OUT, 0, addr, (block shl 8) or 0x10, data, len, CTRL_TIMEOUT)
    if (r < 0) Log.w(TAG, "writeReg failed with $r")
    return r
  }

  private fun demodReadReg(page: Int, addr: Int, len: Int): Int {
    val data = ByteArray(2)
    val r = conn.controlTransfer(CTRL_IN, 0, (addr shl 8) or 0x20, page, data, len, CTRL_TIMEOUT)
    if (r < 0) Log.w(TAG, "demodReadReg failed with $r")
    return ((data[1].toInt() and 0xff) shl 8) or (data[0].toInt() and 0xff)
  }

  private fun demodWriteReg(page: Int, addr: Int, value: Int, len: Int): Int {
    val data = ByteArray(2)
    data[0] = (if (len == 1) value and 0xff else (value shr 8) and 0xff).toByte()
    data[1] = (value and 0xff).toByte()
    val r = conn.controlTransfer(CTRL_OUT, 0, (addr shl 8) or 0x20, 0x10 or page, data, len, CTRL_TIMEOUT)
    if (r < 0) Log.w(TAG, "demodWriteReg failed with $r")
    demodReadReg(0x0a, 0x01, 1)
    return if (r == len) 0 else -1
  }

  private fun setGpioBit(gpio: Int, on: Boolean) {
    val bit = 1 shl gpio
    var r = readReg(SYSB, GPO, 1)
    r = if (on) r or bit else r and bit.inv()
    writeReg(SYSB, GPO, r, 1)
  }

  private fun setGpioOutput(gpio: Int) {
    val bit = 1 shl gpio
    var r = readReg(SYSB, GPD, 1)
    writeReg(SYSB, GPD, r and bit.inv(), 1)
    r = readReg(SYSB, GPOE, 1)
    writeReg(SYSB, GPOE, r or bit, 1)
  }

  internal fun setBiasTeeGpio(gpio: Int, on: Boolean) {
    setGpioOutput(gpio)
    setGpioBit(gpio, on)
  }

  private fun setI2cRepeater(on: Boolean) {
    demodWriteReg(1, 0x01, if (on) 0x18 else 0x10, 1)
  }

  private fun setFir(): Int {
    val out = IntArray(20)
    for (i in 0 until 8) {
      val v = fir[i]
      if (v < -128 || v > 127) return -1
      out[i] = v and 0xff
    }
    var i = 0
    while (i < 8) {
      val v0 = fir[8 + i]
      val v1 = fir[8 + i + 1]
      if (v0 < -2048 || v0 > 2047 || v1 < -2048 || v1 > 2047) return -1
      out[8 + i * 3 / 2] = (v0 shr 4) and 0xff
      out[8 + i * 3 / 2 + 1] = ((v0 shl 4) or ((v1 shr 8) and 0x0f)) and 0xff
      out[8 + i * 3 / 2 + 2] = v1 and 0xff
      i += 2
    }
    for (k in out.indices) {
      if (demodWriteReg(1, 0x1c + k, out[k], 1) != 0) return -1
    }
    return 0
  }

  private fun initBaseband() {
    // initialize USB
    writeReg(USBB, USB_SYSCTL, 0x09, 1)
    writeReg(USBB, USB_EPA_MAXPKT, 0x0002, 2)
    writeReg(USBB, USB_EPA_CTL, 0x1002, 2)

    // power on demod
    writeReg(SYSB, DEMOD_CTL_1, 0x22, 1)
    writeReg(SYSB, DEMOD_CTL, 0xe8, 1)

    // reset demod (bit 3, soft_rst)
    demodWriteReg(1, 0x01, 0x14, 1)
    demodWriteReg(1, 0x01, 0x10, 1)

    // disable spectrum inversion and adjacent channel rejection
    demodWriteReg(1, 0x15, 0x00, 1)
    demodWriteReg(1, 0x16, 0x0000, 2)

    // clear both DDC shift and IF frequency registers
    for (i in 0 until 6) demodWriteReg(1, 0x16 + i, 0x00, 1)

    setFir()

    // enable SDR mode, disable DAGC (bit 5)
    demodWriteReg(0, 0x19, 0x05, 1)

    // init FSM state-holding register
    demodWriteReg(1, 0x93, 0xf0, 1)
    demodWriteReg(1, 0x94, 0x0f, 1)

    // disable AGC (en_dagc, bit 0)
    demodWriteReg(1, 0x11, 0x00, 1)

    // disable RF and IF AGC loop
    demodWriteReg(1, 0x04, 0x00, 1)

    // disable PID filter
    demodWriteReg(0, 0x61, 0x60, 1)

    // opt_adc_iq = 0, default ADC_I/ADC_Q datapath
    demodWriteReg(0, 0x06, 0x80, 1)

    // enable Zero-IF mode, DC cancellation, IQ estimation/compensation
    demodWriteReg(1, 0xb1, 0x1b, 1)

    // disable 4.096 MHz clock output on pin TP_CK0
    demodWriteReg(0, 0x0d, 0x83, 1)
  }

  private fun deinitBaseband() {
    setI2cRepeater(true)
    tuner.standby()
    setI2cRepeater(false)
    // power off demodulator and ADCs
    writeReg(SYSB, DEMOD_CTL, 0x20, 1)
  }

  private fun correctedRtlXtal(): Long = (rtlXtal * (1.0 + corr / 1e6)).toLong()

  internal fun correctedTunerXtal(): Long = (tunXtal * (1.0 + corr / 1e6)).toLong()

  private fun setIfFreq(freq: Long): Int {
    val ifFreq = (-(freq * 4194304.0 / correctedRtlXtal())).toInt()
    var r = demodWriteReg(1, 0x19, (ifFreq shr 16) and 0x3f, 1)
    r = r or demodWriteReg(1, 0x1a, (ifFreq shr 8) and 0xff, 1)
    r = r or demodWriteReg(1, 0x1b, ifFreq and 0xff, 1)
    return r
  }

  private fun setSampleFreqCorrection(ppm: Int): Int {
    val offs = (ppm * -1 * 16777216.0 / 1e6).toInt().toShort().toInt()
    var r = demodWriteReg(1, 0x3f, offs and 0xff, 1)
    r = r or demodWriteReg(1, 0x3e, (offs shr 8) and 0x3f, 1)
    return r
  }

  private fun init() {
    rtlXtal = DEF_RTL_XTAL_FREQ

    // librtlsdr resets the device if this dummy write fails; Android offers no reset, so report it instead
    if (writeReg(USBB, USB_SYSCTL, 0x09, 1) < 0) throw RtlSdrException("The dongle isn't responding - unplug it and plug it back in")

    initBaseband()

    // probe the tuner
    setI2cRepeater(true)
    val chip = when {
      i2cReadReg(R82xx.R820T_I2C_ADDR, R82xx.CHECK_ADDR) == R82xx.CHECK_VAL -> R82xx.Chip.R820T
      i2cReadReg(R82xx.R828D_I2C_ADDR, R82xx.CHECK_ADDR) == R82xx.CHECK_VAL -> R82xx.Chip.R828D
      else -> {
        setI2cRepeater(false)
        throw RtlSdrException("Unsupported tuner - this app needs an R820T/R828D dongle (NESDR SMArt, RTL-SDR Blog V3/V4)")
      }
    }
    val blogV4 = manufacturer == "RTLSDRBlog" && product == "Blog V4"
    val blogV4L = manufacturer == "RTLSDRBlog" && product == "Blog V4L"
    tunerName = when {
      blogV4 -> "R828D (RTL-SDR Blog V4)"
      chip == R82xx.Chip.R828D -> "R828D"
      else -> "R820T"
    }

    // use the rtl clock value by default
    tunXtal = rtlXtal
    if (chip == R82xx.Chip.R828D && !blogV4) tunXtal = R82xx.R828D_XTAL_FREQ

    // disable Zero-IF mode
    demodWriteReg(1, 0xb1, 0x1a, 1)
    // only enable In-phase ADC input
    demodWriteReg(0, 0x08, 0x4d, 1)
    // the R82XX use 3.57 MHz IF for the DVB-T 6 MHz mode
    setIfFreq(R82xx.IF_FREQ)
    // enable spectrum inversion
    demodWriteReg(1, 0x15, 0x01, 1)

    tuner = R82xx(this, chip, blogV4, blogV4L)
    val r = tuner.init(correctedTunerXtal())
    setI2cRepeater(false)
    if (r < 0) throw RtlSdrException("Tuner initialisation failed ($r)")
  }

  // ---------- public controls ----------

  /** Sets the sample rate (225-300 kS/s or 900 kS/s-3.2 MS/s). */
  fun setSampleRate(sampRate: Int) {
    if (sampRate <= 225_000 || sampRate > 3_200_000 || (sampRate in 300_001..900_000)) {
      throw RtlSdrException("Invalid sample rate: $sampRate Hz")
    }
    var rsampRatio = (rtlXtal * 4194304.0 / sampRate).toLong() and 0xffffffffL
    rsampRatio = rsampRatio and 0x0ffffffcL
    val realRsampRatio = rsampRatio or ((rsampRatio and 0x08000000L) shl 1)
    rate = (rtlXtal * 4194304.0 / realRsampRatio).toInt()

    setI2cRepeater(true)
    setTunerBandwidth(rate)
    setI2cRepeater(false)

    var r = demodWriteReg(1, 0x9f, ((rsampRatio shr 16) and 0xffff).toInt(), 2)
    r = r or demodWriteReg(1, 0xa1, (rsampRatio and 0xffff).toInt(), 2)
    r = r or setSampleFreqCorrection(corr)

    // reset demod (bit 3, soft_rst)
    r = r or demodWriteReg(1, 0x01, 0x14, 1)
    r = r or demodWriteReg(1, 0x01, 0x10, 1)
    if (r != 0) throw RtlSdrException("Could not set sample rate")
  }

  // r820t_set_bw: the IF follows the filter bandwidth, then retune so the new IF takes effect
  private fun setTunerBandwidth(bw: Int) {
    val ifFreq = tuner.setBandwidth(bw)
    setIfFreq(ifFreq.toLong())
    if (centerFreq != 0L) setCenterFreqInternal(centerFreq)
  }

  private fun setCenterFreqInternal(freq: Long): Boolean {
    val r = if (directSampling != 0) {
      setIfFreq(freq)
    } else {
      setI2cRepeater(true)
      val rc = tuner.setFreq(freq)
      setI2cRepeater(false)
      rc
    }
    centerFreq = if (r == 0) freq else 0
    return r == 0
  }

  /** 0 = tuner, 1 = I branch, 2 = Q branch (HF below 24 MHz on the NESDR SMArt v5). Restart streaming around it. */
  var directSampling = 0
    private set

  fun setDirectSampling(mode: Int) {
    if (mode == directSampling) return
    var r = 0
    if (mode != 0) {
      setI2cRepeater(true)
      r = tuner.standby()
      setI2cRepeater(false)
      // disable Zero-IF mode
      r = r or demodWriteReg(1, 0xb1, 0x1a, 1)
      // disable spectrum inversion
      r = r or demodWriteReg(1, 0x15, 0x00, 1)
      // only enable In-phase ADC input
      r = r or demodWriteReg(0, 0x08, 0x4d, 1)
      // swap I and Q ADC, this selects between the two inputs
      r = r or demodWriteReg(0, 0x06, if (mode > 1) 0x90 else 0x80, 1)
      directSampling = mode
    } else {
      setI2cRepeater(true)
      r = tuner.init(correctedTunerXtal())
      // the init resets the IF filter; put back the one for the current sample rate (librtlsdr leaves the
      // 6 MHz DVB-T default here)
      if (rate > 0) setIfFreq(tuner.setBandwidth(rate).toLong()) else r = r or setIfFreq(R82xx.IF_FREQ)
      setI2cRepeater(false)
      // enable spectrum inversion
      r = r or demodWriteReg(1, 0x15, 0x01, 1)
      // opt_adc_iq = 0, default ADC_I/ADC_Q datapath
      r = r or demodWriteReg(0, 0x06, 0x80, 1)
      directSampling = 0
    }
    if (r < 0) Log.w(TAG, "setDirectSampling($mode) failed=$r")
    if (centerFreq != 0L) setCenterFreqInternal(centerFreq)
  }

  /** Tunes the dongle; returns false if the tuner's PLL didn't lock. */
  fun setCenterFreq(freq: Long): Boolean = setCenterFreqInternal(freq)

  fun setFreqCorrection(ppm: Int) {
    if (corr == ppm) return
    corr = ppm
    setSampleFreqCorrection(ppm)
    tuner.xtal = correctedTunerXtal()
    if (centerFreq != 0L) setCenterFreqInternal(centerFreq)
  }

  fun gains(): List<Double> = R82XX_GAINS.map { it / 10.0 }

  /** Gain in dB, or null for the tuner's automatic gain. */
  fun setGain(db: Double?) {
    setI2cRepeater(true)
    if (db == null) {
      tuner.setGain(false, 0)
    } else {
      tuner.setGain(true, 0)
      tuner.setGain(true, Math.round(db * 10).toInt())
    }
    setI2cRepeater(false)
  }

  fun setAgcMode(on: Boolean) {
    demodWriteReg(0, 0x19, if (on) 0x25 else 0x05, 1)
  }

  private fun resetBuffer() {
    writeReg(USBB, USB_EPA_CTL, 0x1002, 2)
    writeReg(USBB, USB_EPA_CTL, 0x0000, 2)
  }

  // ---------- streaming ----------

  /**
   * Streams samples on a background thread, calling [onData] with each USB transfer (interleaved unsigned
   * 8-bit I/Q). [onLost] is called once if the dongle stops responding (e.g. it was unplugged).
   */
  fun startStreaming(onData: (ByteArray, Int) -> Unit, onLost: (String) -> Unit) {
    check(!streaming)
    resetBuffer()
    streaming = true
    streamThread = Thread({ streamLoop(onData, onLost) }, "rtlsdr-usb").apply {
      priority = Thread.MAX_PRIORITY
      start()
    }
  }

  private fun streamLoop(onData: (ByteArray, Int) -> Unit, onLost: (String) -> Unit) {
    val requests = ArrayList<UsbRequest>()
    val buffers = ArrayList<ByteBuffer>()
    val chunk = ByteArray(TRANSFER_BYTES)
    var inFlight = 0
    try {
      for (i in 0 until NUM_TRANSFERS) {
        val req = UsbRequest()
        if (!req.initialize(conn, endpoint)) throw RtlSdrException("USB request setup failed")
        val buf = ByteBuffer.allocateDirect(TRANSFER_BYTES)
        req.clientData = i
        requests.add(req)
        buffers.add(buf)
        if (!req.queue(buf)) throw RtlSdrException("USB request queueing failed")
        inFlight++
      }
      var timeouts = 0
      while (streaming) {
        val done = try {
          conn.requestWait(250)
        } catch (e: TimeoutException) {
          // a couple of quiet periods are normal while retuning; a full second means the stick is gone
          if (++timeouts >= 4) throw RtlSdrException("no samples for 1 s")
          continue
        }
        if (done == null) throw RtlSdrException("USB transfer failed")
        timeouts = 0
        inFlight--
        val buf = buffers[done.clientData as Int]
        val n = buf.position()
        buf.flip()
        buf.get(chunk, 0, n)
        buf.clear()
        if (n > 0) onData(chunk, n)
        if (streaming) {
          if (!done.queue(buf)) throw RtlSdrException("USB request queueing failed")
          inFlight++
        }
      }
    } catch (e: Exception) {
      if (streaming) {
        lost = true
        streaming = false
        Log.w(TAG, "streaming stopped: ${e.message}")
        onLost(e.message ?: "USB error")
      }
    } finally {
      // reap what's still in flight before the requests are freed
      for (r in requests) r.cancel()
      var spins = 0
      while (inFlight > 0 && spins++ < 50) {
        try {
          if (conn.requestWait(20) == null) break
          inFlight--
        } catch (e: TimeoutException) {
          break
        } catch (e: Exception) {
          break
        }
      }
      for (r in requests) r.close()
    }
  }

  /** Stops the transfers and joins the USB thread; [startStreaming] may be called again afterwards. */
  fun stopStreaming() {
    streaming = false
    streamThread?.join(2000)
    streamThread = null
  }

  fun close() {
    stopStreaming()
    if (!lost) {
      try {
        deinitBaseband()
      } catch (e: Exception) {
        Log.w(TAG, "deinit failed: ${e.message}")
      }
    }
    conn.releaseInterface(iface)
    conn.close()
  }
}
