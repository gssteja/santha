package expo.modules.rtlradio.usb

import android.util.Log

/**
 * Rafael Micro R820T/R828D tuner, ported from osmocom librtlsdr's tuner_r82xx.c (GPL-2.0-or-later,
 * Mauro Carvalho Chehab / Steve Markgraf), including the RTL-SDR Blog V4 input switching.
 * Registers are kept in a shadow copy so unchanged writes are skipped, exactly as the C driver does.
 * All register values are handled as Ints in 0..255.
 */
internal class R82xx(
  private val rtl: RtlSdr,
  private val chip: Chip,
  private val blogV4: Boolean,
  private val blogV4L: Boolean,
) {
  enum class Chip { R820T, R828D }

  companion object {
    private const val TAG = "R82xx"

    const val R820T_I2C_ADDR = 0x34
    const val R828D_I2C_ADDR = 0x74
    const val R828D_XTAL_FREQ = 16_000_000L
    const val CHECK_ADDR = 0x00
    const val CHECK_VAL = 0x69
    const val IF_FREQ = 3_570_000L

    private const val REG_SHADOW_START = 5
    private const val NUM_REGS = 30
    private const val VER_NUM = 49
    private const val MAX_I2C_MSG_LEN = 8

    private const val HF = 1
    private const val VHF = 2
    private const val UHF = 3

    // xtal_cap_sel values
    private const val XTAL_LOW_CAP_30P = 0
    private const val XTAL_LOW_CAP_20P = 1
    private const val XTAL_LOW_CAP_10P = 2
    private const val XTAL_LOW_CAP_0P = 3
    private const val XTAL_HIGH_CAP_0P = 4

    // initial values from REG_SHADOW_START; the C array is NUM_REGS long, so the last 3 are zero
    private val INIT_ARRAY = intArrayOf(
      0x83, 0x32, 0x75, // 05 to 07
      0xc0, 0x40, 0xd6, 0x6c, // 08 to 0b
      0xf5, 0x63, 0x75, 0x68, // 0c to 0f
      0x6c, 0x83, 0x80, 0x00, // 10 to 13
      0x0f, 0x00, 0xc0, 0x30, // 14 to 17
      0x48, 0xcc, 0x60, 0x00, // 18 to 1b
      0x54, 0xae, 0x4a, 0xc0, // 1c to 1f
      0x00, 0x00, 0x00,
    )

    private class FreqRange(val freqMhz: Int, val openD: Int, val rfMuxPloy: Int, val tfC: Int, val xtalCap20p: Int, val xtalCap10p: Int, val xtalCap0p: Int)

    private val FREQ_RANGES = arrayOf(
      FreqRange(0, 0x08, 0x02, 0xdf, 0x02, 0x01, 0x00),
      FreqRange(50, 0x08, 0x02, 0xbe, 0x02, 0x01, 0x00),
      FreqRange(55, 0x08, 0x02, 0x8b, 0x02, 0x01, 0x00),
      FreqRange(60, 0x08, 0x02, 0x7b, 0x02, 0x01, 0x00),
      FreqRange(65, 0x08, 0x02, 0x69, 0x02, 0x01, 0x00),
      FreqRange(70, 0x08, 0x02, 0x58, 0x02, 0x01, 0x00),
      FreqRange(75, 0x00, 0x02, 0x44, 0x02, 0x01, 0x00),
      FreqRange(80, 0x00, 0x02, 0x44, 0x02, 0x01, 0x00),
      FreqRange(90, 0x00, 0x02, 0x34, 0x01, 0x01, 0x00),
      FreqRange(100, 0x00, 0x02, 0x34, 0x01, 0x01, 0x00),
      FreqRange(110, 0x00, 0x02, 0x24, 0x01, 0x01, 0x00),
      FreqRange(120, 0x00, 0x02, 0x24, 0x01, 0x01, 0x00),
      FreqRange(140, 0x00, 0x02, 0x14, 0x01, 0x01, 0x00),
      FreqRange(180, 0x00, 0x02, 0x13, 0x00, 0x00, 0x00),
      FreqRange(220, 0x00, 0x02, 0x13, 0x00, 0x00, 0x00),
      FreqRange(250, 0x00, 0x02, 0x11, 0x00, 0x00, 0x00),
      FreqRange(280, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00),
      FreqRange(310, 0x00, 0x41, 0x00, 0x00, 0x00, 0x00),
      FreqRange(450, 0x00, 0x41, 0x00, 0x00, 0x00, 0x00),
      FreqRange(588, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00),
      FreqRange(650, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00),
    )

    private val LNA_GAIN_STEPS = intArrayOf(0, 9, 13, 40, 38, 13, 31, 22, 26, 31, 26, 14, 19, 5, 35, 13)
    private val MIXER_GAIN_STEPS = intArrayOf(0, 5, 10, 10, 19, 9, 10, 25, 17, 10, 8, 16, 13, 6, 3, -8)

    // bandwidth contribution by the IF low-pass filter
    private val IF_LOW_PASS_BW_TABLE = intArrayOf(1700000, 1600000, 1550000, 1450000, 1200000, 900000, 700000, 550000, 450000, 350000)
    private const val FILT_HP_BW1 = 350000
    private const val FILT_HP_BW2 = 380000

    private val BITREV_LUT = intArrayOf(0x0, 0x8, 0x4, 0xc, 0x2, 0xa, 0x6, 0xe, 0x1, 0x9, 0x5, 0xd, 0x3, 0xb, 0x7, 0xf)

    private fun bitrev(b: Int): Int = (BITREV_LUT[b and 0xf] shl 4) or BITREV_LUT[(b shr 4) and 0xf]

    private fun maskReg8(reg: Int, value: Int, mask: Int): Int = ((reg and mask.inv()) or (value and mask)) and 0xff
  }

  private val i2cAddr = if (chip == Chip.R828D) R828D_I2C_ADDR else R820T_I2C_ADDR
  private val regs = IntArray(NUM_REGS)
  private val buf = ByteArray(NUM_REGS + 1)

  var xtal = 0L
  private var xtalCapSel = XTAL_HIGH_CAP_0P
  private var intFreq = 0L
  private var filCalCode = 0
  private var hasLock = false
  private var input = 0
  private var initDone = false

  // ---------- I2C + shadow registers ----------

  private fun shadowStore(reg: Int, values: IntArray, offset: Int, length: Int) {
    var r = reg - REG_SHADOW_START
    var off = offset
    var len = length
    if (r < 0) {
      len += r
      off -= r
      r = 0
    }
    if (len <= 0) return
    if (len > NUM_REGS - r) len = NUM_REGS - r
    System.arraycopy(values, off, regs, r, len)
  }

  private fun shadowEqual(reg: Int, values: IntArray, offset: Int, len: Int): Boolean {
    val r = reg - REG_SHADOW_START
    if (r < 0 || len < 0 || len > NUM_REGS - r) return false
    for (i in 0 until len) if (regs[r + i] != values[offset + i]) return false
    return true
  }

  private fun write(startReg: Int, values: IntArray, offset: Int = 0, length: Int = values.size - offset): Int {
    // avoid setting registers unnecessarily since it's slow
    if (shadowEqual(startReg, values, offset, length)) return 0
    shadowStore(startReg, values, offset, length)

    var reg = startReg
    var len = length
    var pos = offset
    do {
      val size = if (len > MAX_I2C_MSG_LEN - 1) MAX_I2C_MSG_LEN - 1 else len
      buf[0] = reg.toByte()
      for (i in 0 until size) buf[1 + i] = values[pos + i].toByte()
      val rc = rtl.i2cWrite(i2cAddr, buf, size + 1)
      if (rc != size + 1) {
        Log.w(TAG, "i2c write failed=$rc reg=${reg.toString(16)} len=$size")
        return if (rc < 0) rc else -1
      }
      reg += size
      len -= size
      pos += size
    } while (len > 0)
    return 0
  }

  private val one = IntArray(1)

  private fun writeReg(reg: Int, value: Int): Int {
    one[0] = value and 0xff
    return write(reg, one, 0, 1)
  }

  private fun readCacheReg(reg: Int): Int {
    val r = reg - REG_SHADOW_START
    return if (r in 0 until NUM_REGS) regs[r] else -1
  }

  private fun writeRegMask(reg: Int, value: Int, bitMask: Int): Int {
    val rc = readCacheReg(reg)
    if (rc < 0) return rc
    return writeReg(reg, (rc and bitMask.inv()) or (value and bitMask))
  }

  private fun read(reg: Int, out: IntArray, len: Int): Int {
    buf[0] = reg.toByte()
    var rc = rtl.i2cWrite(i2cAddr, buf, 1)
    if (rc != 1) {
      Log.w(TAG, "i2c write failed=$rc reg=${reg.toString(16)} len=1")
      return if (rc < 0) rc else -1
    }
    val p = ByteArray(len)
    rc = rtl.i2cRead(i2cAddr, p, len)
    if (rc != len) {
      Log.w(TAG, "i2c read failed=$rc reg=${reg.toString(16)} len=$len")
      return if (rc < 0) rc else -1
    }
    for (i in 0 until len) out[i] = bitrev(p[i].toInt() and 0xff)
    return 0
  }

  // ---------- tuning ----------

  private fun setMux(freqHz: Long): Int {
    val freq = (freqHz / 1_000_000).toInt()
    var i = 0
    while (i < FREQ_RANGES.size - 1) {
      if (freq < FREQ_RANGES[i + 1].freqMhz) break
      i++
    }
    val range = FREQ_RANGES[i]

    // open drain
    var rc = writeRegMask(0x17, range.openD, 0x08)
    if (rc < 0) return rc
    // RF_MUX, polymux
    rc = writeRegMask(0x1a, range.rfMuxPloy, 0xc3)
    if (rc < 0) return rc
    // TF band
    rc = writeReg(0x1b, range.tfC)
    if (rc < 0) return rc

    // xtal cap & drive
    val v = when (xtalCapSel) {
      XTAL_LOW_CAP_30P, XTAL_LOW_CAP_20P -> range.xtalCap20p or 0x08
      XTAL_LOW_CAP_10P -> range.xtalCap10p or 0x08
      XTAL_HIGH_CAP_0P -> range.xtalCap0p or 0x00
      else -> range.xtalCap0p or 0x08
    }
    rc = writeRegMask(0x10, v, 0x0b)
    if (rc < 0) return rc

    rc = writeRegMask(0x08, 0x00, 0x3f)
    if (rc < 0) return rc
    return writeRegMask(0x09, 0x00, 0x3f)
  }

  private fun setPll(freq: Long): Int {
    val vcoMin = 1770000L // kHz
    val vcoMax = vcoMin * 2
    val freqKhz = (freq + 500) / 1000
    val pllRef = xtal
    var mixDiv = 2
    var divNum = 0
    var vcoPowerRef = 2
    val data = IntArray(5)

    // set pll autotune = 128kHz
    var rc = writeRegMask(0x1a, 0x00, 0x0c)
    if (rc < 0) return rc

    // regs 0x10 to 0x16
    val pll = IntArray(7)
    System.arraycopy(regs, 0x10 - REG_SHADOW_START, pll, 0, 7)

    pll[0] = maskReg8(pll[0], 0, 0x10) // refdiv2 = 0
    // set VCO current = 100
    pll[2] = maskReg8(pll[2], 0x80, 0xe0)

    // calculate divider
    while (mixDiv <= 64) {
      if (freqKhz * mixDiv >= vcoMin && freqKhz * mixDiv < vcoMax) {
        var divBuf = mixDiv
        while (divBuf > 2) {
          divBuf = divBuf shr 1
          divNum++
        }
        break
      }
      mixDiv = mixDiv shl 1
    }

    rc = read(0x00, data, 5)
    if (rc < 0) return rc

    if (chip == Chip.R828D || blogV4L) vcoPowerRef = 1

    val vcoFineTune = (data[4] and 0x30) shr 4
    if (vcoFineTune > vcoPowerRef) divNum = (divNum - 1) and 0xff
    else if (vcoFineTune < vcoPowerRef) divNum = (divNum + 1) and 0xff

    pll[0] = maskReg8(pll[0], (divNum shl 5) and 0xff, 0xe0)

    val vcoFreq = freq * mixDiv
    // nint + sdm/65536 approximates vco_freq / (2 * pll_ref), rounded
    val vcoDiv = (pllRef + 65536L * vcoFreq) / (2 * pllRef)
    val nint = ((vcoDiv / 65536) and 0xff).toInt()
    val sdm = (vcoDiv % 65536).toInt()

    if (nint > (128 / vcoPowerRef) - 1) {
      Log.w(TAG, "No valid PLL values for $freq Hz")
      return -1
    }

    val ni = ((nint - 13) / 4) and 0xff
    val si = (nint - 4 * ni - 13) and 0xff
    pll[4] = (ni + (si shl 6)) and 0xff

    // pw_sdm
    pll[2] = maskReg8(pll[2], if (sdm == 0) 0x08 else 0x00, 0x08)
    pll[5] = sdm and 0xff
    pll[6] = (sdm shr 8) and 0xff

    rc = write(0x10, pll)
    if (rc < 0) return rc

    for (i in 0 until 2) {
      // check if PLL has locked
      rc = read(0x00, data, 3)
      if (rc < 0) return rc
      if (data[2] and 0x40 != 0) break
      if (i == 0) {
        // didn't lock: increase VCO current
        rc = writeRegMask(0x12, 0x60, 0xe0)
        if (rc < 0) return rc
      }
    }

    if (data[2] and 0x40 == 0) {
      Log.w(TAG, "PLL not locked")
      hasLock = false
      return 0
    }
    hasLock = true

    // set pll autotune = 8kHz
    return writeRegMask(0x1a, 0x08, 0x08)
  }

  // r82xx_sysfreq_sel for SYS_DVBT, TUNER_DIGITAL_TV (the only mode librtlsdr uses)
  private fun sysfreqSel(): Int {
    val mixerTop = 0x24
    val lnaTop = 0xe5
    val cpCur = 0x38
    val divBufCur = 0x30
    val lnaVthL = 0x53
    val mixerVthL = 0x75
    val airCable1In = 0x00
    val cable2In = 0x00
    val lnaDischarge = 14
    val filterCur = 0x40

    var rc = writeRegMask(0x1d, lnaTop, 0xc7)
    if (rc < 0) return rc
    rc = writeRegMask(0x1c, mixerTop, 0xf8)
    if (rc < 0) return rc
    rc = writeReg(0x0d, lnaVthL)
    if (rc < 0) return rc
    rc = writeReg(0x0e, mixerVthL)
    if (rc < 0) return rc

    input = airCable1In

    // air-in only for Astrometa
    rc = writeRegMask(0x05, airCable1In, 0x60)
    if (rc < 0) return rc
    rc = writeRegMask(0x06, cable2In, 0x08)
    if (rc < 0) return rc

    rc = writeRegMask(0x11, cpCur, 0x38)
    if (rc < 0) return rc
    rc = writeRegMask(0x17, divBufCur, 0x30)
    if (rc < 0) return rc
    rc = writeRegMask(0x0a, filterCur, 0x60)
    if (rc < 0) return rc

    // set LNA (not analog TV)
    // LNA TOP: lowest
    rc = writeRegMask(0x1d, 0, 0x38)
    if (rc < 0) return rc
    // 0: normal mode
    rc = writeRegMask(0x1c, 0, 0x04)
    if (rc < 0) return rc
    // 0: PRE_DECT off
    rc = writeRegMask(0x06, 0, 0x40)
    if (rc < 0) return rc
    // agc clk 250hz
    rc = writeRegMask(0x1a, 0x30, 0x30)
    if (rc < 0) return rc
    // write LNA TOP = 3
    rc = writeRegMask(0x1d, 0x18, 0x38)
    if (rc < 0) return rc
    // write discharge mode (the mask matches the original driver)
    rc = writeRegMask(0x1c, mixerTop, 0x04)
    if (rc < 0) return rc
    // LNA discharge current
    rc = writeRegMask(0x1e, lnaDischarge, 0x1f)
    if (rc < 0) return rc
    // agc clk 60hz
    return writeRegMask(0x1a, 0x20, 0x30)
  }

  // r82xx_set_tv_standard(bw = 3, TUNER_DIGITAL_TV, 0): filter calibration
  private fun setTvStandard(): Int {
    val ifKhz = 3570L
    val filtCalLo = 56000L
    val filtGain = 0x10
    val imgR = 0x00
    val filtQ = 0x10
    val hpCor = 0x6b
    val extEnable = 0x60
    val loopThrough = 0x01
    val ltAtt = 0x00
    val fltExtWidest = 0x00
    val polyfilCur = 0x60
    val data = IntArray(5)

    // initialize the shadow registers
    System.arraycopy(INIT_ARRAY, 0, regs, 0, NUM_REGS)

    // init flag & xtal_check result
    var rc = writeRegMask(0x0c, 0x00, 0x0f)
    if (rc < 0) return rc
    // version
    rc = writeRegMask(0x13, VER_NUM, 0x3f)
    if (rc < 0) return rc
    // for LT gain test
    rc = writeRegMask(0x1d, 0x00, 0x38)
    if (rc < 0) return rc

    intFreq = ifKhz * 1000

    for (i in 0 until 2) {
      // set filt_cap
      rc = writeRegMask(0x0b, hpCor, 0x60)
      if (rc < 0) return rc
      // set cali clk = on
      rc = writeRegMask(0x0f, 0x04, 0x04)
      if (rc < 0) return rc
      // xtal cap 0pF for PLL
      rc = writeRegMask(0x10, 0x00, 0x03)
      if (rc < 0) return rc

      rc = setPll(filtCalLo * 1000)
      if (rc < 0 || !hasLock) return rc

      // start trigger
      rc = writeRegMask(0x0b, 0x10, 0x10)
      if (rc < 0) return rc
      // stop trigger
      rc = writeRegMask(0x0b, 0x00, 0x10)
      if (rc < 0) return rc
      // set cali clk = off
      rc = writeRegMask(0x0f, 0x00, 0x04)
      if (rc < 0) return rc

      // check if calibration worked
      rc = read(0x00, data, 5)
      if (rc < 0) return rc
      filCalCode = data[4] and 0x0f
      if (filCalCode != 0 && filCalCode != 0x0f) break
    }
    // narrowest
    if (filCalCode == 0x0f) filCalCode = 0

    rc = writeRegMask(0x0a, filtQ or filCalCode, 0x1f)
    if (rc < 0) return rc
    // set BW, filter gain & HP corner
    rc = writeRegMask(0x0b, hpCor, 0xef)
    if (rc < 0) return rc
    // set img_r
    rc = writeRegMask(0x07, imgR, 0x80)
    if (rc < 0) return rc
    // set filt_3dB, V6MHz
    rc = writeRegMask(0x06, filtGain, 0x30)
    if (rc < 0) return rc
    // channel filter extension
    rc = writeRegMask(0x1e, extEnable, 0x60)
    if (rc < 0) return rc
    // loop through
    rc = writeRegMask(0x05, loopThrough, 0x80)
    if (rc < 0) return rc
    // loop through attenuation
    rc = writeRegMask(0x1f, ltAtt, 0x80)
    if (rc < 0) return rc
    // filter extension widest
    rc = writeRegMask(0x0f, fltExtWidest, 0x80)
    if (rc < 0) return rc
    // RF poly filter current
    return writeRegMask(0x19, polyfilCur, 0x60)
  }

  /** Gain in tenths of a dB when [manual]; otherwise LNA and mixer go back to automatic. */
  fun setGain(manual: Boolean, gain: Int): Int {
    var rc: Int
    if (manual) {
      var totalGain = 0
      var mixIndex = 0
      var lnaIndex = 0
      val data = IntArray(4)

      // LNA auto off
      rc = writeRegMask(0x05, 0x10, 0x10)
      if (rc < 0) return rc
      // mixer auto off
      rc = writeRegMask(0x07, 0, 0x10)
      if (rc < 0) return rc
      rc = read(0x00, data, 4)
      if (rc < 0) return rc
      // set fixed VGA gain for now (16.3 dB)
      rc = writeRegMask(0x0c, 0x08, 0x9f)
      if (rc < 0) return rc

      for (i in 0 until 15) {
        if (totalGain >= gain) break
        totalGain += LNA_GAIN_STEPS[++lnaIndex]
        if (totalGain >= gain) break
        totalGain += MIXER_GAIN_STEPS[++mixIndex]
      }

      // set LNA gain
      rc = writeRegMask(0x05, lnaIndex, 0x0f)
      if (rc < 0) return rc
      // set mixer gain
      return writeRegMask(0x07, mixIndex, 0x0f)
    }
    // LNA
    rc = writeRegMask(0x05, 0, 0x10)
    if (rc < 0) return rc
    // mixer
    rc = writeRegMask(0x07, 0x10, 0x10)
    if (rc < 0) return rc
    // set fixed VGA gain for now (26.5 dB)
    return writeRegMask(0x0c, 0x0b, 0x9f)
  }

  /** Sets the IF filter for [bandwidth] Hz and returns the resulting IF frequency. */
  fun setBandwidth(bandwidth: Int): Int {
    var bw = bandwidth
    var realBw = 0
    val reg0a: Int
    var reg0b: Int

    if (bw > 7000000) {
      // BW: 8 MHz
      reg0a = 0x10
      reg0b = 0x0b
      intFreq = 4570000
    } else if (bw > 6000000) {
      // BW: 7 MHz
      reg0a = 0x10
      reg0b = 0x2a
      intFreq = 4570000
    } else if (bw > IF_LOW_PASS_BW_TABLE[0] + FILT_HP_BW1 + FILT_HP_BW2) {
      // BW: 6 MHz
      reg0a = 0x10
      reg0b = 0x6b
      intFreq = 3570000
    } else {
      reg0a = 0x00
      reg0b = 0x80
      intFreq = 2300000

      if (bw > IF_LOW_PASS_BW_TABLE[0] + FILT_HP_BW1) {
        bw -= FILT_HP_BW2
        intFreq += FILT_HP_BW2
        realBw += FILT_HP_BW2
      } else {
        reg0b = reg0b or 0x20
      }

      if (bw > IF_LOW_PASS_BW_TABLE[0]) {
        bw -= FILT_HP_BW1
        intFreq += FILT_HP_BW1
        realBw += FILT_HP_BW1
      } else {
        reg0b = reg0b or 0x40
      }

      // find the low-pass filter
      var i = 0
      while (i < IF_LOW_PASS_BW_TABLE.size) {
        if (bw > IF_LOW_PASS_BW_TABLE[i]) break
        i++
      }
      --i
      reg0b = reg0b or (15 - i)
      realBw += IF_LOW_PASS_BW_TABLE[i]

      intFreq -= realBw / 2
    }

    var rc = writeRegMask(0x0a, reg0a, 0x10)
    if (rc < 0) return rc
    rc = writeRegMask(0x0b, reg0b, 0xef)
    if (rc < 0) return rc
    return intFreq.toInt()
  }

  fun setFreq(freq: Long): Int {
    // the RTL-SDR Blog V4 upconverts HF by 28.8 MHz in hardware
    val upconvertFreq = if ((blogV4 || blogV4L) && freq < 28_800_000L) freq + 28_800_000L else freq
    val loFreq = upconvertFreq + intFreq

    var rc = setMux(loFreq)
    if (rc < 0) return fail(rc)
    rc = setPll(loFreq)
    if (rc < 0 || !hasLock) return fail(if (rc < 0) rc else -1)

    if (blogV4) {
      // notch filters are off when tuned inside the notch bands and on outside them
      val openD = if (freq <= 2_200_000L || (freq in 85_000_000L..112_000_000L) || (freq in 172_000_000L..242_000_000L)) 0x00 else 0x08
      rc = writeRegMask(0x17, openD, 0x08)
      if (rc < 0) return rc

      val band = if (freq <= 28_800_000L) HF else if (freq < 250_000_000L) VHF else UHF

      // bypass the tracking filter for HF (the upconverter path doesn't benefit from it)
      if (band == HF) {
        rc = writeRegMask(0x1a, 0x40, 0xc3)
        if (rc < 0) return fail(rc)
        rc = writeReg(0x1b, 0x00)
        if (rc < 0) return fail(rc)
      }

      // switch between tuner inputs
      if (band != input) {
        input = band
        // cable 2 (HF input)
        val cable2In = if (band == HF) 0x08 else 0x00
        rc = writeRegMask(0x06, cable2In, 0x08)
        if (rc < 0) return fail(rc)
        // upconverter GPIO switch on newer batches
        rtl.setBiasTeeGpio(5, cable2In == 0)
        // cable 1 (VHF input)
        rc = writeRegMask(0x05, if (band == VHF) 0x40 else 0x00, 0x40)
        if (rc < 0) return fail(rc)
        // air_in (UHF input)
        rc = writeRegMask(0x05, if (band == UHF) 0x00 else 0x20, 0x20)
        if (rc < 0) return fail(rc)
      }
    } else if (blogV4L) {
      val band = if (freq <= 28_800_000L) HF else UHF
      if (band == HF) {
        rc = writeRegMask(0x1a, 0x40, 0xc3)
        if (rc < 0) return fail(rc)
        rc = writeReg(0x1b, 0x00)
        if (rc < 0) return fail(rc)
      }
      if (band != input) {
        input = band
        val cable1In = if (band == HF) 0x40 else 0x00
        rtl.setBiasTeeGpio(5, cable1In == 0)
        rc = writeRegMask(0x05, cable1In, 0x40)
        if (rc < 0) return fail(rc)
        rc = writeRegMask(0x05, if (band == UHF) 0x00 else 0x20, 0x20)
        if (rc < 0) return fail(rc)
      }
    } else {
      // standard R828D: switch between 'Cable1' and 'Air-In' at 345 MHz
      val airCable1In = if (freq > 345_000_000L) 0x00 else 0x60
      if (chip == Chip.R828D && airCable1In != input) {
        input = airCable1In
        rc = writeRegMask(0x05, airCable1In, 0x60)
      }
    }
    return if (rc < 0) fail(rc) else 0
  }

  private fun fail(rc: Int): Int {
    Log.w(TAG, "setFreq failed=$rc")
    return rc
  }

  fun standby(): Int {
    // if the device was not initialized yet, no need to standby
    if (!initDone) return 0
    var rc = writeReg(0x06, 0xb1)
    if (rc < 0) return rc
    rc = writeReg(0x05, 0xa0)
    if (rc < 0) return rc
    rc = writeReg(0x07, 0x3a)
    if (rc < 0) return rc
    rc = writeReg(0x08, 0x40)
    if (rc < 0) return rc
    rc = writeReg(0x09, 0xc0)
    if (rc < 0) return rc
    rc = writeReg(0x0a, 0x36)
    if (rc < 0) return rc
    rc = writeReg(0x0c, 0x35)
    if (rc < 0) return rc
    rc = writeReg(0x0f, 0x68)
    if (rc < 0) return rc
    rc = writeReg(0x11, 0x03)
    if (rc < 0) return rc
    rc = writeReg(0x17, 0xf4)
    if (rc < 0) return rc
    return writeReg(0x19, 0x0c)
  }

  fun init(xtalHz: Long): Int {
    xtal = xtalHz
    xtalCapSel = XTAL_HIGH_CAP_0P

    // initialize registers
    regs.fill(0)
    write(0x05, INIT_ARRAY)

    var rc = setTvStandard()
    if (rc < 0) return rc
    rc = sysfreqSel()
    initDone = true
    return rc
  }
}
