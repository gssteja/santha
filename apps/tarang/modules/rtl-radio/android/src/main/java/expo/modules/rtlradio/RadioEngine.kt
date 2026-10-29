package expo.modules.rtlradio

import android.content.Context
import android.content.SharedPreferences
import android.hardware.usb.UsbManager
import android.os.Process
import android.os.SystemClock
import android.util.Log
import expo.modules.rtlradio.dsp.AcarsMessageDecoder
import expo.modules.rtlradio.dsp.AdsbDecoder
import expo.modules.rtlradio.dsp.AprsPacketDecoder
import expo.modules.rtlradio.dsp.Dsp
import expo.modules.rtlradio.dsp.Plane
import expo.modules.rtlradio.dsp.RdsInfo
import expo.modules.rtlradio.dsp.SensorDecoder
import expo.modules.rtlradio.dsp.WeatherAlertDecoder
import expo.modules.rtlradio.usb.RtlSdr
import expo.modules.rtlradio.usb.RtlSdrException
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The radio: owns the dongle, the DSP and the audio output on one thread, and runs listening (one or two
 * channels), scanning, the FM station survey and the band activity sweep. A port of the Mac radio panel's
 * Radio class (server.py). The same thread can instead track planes (ADS-B at 1090 MHz, the Mac's dump1090),
 * decode wireless sensors (rtl_433's decoders, hopping 433.92 / 315 / 915 MHz), watch NOAA Weather Radio for
 * alerts (SAME), receive APRS (144.39 MHz) or ACARS (four channels around 131 MHz), or follow a P25 trunked system
 * (control channel, voice grants, Phase 1 / Phase 2 voice: [P25Mode]): see [appMode].
 *
 * Commands arrive from JS as maps and are applied on the radio thread between blocks. State goes back to JS
 * a few times a second through [stateListener]; the spectrum goes straight to native views through
 * [addSpectrumListener], so the high-rate data never crosses the JS bridge.
 */
object RadioEngine {
  private const val TAG = "RadioEngine"

  const val FS = 2_400_000
  private const val OFFSET = 200_000L           // listen this far above the hardware centre, away from the DC spike
  private const val BLOCK = 153_600             // samples per listening block (64 ms)
  private const val SCAN_BLOCK = 65_536         // samples measured per scan window (27 ms)
  private const val FLUSH = 24_576              // samples thrown away after a hardware retune (10 ms)
  private const val SCAN_HALF_SPAN = 900_000L   // channels within this distance of a window's centre are measured together
  private const val USABLE_HALF_SPAN = 1_000_000L // the clean part of the 2.4 MHz view (the dongle's filter rolls off at the edges)
  private const val DC_GUARD = 60_000L          // keep listening channels this far from the DC spike
  private const val B_MAX_SPAN = 1_700_000L     // channel B must be within this distance of A (both fit in the view)
  private const val DIRECT_SAMPLING_BELOW = 24_000_000L // the R820T can't tune lower; the v5 samples HF directly (Q branch)
  private const val SWEEP_STEP = 25_000L        // band survey resolution
  private const val LISTEN_PSD_FRAMES = 16
  private const val SCAN_PSD_FRAMES = 32
  private const val DEFAULT_SQUELCH = 8.0
  private const val LINGER_MS = 3000L           // a scan stays on a channel this long after it goes quiet
  private const val NO_DONGLE_STOP_MS = 30_000L // give up (and stop the service) if the dongle stays away this long
  private const val STATE_INTERVAL_MS = 250L
  private const val FFT_N = 2048
  private const val ADSB_FREQ = 1_090_000_000L
  private const val SENSOR_FS = 1_000_000       // rtl_433's rate when 915 MHz is in the hop list
  private const val SENSOR_BLOCK = 100_000      // 100 ms
  private const val HOP_MS = 40_000L            // like the Mac's rtl_433 -H 40
  private val SENSOR_SKIP = setOf(
    "time", "model", "id", "channel", "mic", "mod", "freq", "freq1", "freq2", "rssi", "snr", "noise", "protocol", "subtype",
    "raw_msg", "rows", "codes", "len", "data",
  )
  private const val MAX_TRAIL = 400
  private val NOAA = longArrayOf(162_400_000L, 162_425_000L, 162_450_000L, 162_475_000L, 162_500_000L, 162_525_000L, 162_550_000L)
  private const val WX_CENTER = 162_225_000L    // all seven NOAA channels sit 175-325 kHz above: clear of the DC spike
  private const val WX_BW = 16_000
  private const val ALERT_AUDIO_MS = 4 * 60_000L // play the voice message this long after a local alert (or until NNNN)
  private const val APRS_FREQ = 144_390_000L    // North America; the region can change it
  private val ACARS_CHANNELS = longArrayOf(130_025_000L, 130_450_000L, 131_125_000L, 131_550_000L) // the busy US ones
  private val DECODE_MODES = setOf("weather", "aprs", "acars", "p25")
  private const val P25_BLOCK = 76_800          // 32 ms: grants get acted on sooner than with listening's 64 ms

  val DEFAULT_BW = mapOf("AM" to 8000, "NFM" to 12500, "WFM" to 200000, "USB" to 2800, "LSB" to 2800, "CW" to 500)

  private val HAM_LSB = listOf(1_800_000L to 2_000_000L, 3_500_000L to 4_000_000L, 7_000_000L to 7_300_000L) // LSB below 10 MHz
  private val HAM_USB = listOf(
    14_000_000L to 14_350_000L, 18_068_000L to 18_168_000L, 21_000_000L to 21_450_000L, 24_890_000L to 24_990_000L, 28_000_000L to 29_700_000L,
  )

  /** The usual modulation for a frequency, so tuning around picks a sensible mode. */
  fun bandMode(f: Long): String? = when {
    HAM_LSB.any { f >= it.first && f < it.second } -> "LSB"
    HAM_USB.any { f >= it.first && f < it.second } -> "USB"
    f < 30_000_000L -> "AM" // AM broadcast, shortwave, time stations, CB
    f in 88_000_000L until 108_000_000L -> "WFM"
    f in 108_000_000L until 137_000_000L -> "AM"
    f in 144_000_000L until 174_000_000L || f in 400_000_000L until 470_000_000L -> "NFM"
    else -> null
  }

  class Channel(val f: Long, val label: String, val mode: String, val bw: Int)
  private class Window(val center: Long, val channels: List<Channel>)
  private class Found(val ch: Channel, val snr: Double)
  private class Tune(val f: Long, val mode: String, val bw: Int, val label: String)
  private class Scan(
    var state: String, val group: String, val name: String, val windows: List<Window>, val threshold: Double, val prev: Tune,
  ) {
    var idx = 0
    var lastActive = 0L
    val lockout = HashSet<Long>()
    val found = ArrayList<Found>()
    // sweep
    var start = 0L
    var stop = 0L
    var bins = FloatArray(0)
  }

  /** Second channel, played alongside A when both fit in the view. */
  private class VfoB(val freq: Long, val mode: String, val bw: Int, var squelch: Double) {
    var snr = 0.0
    var open = false
    var inView = false
    var label = ""
  }

  class SpectrumFrame {
    val bins = FloatArray(FFT_N / 2) // dB, max of each pair of FFT bins
    var center = 0L
    var rate = FS
    var listenFreq = 0L
    var bw = 0
    var bFreq = 0L // 0 when there's no channel B in view
    var bBw = 0
    var scanning = false
    var noiseDb = 0f
  }

  /** Last band sweep, for the native sweep chart: SNR in dB per SWEEP_STEP bin from [start]. */
  class SweepData(val start: Long, val step: Long, val bins: FloatArray, val done: Boolean)

  /** Once a second while tracking planes, for the native map: aircraft, their trails (lat, lon, alt triplets). */
  class PlanesFrame(val planes: List<Plane>, val trails: Map<Int, FloatArray>, val rxLat: Double?, val rxLon: Double?)

  private class Trail {
    var pts = FloatArray(96)
    var n = 0

    fun add(lat: Double, lon: Double, alt: Int) {
      if (n > 0) {
        val dLat = lat - pts[n * 3 - 3]
        val dLon = (lon - pts[n * 3 - 2]) * cos(Math.toRadians(lat))
        if (dLat * dLat + dLon * dLon < 1e-6) return // closer than ~110 m to the last point
      }
      if (n >= MAX_TRAIL) {
        System.arraycopy(pts, 3, pts, 0, (n - 1) * 3)
        n--
      } else if ((n + 1) * 3 > pts.size) {
        pts = pts.copyOf(pts.size * 2)
      }
      pts[n * 3] = lat.toFloat()
      pts[n * 3 + 1] = lon.toFloat()
      pts[n * 3 + 2] = alt.toFloat()
      n++
    }

    fun copy(): FloatArray = pts.copyOf(n * 3)
  }

  // ---------- settings (persisted) ----------
  @Volatile var freq = 104_700_000L
    private set
  @Volatile var mode = "WFM"
    private set
  @Volatile var bw = 200_000
    private set
  @Volatile private var squelch = 0.0
  @Volatile private var gain: Double? = 40.2
  @Volatile private var ppm = 0
  @Volatile private var stereo = true
  @Volatile private var nr = false
  @Volatile private var favorites: List<JSONObject> = emptyList()
  @Volatile var label = ""
    private set
  @Volatile var rxLat: Double? = null // the phone's location, for the plane map and local position decoding
    private set
  @Volatile var rxLon: Double? = null
    private set

  /** rtl_433's hop list; the region sets it (US: 433.92 / 315 / 915 MHz). See [setRegion]. */
  @Volatile var sensorBands: LongArray = longArrayOf(433_920_000L, 315_000_000L, 915_000_000L)
    private set
  @Volatile private var deemphUs = 75.0 // FM de-emphasis: 75 us in the Americas, 50 us elsewhere
  @Volatile private var aprsFreq = APRS_FREQ
  @Volatile private var acarsChannels = ACARS_CHANNELS
  @Volatile private var acarsCenter = acarsCentre(ACARS_CHANNELS)
  @Volatile private var noaaAvailable = true // NOAA Weather Radio is US / Canada only

  /**
   * What the dongle is for: "radio" (listen/scan), "planes" (ADS-B), "sensors" (rtl_433), "weather" (NOAA SAME
   * alerts), "aprs", "acars" or "p25" (trunked radio). Follows the open tab.
   */
  @Volatile var appMode = "radio"
    private set

  // ---------- runtime state ----------
  @Volatile private var running = false
  @Volatile private var stopping = false
  @Volatile private var status = "off" // off | starting | radio | error
  @Volatile private var error = ""
  @Volatile private var needsPermission = false
  @Volatile private var deviceName = ""
  @Volatile private var gains: List<Double> = emptyList()
  private var dev: RtlSdr? = null
  @Volatile private var lostMessage: String? = null
  private var hwCenter: Long? = null
  private var demodDirty = true
  private var stationDirty = false
  private var demodBDirty = true
  @Volatile private var vfoB: VfoB? = null
  @Volatile private var snr = 0.0
  @Volatile private var noiseDb = 0.0
  @Volatile private var squelchOpen = false
  @Volatile private var stereoActive = false
  @Volatile private var rds: RdsInfo? = null
  @Volatile private var directSampling = false
  private var scan: Scan? = null
  @Volatile var sweepData: SweepData? = null
    private set
  private var sweepResult: Map<String, Any?>? = null
  private val sweepListeners = CopyOnWriteArrayList<() -> Unit>()
  private var recorder: Recorder? = null
  private var recordingsCache: List<Map<String, Any?>>? = null
  private val hits = ArrayDeque<Map<String, Any?>>()
  private val survey = HashMap<String, Map<String, Any?>>()
  private val rdsNames = HashMap<String, String>()
  private var listsVersion = 0
  private var sentListsVersion = -1
  private var blocks = 0L
  private var workNs = 0L
  private var lastEmit = 0L
  private var noDongleSince = 0L

  // ---------- planes + sensors ----------
  private var hwMode = "radio" // what the dongle is currently set up for
  private var hwRate = FS
  private var adsb: AdsbDecoder? = null
  private var rxDirty = true
  @Volatile var planesFrame: PlanesFrame? = null
    private set
  private val planesListeners = CopyOnWriteArrayList<() -> Unit>()
  private val trails = HashMap<Int, Trail>()
  private var lastPlanesMs = 0L
  private var adsbMessages = 0L
  private var planesInfo: Map<String, Any?>? = null
  private var planesVersion = 0
  private var sentPlanesVersion = -1
  private var sensorDec: SensorDecoder? = null
  private var sensorDecoders = 0
  private val sensorDevices = HashMap<String, HashMap<String, Any?>>() // guarded by itself: JS reads it too
  private var sensorMessages = 0
  private var hopIdx = 0
  private var hopAt = 0L
  private var sensorsVersion = 0
  private var sentSensorsVersion = -1

  // ---------- weather alerts, APRS, ACARS (lists guarded by decodeLock: JS reads them too) ----------
  private val decodeLock = Any()
  private var decodeCfg = "" // what channel A is set up for in a decode mode
  @Volatile private var decodeListen = false // play the decoded channel's audio
  private var decodeVersion = 0
  private var sentDecodeVersion = -1
  private var sentP25Version = -1
  private var sentP25DirVersion = -1
  private var lastDecodeTick = 0L
  private var wxDec: WeatherAlertDecoder? = null
  private var wxFreq = 162_550_000L
  private var wxPickAt = 0L
  private val wxSnr = DoubleArray(NOAA.size)
  private val wxAlerts = ArrayDeque<Map<String, Any?>>() // newest first
  private var wxTone = false
  private var wxAudioUntil = 0L
  @Volatile private var wxCounty: String? = null // FIPS SSCCC
  private var wxCountyManual = false
  private var aprsDec: AprsPacketDecoder? = null
  private val aprsStations = HashMap<String, HashMap<String, Any?>>()
  private val aprsLog = ArrayDeque<Map<String, Any?>>() // messages and status reports, newest first
  private var aprsPackets = 0
  private var acarsDec: AcarsMessageDecoder? = null
  private val acarsMsgs = ArrayDeque<Map<String, Any?>>() // newest first
  private var acarsCount = 0

  private val lock = Any()
  private val cmds = ConcurrentLinkedQueue<Map<String, Any?>>()
  private var thread: Thread? = null
  private var appContext: Context? = null
  private var prefs: SharedPreferences? = null
  private val ring = IqRing(FS * 2) // 1 s of samples
  private val spectrum = SpectrumFrame()
  private val spectrumListeners = CopyOnWriteArrayList<(SpectrumFrame) -> Unit>()
  private val scratch = FloatArray(FFT_N)
  private val lastPsd = FloatArray(FFT_N)
  private var lastPsdCenter = 0L

  @Volatile var stateListener: ((Map<String, Any?>) -> Unit)? = null
    set(value) {
      field = value
      sentListsVersion = -1
      sentPlanesVersion = -1
      sentSensorsVersion = -1
      sentDecodeVersion = -1
      sentP25Version = -1
      sentP25DirVersion = -1
    }

  /** Called with a short "now playing" line whenever it changes (for the notification). */
  @Volatile var nowPlayingListener: ((String) -> Unit)? = null
  /** Called when the radio gives up on its own (dongle gone for a while), so the service can stop. */
  @Volatile var stoppedListener: (() -> Unit)? = null
  private var lastNowPlaying = ""

  fun addSpectrumListener(l: (SpectrumFrame) -> Unit) = spectrumListeners.add(l)

  fun removeSpectrumListener(l: (SpectrumFrame) -> Unit) = spectrumListeners.remove(l)

  fun addSweepListener(l: () -> Unit) = sweepListeners.add(l)

  fun addPlanesListener(l: () -> Unit) = planesListeners.add(l)

  fun removePlanesListener(l: () -> Unit) = planesListeners.remove(l)

  fun removeSweepListener(l: () -> Unit) = sweepListeners.remove(l)

  val isRunning: Boolean get() = running

  // ---------- settings ----------

  fun init(context: Context) = synchronized(lock) {
    if (appContext != null) return
    appContext = context.applicationContext
    val p = context.getSharedPreferences("tarang_radio", Context.MODE_PRIVATE)
    prefs = p
    freq = p.getLong("freq", freq)
    mode = p.getString("mode", mode) ?: mode
    bw = p.getInt("bw", bw)
    squelch = p.getFloat("squelch", 0f).toDouble()
    val g = p.getFloat("gain", 40.2f)
    gain = if (g < 0) null else g.toDouble()
    ppm = p.getInt("ppm", 0)
    stereo = p.getBoolean("stereo", true)
    nr = p.getBoolean("nr", false)
    favorites = try {
      val arr = JSONArray(p.getString("favorites", "[]"))
      (0 until arr.length()).map { arr.getJSONObject(it) }
    } catch (e: Exception) {
      emptyList()
    }
    label = p.getString("label", "") ?: ""
    wxCounty = p.getString("wx_county", null)
    wxCountyManual = p.getBoolean("wx_county_manual", false)
    if (p.contains("rx_lat")) {
      rxLat = p.getString("rx_lat", null)?.toDoubleOrNull()
      rxLon = p.getString("rx_lon", null)?.toDoubleOrNull()
    }
    // a location saved before the weather alerts existed still tells us the county
    val la = rxLat
    val lo = rxLon
    if (wxCounty == null && la != null && lo != null) wxCounty = Counties.nearest(context, la, lo)?.fips
    P25Mode.init(context)
  }

  private fun saveSettings() {
    val p = prefs ?: return
    p.edit()
      .putLong("freq", freq)
      .putString("mode", mode)
      .putInt("bw", bw)
      .putFloat("squelch", squelch.toFloat())
      .putFloat("gain", gain?.toFloat() ?: -1f)
      .putInt("ppm", ppm)
      .putBoolean("stereo", stereo)
      .putBoolean("nr", nr)
      .putString("favorites", JSONArray(favorites).toString())
      .putString("label", label)
      .putString("rx_lat", rxLat?.toString())
      .putString("rx_lon", rxLon?.toString())
      .putString("wx_county", wxCounty)
      .putBoolean("wx_county_manual", wxCountyManual)
      .apply()
  }

  private fun labelFor(f: Long): String =
    favorites.firstOrNull { abs(it.optLong("f") - f) < 1000 }?.optString("label") ?: ""

  // ---------- lifecycle ----------

  fun start(context: Context) = synchronized(lock) {
    init(context)
    // a stop still winding down (service restarted quickly): let it finish first
    thread?.let { if (stopping) it.join(4000) }
    if (thread?.isAlive == true) return
    cmds.clear()
    stopping = false
    running = true
    status = "starting"
    error = ""
    noDongleSince = 0
    thread = Thread({ run() }, "radio").also { it.start() }
  }

  fun stop() {
    val t = synchronized(lock) {
      stopping = true
      thread
    }
    ring.wake()
    t?.join(4000)
    synchronized(lock) {
      thread = null
      running = false
      status = "off"
      error = ""
      snr = 0.0
      squelchOpen = false
      rds = null
      scan = null
      planesFrame = null
      planesInfo = null
      trails.clear()
      planesVersion++
    }
    for (l in planesListeners) l()
    emitState(force = true)
  }

  private fun run() {
    try {
      Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    } catch (_: Exception) {
      Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
    }
    val ctx = appContext!!
    val dsp = Dsp()
    dsp.setDeemphasis(deemphUs)
    val audio = AudioOut(ctx)
    audio.start()
    try {
      while (!stopping) {
        drainCmds(dsp)
        if (dev == null && !openDevice(ctx)) {
          if (noDongleSince == 0L) noDongleSince = SystemClock.elapsedRealtime()
          // waiting for the user to tap Allow on the USB dialog gets longer than a missing dongle
          val limit = if (needsPermission) 4 * NO_DONGLE_STOP_MS else NO_DONGLE_STOP_MS
          if (SystemClock.elapsedRealtime() - noDongleSince > limit) {
            Log.i(TAG, "no usable dongle for ${limit / 1000} s - stopping")
            stoppedListener?.invoke()
            break
          }
          emitState()
          sleepQuietly(1000)
          continue
        }
        noDongleSince = 0
        try {
          if (appMode != hwMode) switchHw(appMode)
          val sc = scan
          when {
            hwMode == "planes" -> planesBlock(dsp)
            hwMode == "sensors" -> sensorsBlock(dsp)
            hwMode == "weather" -> weatherBlock(dsp, audio)
            hwMode == "aprs" -> aprsBlock(dsp, audio)
            hwMode == "acars" -> acarsBlock(dsp)
            hwMode == "p25" -> p25Block(dsp, audio)
            sc?.state == "search" || sc?.state == "survey" -> scanStep(dsp, sc)
            sc?.state == "sweep" -> sweepStep(dsp, sc)
            else -> listenBlock(dsp, audio)
          }
        } catch (e: RtlSdrException) {
          if (stopping) break
          fail(e.message ?: "USB error")
          closeDevice()
          sleepQuietly(1000)
        }
        emitState()
      }
    } catch (e: Exception) {
      Log.e(TAG, "radio thread crashed", e)
      fail("Radio error: ${e.message}")
    } finally {
      stopRecording()
      closeDevice()
      audio.release()
      dsp.release()
      adsb?.release()
      adsb = null
      sensorDec?.release()
      sensorDec = null
      wxDec?.release()
      wxDec = null
      aprsDec?.release()
      aprsDec = null
      acarsDec?.release()
      acarsDec = null
      P25Mode.release()
    }
  }

  private fun sleepQuietly(ms: Long) {
    try {
      Thread.sleep(ms)
    } catch (_: InterruptedException) {
    }
  }

  private fun fail(msg: String) {
    if (msg != error) Log.w(TAG, "ERROR: $msg")
    status = "error"
    error = msg
  }

  private fun openDevice(ctx: Context): Boolean {
    val mgr = ctx.getSystemService(Context.USB_SERVICE) as UsbManager
    val device = mgr.deviceList.values.firstOrNull { RtlSdr.isSupported(it) }
    if (device == null) {
      needsPermission = false
      fail("No RTL-SDR found - plug the dongle into the USB-C port")
      return false
    }
    if (!mgr.hasPermission(device)) {
      needsPermission = true
      fail("Tap Start to allow USB access to the dongle")
      return false
    }
    needsPermission = false
    val d = try {
      RtlSdr.open(mgr, device)
    } catch (e: Exception) {
      fail(e.message ?: "Couldn't open the dongle")
      return false
    }
    try {
      d.setAgcMode(false)
      d.setSampleRate(FS)
      d.setFreqCorrection(ppm)
      gains = d.gains()
      gain?.let { g -> gain = gains.minByOrNull { abs(it - g) } }
      d.setGain(gain)
      ring.discard()
      lostMessage = null
      startStreaming(d)
    } catch (e: Exception) {
      d.close()
      fail(e.message ?: "Couldn't start the dongle")
      return false
    }
    dev = d
    directSampling = false
    hwMode = "radio"
    hwRate = FS
    deviceName = listOf(device.manufacturerName, device.productName).filterNotNull().joinToString(" ").ifBlank { "RTL-SDR" } +
      " · ${d.tunerName}"
    hwCenter = null
    demodDirty = true
    demodBDirty = true
    status = "radio"
    error = ""
    return true
  }

  private fun startStreaming(d: RtlSdr) {
    d.startStreaming(
      onData = { b, n -> ring.write(b, n) },
      onLost = { msg ->
        lostMessage = msg
        ring.wake()
      },
    )
  }

  /** Reprogramming the sample-rate registers stalls a running stream, so these changes stop and restart it. */
  private fun withStreamStopped(d: RtlSdr, change: () -> Unit) {
    d.stopStreaming()
    change()
    ring.discard()
    startStreaming(d)
    hwCenter = null
  }

  private fun closeDevice() {
    val d = dev ?: return
    dev = null
    try {
      d.close()
    } catch (e: Exception) {
      Log.w(TAG, "close failed: ${e.message}")
    }
    hwCenter = null
  }

  /** Next [n] samples into dsp.iq, or throws if the dongle stopped delivering. */
  private fun readBlock(dsp: Dsp, n: Int) {
    if (!ring.read(dsp.iq, n * 2, 2000)) {
      if (stopping) throw RtlSdrException("stopping")
      throw RtlSdrException(lostMessage?.let { "Lost the dongle ($it) - reconnecting..." } ?: "No samples for 2 s - reconnecting...")
    }
    lostMessage?.let { throw RtlSdrException("Lost the dongle ($it) - reconnecting...") }
  }

  private fun tuneHw(dsp: Dsp, center: Long) {
    val d = dev ?: return
    if (hwCenter == center) return
    val wantDs = center < DIRECT_SAMPLING_BELOW
    if (wantDs != directSampling) {
      withStreamStopped(d) { d.setDirectSampling(if (wantDs) 2 else 0) }
      directSampling = wantDs
    }
    var ok = false
    for (i in 0 until 10) {
      if (d.setCenterFreq(center)) {
        ok = true
        break
      }
    }
    if (!ok) fail("Can't tune to %.3f MHz".format(center / 1e6)) else if (status == "error") {
      status = "radio"
      error = ""
    }
    hwCenter = center
    demodDirty = true
    demodBDirty = true
    ring.discard()
    readBlock(dsp, FLUSH) // let the tuner settle
  }

  // ---------- spectrum + measurements ----------

  private fun noiseFloor(p: FloatArray): Double {
    val n = p.size
    val lo = n / 10
    val len = n - 2 * lo
    System.arraycopy(p, lo, scratch, 0, len)
    java.util.Arrays.sort(scratch, 0, len)
    return max(scratch[len / 2].toDouble(), 1e-20)
  }

  /** Peak power inside the channel relative to the noise floor, in dB. */
  private fun channelSnr(p: FloatArray, noise: Double, offsetHz: Long, chanBw: Int): Double {
    val binHz = FS.toDouble() / FFT_N
    val centre = FFT_N / 2 + offsetHz / binHz
    val half = max(chanBw / 2 / binHz, 1.0)
    val lo = max(floor(centre - half).toInt(), 0)
    val hi = min(ceil(centre + half).toInt() + 1, p.size)
    if (hi <= lo) return -99.0
    var peak = 0f
    for (i in lo until hi) if (p[i] > peak) peak = p[i]
    return 10 * log10(max(peak.toDouble(), 1e-20) / noise)
  }

  private fun publishSpectrum(p: FloatArray, center: Long, noise: Double, scanning: Boolean, b: VfoB?) {
    noiseDb = 10 * log10(noise)
    System.arraycopy(p, 0, lastPsd, 0, FFT_N)
    lastPsdCenter = center
    if (spectrumListeners.isEmpty()) return
    val s = spectrum
    for (i in s.bins.indices) {
      val v = max(p[2 * i], p[2 * i + 1])
      s.bins[i] = (10 * log10(v + 1e-20)).toFloat()
    }
    s.center = center
    s.listenFreq = freq
    s.bw = bw
    s.bFreq = if (b != null && b.inView) b.freq else 0
    s.bBw = b?.bw ?: 0
    s.scanning = scanning
    s.noiseDb = noiseDb.toFloat()
    for (l in spectrumListeners) l(s)
  }

  // ---------- listening ----------

  /** Is a channel usable at this hardware centre: inside the clean part of the view and off the DC spike? */
  private fun fits(centre: Long, f: Long, chanBw: Int): Boolean {
    val off = abs(f - centre)
    return off >= DC_GUARD && off + chanBw / 2 <= USABLE_HALF_SPAN
  }

  /**
   * Where to tune the dongle. If every active channel already fits the current view, keep it: moving within
   * the visible 2.4 MHz only changes the software mixer, so it is instant and gap-free. Otherwise tune just
   * below channel A, or between A and B when both fit.
   */
  private fun planCenter(): Pair<Long, Boolean> {
    val b = vfoB
    val bOk = b != null && scan == null && abs(b.freq - freq) <= B_MAX_SPAN
    val hw = hwCenter
    if (hw != null && fits(hw, freq, bw) && (!bOk || fits(hw, b!!.freq, b.bw))) return hw to bOk
    if (bOk) {
      var c = (freq + b!!.freq) / 2
      if (min(abs(freq - c), abs(b.freq - c)) < DC_GUARD) c += 150_000 // keep both channels off the DC spike
      return c to true
    }
    return max(freq - OFFSET, 0L) to false
  }

  private fun squelchFor(m: String, sq: Double, openBefore: Boolean, s: Double): Boolean {
    val q = if (m == "WFM") 0.0 else sq // broadcast FM: never cut the audio on signal dips
    return q <= 0 || s >= (if (openBefore) q - 2 else q)
  }

  private fun listenBlock(dsp: Dsp, audio: AudioOut) {
    val (centre, withB) = planCenter()
    tuneHw(dsp, centre)
    val hw = hwCenter ?: return
    if (demodDirty) {
      dsp.configure(Dsp.A, mode, bw)
      dsp.setOptions(Dsp.A, stereo, nr)
      demodDirty = false
      stationDirty = false
    } else if (stationDirty) {
      dsp.resetStation(Dsp.A)
      stationDirty = false
    }
    dsp.setOffset(Dsp.A, Dsp.offsetCycles(freq - hw))
    val b = vfoB
    b?.inView = withB
    if (b != null && withB) {
      if (demodBDirty) {
        dsp.configure(Dsp.B, b.mode, b.bw)
        dsp.setOptions(Dsp.B, stereo, nr)
        demodBDirty = false
      }
      dsp.setOffset(Dsp.B, Dsp.offsetCycles(b.freq - hw))
    }

    readBlock(dsp, BLOCK)
    val t0 = System.nanoTime()
    val frames = dsp.demod(BLOCK, LISTEN_PSD_FRAMES, withB && b != null)
    val p = dsp.psd
    val noise = noiseFloor(p)
    publishSpectrum(p, hw, noise, scanning = false, b = b)

    val s = channelSnr(p, noise, freq - hw, bw)
    val sc = scan
    val open = if (sc != null) {
      val q = if (squelch > 0) squelch else DEFAULT_SQUELCH
      s >= (if (squelchOpen) q - 2 else q)
    } else {
      squelchFor(mode, squelch, squelchOpen, s)
    }
    snr = s
    squelchOpen = open

    var openB = false
    if (b != null && withB) {
      val sb = channelSnr(p, noise, b.freq - hw, b.bw)
      openB = squelchFor(b.mode, b.squelch, b.open, sb)
      b.snr = sb
      b.open = openB
      dsp.mix(frames, if (open) 1f else 0f, if (openB) 1f else 0f)
    } else if (b != null) {
      b.snr = 0.0
      b.open = false
    }
    val audible = open || openB
    audio.write(dsp.audio, frames, audible)
    if (audible) recorder?.write(dsp.audio, frames)

    if (mode == "WFM") {
      val info = dsp.rdsInfo(Dsp.A)
      rds = info
      stereoActive = dsp.stereoActive(Dsp.A)
      if (info != null && info.ps.isNotEmpty() && rdsNames[freq.toString()] != info.ps) {
        rdsNames[freq.toString()] = info.ps
        listsVersion++
      }
    } else {
      rds = null
      stereoActive = false
    }
    if (b != null && withB && b.mode == "WFM") b.label = dsp.rdsInfo(Dsp.B)?.ps ?: b.label
    blocks++
    workNs += System.nanoTime() - t0

    if (sc != null && sc.state == "hold") {
      val now = SystemClock.elapsedRealtime()
      if (open) sc.lastActive = now else if (now - sc.lastActive > LINGER_MS) scanNext(sc)
    }
  }

  // ---------- scanning ----------

  /** Groups channels so that each hardware tuning step measures several at once. */
  private fun makeWindows(channels: List<Channel>): List<Window> {
    val chans = channels.sortedBy { it.f }
    val windows = ArrayList<Window>()
    var i = 0
    while (i < chans.size) {
      val lo = chans[i].f
      val group = ArrayList<Channel>()
      while (i < chans.size && chans[i].f - lo <= 2 * SCAN_HALF_SPAN) group.add(chans[i++])
      var centre = (lo + group.last().f) / 2
      if (group.any { abs(it.f - centre) < 15_000 }) centre += 20_000 // keep channels off the DC spike
      windows.add(Window(centre, group))
    }
    return windows
  }

  private fun scanNext(sc: Scan) {
    sc.state = "search"
    sc.idx = (sc.idx + 1) % sc.windows.size
  }

  private fun scanStep(dsp: Dsp, sc: Scan) {
    val w = sc.windows[sc.idx]
    tuneHw(dsp, w.center)
    readBlock(dsp, SCAN_BLOCK)
    dsp.spectrum(SCAN_BLOCK, SCAN_PSD_FRAMES)
    val p = dsp.psd
    val noise = noiseFloor(p)
    publishSpectrum(p, w.center, noise, scanning = true, b = null)
    snr = 0.0
    squelchOpen = false
    val found = ArrayList<Found>()
    for (c in w.channels) {
      if (c.f in sc.lockout) continue
      val s = channelSnr(p, noise, c.f - w.center, c.bw)
      if (s >= sc.threshold) found.add(Found(c, Math.round(s * 10) / 10.0))
    }

    if (sc.state == "search") {
      if (found.isNotEmpty()) {
        val best = found.maxBy { it.snr }
        applyTune(best.ch.f, best.ch.mode, best.ch.bw, best.ch.label)
        sc.state = "hold"
        sc.lastActive = SystemClock.elapsedRealtime()
        hits.addFirst(
          mapOf(
            "t" to System.currentTimeMillis().toDouble(), "f" to best.ch.f.toDouble(), "mode" to best.ch.mode,
            "bw" to best.ch.bw, "label" to best.ch.label.ifEmpty { labelFor(best.ch.f) }, "snr" to best.snr, "group" to sc.name,
          ),
        )
        while (hits.size > 40) hits.removeLast()
        listsVersion++
      } else {
        sc.idx = (sc.idx + 1) % sc.windows.size
      }
      return
    }

    // survey: one pass over the band, keeping the local peaks
    sc.found.addAll(found)
    sc.idx++
    if (sc.idx >= sc.windows.size) {
      val stations = sc.found.filter { st ->
        sc.found.all { o ->
          o === st || abs(o.ch.f - st.ch.f) > max(st.ch.bw, 25_000) || st.snr > o.snr || (st.snr == o.snr && st.ch.f < o.ch.f)
        }
      }.sortedBy { it.ch.f }.map { mapOf("f" to it.ch.f.toDouble(), "snr" to it.snr) }
      survey[sc.group] = mapOf("t" to System.currentTimeMillis().toDouble(), "stations" to stations)
      listsVersion++
      scan = null
      applyTune(sc.prev.f, sc.prev.mode, sc.prev.bw, sc.prev.label)
    }
  }

  // ---------- band activity sweep (like rtl_power) ----------

  private fun startSweep(startHz: Long, stopHz: Long) {
    val start = max(100_000L, startHz)
    val stop = min(1_766_000_000L, stopHz)
    if (stop - start < 1_000_000L) return
    val span = (2 * USABLE_HALF_SPAN * 0.95).toLong()
    val centres = ArrayList<Long>()
    var c = start + USABLE_HALF_SPAN
    while (c - USABLE_HALF_SPAN < stop) {
      centres.add(c)
      c += span
    }
    val nbins = ((stop - start) / SWEEP_STEP + 1).toInt()
    val sc = Scan(
      "sweep", "sweep", "%s-%s MHz".format(fmtMhz(start), fmtMhz(stop)), centres.map { Window(it, emptyList()) }, 0.0,
      Tune(freq, mode, bw, label),
    )
    sc.start = start
    sc.stop = stop
    sc.bins = FloatArray(nbins) { -10f }
    scan = sc
    sweepData = SweepData(start, SWEEP_STEP, sc.bins, done = false)
  }

  private fun fmtMhz(hz: Long) = if (hz % 1_000_000L == 0L) (hz / 1_000_000L).toString() else "%.1f".format(hz / 1e6)

  private fun sweepStep(dsp: Dsp, sc: Scan) {
    val centre = sc.windows[sc.idx].center
    tuneHw(dsp, centre)
    readBlock(dsp, SCAN_BLOCK)
    dsp.spectrum(SCAN_BLOCK, SCAN_PSD_FRAMES)
    val p = dsp.psd
    val noise = noiseFloor(p)
    publishSpectrum(p, centre, noise, scanning = true, b = null)
    val binHz = FS.toDouble() / FFT_N
    for (i in 0 until FFT_N) {
      val off = (i - FFT_N / 2) * binHz
      if (abs(off) > USABLE_HALF_SPAN || abs(off) <= 15_000) continue // clean part of the view, minus the DC spike
      val f = centre + off
      val idx = floor((f - sc.start) / SWEEP_STEP).toInt()
      if (idx < 0 || idx >= sc.bins.size) continue
      val s = (10 * log10(max(p[i].toDouble(), 1e-20) / noise)).toFloat()
      if (s > sc.bins[idx]) sc.bins[idx] = s
    }
    sc.idx++
    if (sc.idx % 8 == 0) notifySweep()
    if (sc.idx >= sc.windows.size) finishSweep(sc)
  }

  private fun notifySweep() {
    for (l in sweepListeners) l()
  }

  private fun finishSweep(sc: Scan) {
    val bins = sc.bins
    val peaks = ArrayList<Map<String, Any?>>()
    var i = 0
    while (i < bins.size) { // each run of bins above 12 dB (extended while >= 8 dB) is one signal
      if (bins[i] < 12) {
        i++
        continue
      }
      var j = i
      while (j + 1 < bins.size && bins[j + 1] >= 8) j++
      var k = i
      for (q in i..j) if (bins[q] > bins[k]) k = q
      val f = sc.start + k * SWEEP_STEP + SWEEP_STEP / 2
      val width = (j - i + 1) * SWEEP_STEP
      val m = bandMode(f) ?: if (width >= 150_000) "WFM" else if (width >= 10_000) "NFM" else "AM"
      peaks.add(
        mapOf(
          "f" to f.toDouble(), "snr" to Math.round(bins[k] * 10) / 10.0, "width" to width.toDouble(), "mode" to m,
          "label" to labelFor(f),
        ),
      )
      i = j + 1
    }
    peaks.sortByDescending { it["snr"] as Double }
    sweepResult = mapOf(
      "t" to System.currentTimeMillis().toDouble(), "start" to sc.start.toDouble(), "stop" to sc.stop.toDouble(),
      "step" to SWEEP_STEP.toDouble(), "peaks" to peaks.take(60),
    )
    sweepData = SweepData(sc.start, SWEEP_STEP, bins, done = true)
    listsVersion++
    notifySweep()
    scan = null
    applyTune(sc.prev.f, sc.prev.mode, sc.prev.bw, sc.prev.label)
  }

  /** Jump to the strongest signal currently on screen. */
  private fun tuneStrongest() {
    if (lastPsdCenter == 0L && hwCenter == null) return
    val n = FFT_N
    val mid = n / 2
    var best = -1
    for (i in (n * 0.08).toInt() until (n * 0.92).toInt()) {
      if (abs(i - mid) < 8) continue // skip the dongle's DC spike
      if (best < 0 || lastPsd[i] > lastPsd[best]) best = i
    }
    if (best < 0) return
    val f = lastPsdCenter - FS / 2 + ((best + 0.5) / n * FS).toLong()
    val step = if (f in 88_000_000L until 108_000_000L) 100_000L else 5_000L
    val snapped = Math.round(f.toDouble() / step) * step
    scan = null
    applyTune(snapped, bandMode(snapped), null, null)
  }

  // ---------- planes + sensors ----------

  /** Reconfigures the dongle for [want]: sample rate (with the stream stopped) and the gain each decoder expects. */
  private fun switchHw(want: String) {
    val d = dev ?: return
    if (want != "radio") stopRecording()
    val rate = if (want == "sensors") SENSOR_FS else FS
    if (rate != hwRate) {
      withStreamStopped(d) { d.setSampleRate(rate) }
      hwRate = rate
    }
    when (want) {
      "planes" -> d.setGain(gains.lastOrNull()) // dump1090's default: the most gain the tuner has
      "sensors" -> d.setGain(null) // rtl_433's default: the tuner's AGC
      else -> d.setGain(gain)
    }
    hwMode = want
    hwCenter = null
    demodDirty = true
    demodBDirty = true
    decodeCfg = ""
    snr = 0.0
    squelchOpen = false
    rds = null
    stereoActive = false
    if (want == "sensors") {
      hopIdx = 0
      hopAt = 0
    }
    emitState(force = true)
  }

  private fun planesBlock(dsp: Dsp) {
    tuneHw(dsp, ADSB_FREQ)
    readBlock(dsp, BLOCK)
    val now = SystemClock.elapsedRealtime()
    val t0 = System.nanoTime()
    val a = adsb ?: AdsbDecoder().also {
      adsb = it
      rxDirty = true
    }
    if (rxDirty) {
      a.setReceiver(rxLat, rxLon)
      rxDirty = false
    }
    a.process(dsp.iq, BLOCK, now)
    blocks++
    workNs += System.nanoTime() - t0
    if (now - lastPlanesMs >= 1000) publishPlanes(a, now)
  }

  private fun distanceNm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val r = Math.PI / 180
    val h = sin((lat2 - lat1) * r / 2).let { it * it } + cos(lat1 * r) * cos(lat2 * r) * sin((lon2 - lon1) * r / 2).let { it * it }
    return 2 * 3440.065 * asin(sqrt(min(h, 1.0)))
  }

  private fun bearing(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val r = Math.PI / 180
    val y = sin((lon2 - lon1) * r) * cos(lat2 * r)
    val x = cos(lat1 * r) * sin(lat2 * r) - sin(lat1 * r) * cos(lat2 * r) * cos((lon2 - lon1) * r)
    return (atan2(y, x) / r + 360) % 360
  }

  private fun publishPlanes(a: AdsbDecoder, now: Long) {
    val dt = now - lastPlanesMs
    lastPlanesMs = now
    val planes = a.snapshot(now)
    val msgs = a.messages
    val rate = if (dt in 1..5000) (msgs - adsbMessages) * 1000.0 / dt else 0.0
    adsbMessages = msgs
    val alive = HashSet<Int>()
    for (p in planes) {
      alive.add(p.icao)
      if (p.hasPos && p.posAgoMs < 5000) trails.getOrPut(p.icao) { Trail() }.add(p.lat, p.lon, if (p.ground) 0 else p.alt ?: -1)
    }
    trails.keys.retainAll(alive)
    val lat = rxLat
    val lon = rxLon
    planesFrame = PlanesFrame(planes, trails.mapValues { it.value.copy() }, lat, lon)
    for (l in planesListeners) l()

    val rows = planes.map { p ->
      val dist = if (p.hasPos && lat != null && lon != null) distanceNm(lat, lon, p.lat, p.lon) else null
      mapOf(
        "hex" to p.hex, "flight" to p.flight, "alt" to p.alt, "gnssAlt" to p.gnssAlt, "gs" to p.gs?.toDouble(), "track" to p.track?.toDouble(),
        "heading" to p.heading?.toDouble(), "vr" to p.vr, "squawk" to p.squawk, "emergency" to p.emergency, "category" to p.category,
        "ground" to p.ground, "lat" to if (p.hasPos) p.lat else null, "lon" to if (p.hasPos) p.lon else null,
        "dist" to dist?.let { Math.round(it * 10) / 10.0 }, "bearing" to if (dist != null) Math.round(bearing(lat!!, lon!!, p.lat, p.lon)).toDouble() else null,
        "rssi" to Math.round(p.rssi * 10) / 10.0, "messages" to p.messages, "seen" to p.seenAgoMs / 1000.0,
        "seenPos" to if (p.posAgoMs >= 0) p.posAgoMs / 1000.0 else null,
      )
    }
    planesInfo = mapOf(
      "aircraft" to rows, "tracked" to planes.size, "withPos" to planes.count { it.hasPos }, "messages" to msgs.toDouble(),
      "rate" to Math.round(rate * 10) / 10.0,
    )
    planesVersion++
  }

  private fun sensorsBlock(dsp: Dsp) {
    val now = SystemClock.elapsedRealtime()
    val s = sensorDec ?: SensorDecoder(SENSOR_FS).also {
      sensorDec = it
      sensorDecoders = it.decoders
    }
    if (hopAt == 0L || now >= hopAt) {
      val bands = sensorBands
      hopIdx = if (hopAt != 0L) (hopIdx + 1) % bands.size else hopIdx % bands.size
      hopAt = now + HOP_MS
      tuneHw(dsp, bands[hopIdx])
      s.reset(bands[hopIdx])
      sensorsVersion++
    }
    readBlock(dsp, SENSOR_BLOCK)
    val t0 = System.nanoTime()
    if (s.process(dsp.iq, SENSOR_BLOCK) > 0) {
      for (line in s.take()) addSensor(line)
    }
    blocks++
    workNs += System.nanoTime() - t0
  }

  /** One rtl_433 message: one row per model + id + channel, like the Mac's sensors table. */
  private fun addSensor(line: String) {
    val msg = try {
      JSONObject(line)
    } catch (e: Exception) {
      return
    }
    val model = msg.optString("model")
    if (model.isEmpty()) return
    val id = msg.opt("id")?.toString() ?: ""
    val ch = msg.opt("channel")?.toString() ?: ""
    val key = "$model|$id|$ch"
    val readings = LinkedHashMap<String, Any?>()
    for (k in msg.keys()) {
      if (k in SENSOR_SKIP) continue
      when (val v = msg.get(k)) {
        is Number -> v.toDouble().takeIf { it.isFinite() }?.let { readings[k] = it }
        is String, is Boolean -> readings[k] = v
      }
    }
    val now = System.currentTimeMillis().toDouble()
    synchronized(sensorDevices) {
      val d = sensorDevices.getOrPut(key) {
        hashMapOf("key" to key, "model" to model, "id" to id, "channel" to ch, "first" to now, "count" to 0)
      }
      d["last"] = now
      d["readings"] = readings
      d["freq"] = (if (msg.has("freq")) msg.optDouble("freq") else msg.optDouble("freq1")).takeIf { it.isFinite() }
      d["rssi"] = msg.optDouble("rssi").takeIf { it.isFinite() }
      d["snr"] = msg.optDouble("snr").takeIf { it.isFinite() }
      d["protocol"] = msg.optInt("protocol")
      d["count"] = (d["count"] as Int) + 1
      sensorMessages++
      if (sensorDevices.size > 200) sensorDevices.values.minByOrNull { it["last"] as Double }?.let { sensorDevices.remove(it["key"]) }
    }
    sensorsVersion++
  }

  private fun currentBand(): Long = sensorBands.let { it[hopIdx % it.size] }

  /** A tuning that puts every ACARS channel in the clean part of the view and off the DC spike (12.5 kHz grid). */
  private fun acarsCentre(ch: LongArray): Long {
    val mid = (ch.min() + ch.max()) / 2 / 12_500 * 12_500
    for (k in 0..32) {
      for (c in longArrayOf(mid + k * 12_500L, mid - k * 12_500L)) {
        if (ch.all { abs(it - c) >= DC_GUARD && abs(it - c) <= 950_000L }) return c
      }
    }
    return mid
  }

  /**
   * The region's decoder frequencies: APRS (the first of [aprsHz]), ACARS channels (those within 1.9 MHz of the
   * first are used), and whether NOAA Weather Radio exists there.
   */
  fun setRegionDecoders(aprsHz: LongArray, acarsHz: LongArray, noaa: Boolean) {
    aprsHz.firstOrNull()?.let { aprsFreq = it }
    if (acarsHz.isNotEmpty()) {
      val ch = acarsHz.filter { abs(it - acarsHz[0]) <= 1_900_000L }.take(8).toLongArray()
      acarsChannels = ch
      acarsCenter = acarsCentre(ch)
    }
    noaaAvailable = noaa
    decodeVersion++
    synchronized(lock) {
      if (thread != null) cmds.add(mapOf("action" to "region_apply"))
    }
  }

  /**
   * The radio's regional settings: FM de-emphasis and the sensor hop list. Kept for the next start when the
   * radio is off; applied on the radio thread (and the sensor hop restarted) when it's running.
   */
  fun setRegion(deemph: Double, bands: LongArray) {
    if (bands.isEmpty()) return
    deemphUs = deemph
    sensorBands = bands
    synchronized(lock) {
      if (thread != null) cmds.add(mapOf("action" to "region_apply"))
    }
  }

  private fun sensorsInfo(): Map<String, Any?> {
    val left = max(hopAt - SystemClock.elapsedRealtime(), 0L)
    val devices = synchronized(sensorDevices) { sensorDevices.values.sortedByDescending { it["last"] as Double }.map { HashMap(it) } }
    return mapOf(
      "messages" to sensorMessages,
      "devices" to devices,
      "band" to currentBand().toDouble(),
      "bands" to sensorBands.map { it.toDouble() },
      "hopSeconds" to HOP_MS / 1000,
      "nextHop" to if (hwMode == "sensors" && hopAt > 0) System.currentTimeMillis() + left.toDouble() else null,
      "decoders" to sensorDecoders,
    )
  }

  // ---------- weather alerts, APRS, ACARS ----------

  /** Channel A demodulates [f] for a decoder; returns the audio frames in dsp.audio, with the PSD in dsp.psd. */
  private fun decodeAudio(dsp: Dsp, center: Long, f: Long, bw: Int, cfg: String): Int {
    tuneHw(dsp, center)
    val hw = hwCenter ?: return 0
    if (decodeCfg != cfg) {
      dsp.configure(Dsp.A, "NFM", bw)
      dsp.setOptions(Dsp.A, false, false) // decoders want the raw audio
      decodeCfg = cfg
    }
    dsp.setOffset(Dsp.A, Dsp.offsetCycles(f - hw))
    readBlock(dsp, BLOCK)
    return dsp.demod(BLOCK, LISTEN_PSD_FRAMES, false)
  }

  /** NOAA Weather Radio: stays on the strongest of the seven channels and decodes SAME alerts. */
  private fun weatherBlock(dsp: Dsp, audio: AudioOut) {
    val frames = decodeAudio(dsp, WX_CENTER, wxFreq, WX_BW, "wx:$wxFreq")
    val hw = hwCenter ?: return
    val t0 = System.nanoTime()
    val p = dsp.psd
    val noise = noiseFloor(p)
    for (i in NOAA.indices) wxSnr[i] = channelSnr(p, noise, NOAA[i] - hw, 12_500)
    val now = SystemClock.elapsedRealtime()
    if (now >= wxPickAt) {
      wxPickAt = now + 5000
      val cur = NOAA.indexOf(wxFreq)
      val best = wxSnr.indices.maxByOrNull { wxSnr[it] } ?: 0
      if (cur < 0 || wxSnr[best] > wxSnr[cur] + 3) wxFreq = NOAA[best] // only for a clearly stronger station
    }
    snr = wxSnr[max(NOAA.indexOf(wxFreq), 0)]
    val d = wxDec ?: WeatherAlertDecoder().also { wxDec = it }
    d.process(dsp.audio, frames, now)
    for (e in d.take()) onWeatherEvent(e, now)
    audio.write(dsp.audio, frames, decodeListen || now < wxAudioUntil)
    blocks++
    workNs += System.nanoTime() - t0
    if (now - lastDecodeTick > 1000) { // station strengths for the UI
      lastDecodeTick = now
      decodeVersion++
    }
  }

  private fun fmtTime(ms: Double): String = java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(Date(ms.toLong()))

  private fun onWeatherEvent(json: String, now: Long) {
    val o = try {
      JSONObject(json)
    } catch (e: Exception) {
      return
    }
    when (o.optString("kind")) {
      "header" -> {
        val ctx = appContext ?: return
        val a = Same.parse(ctx, o.getString("text"), System.currentTimeMillis(), wxCounty) ?: return
        val alert = HashMap(a)
        alert["freq"] = wxFreq.toDouble()
        alert["bursts"] = o.optInt("bursts")
        synchronized(decodeLock) {
          wxAlerts.addFirst(alert)
          while (wxAlerts.size > 40) wxAlerts.removeLast()
        }
        decodeVersion++
        Log.i(TAG, "SAME: ${a["raw"]}")
        // with no county known, every alert on this transmitter counts (they cover a handful of counties)
        if ((a["mine"] == true || wxCounty == null) && a["level"] != "test") {
          wxAudioUntil = now + ALERT_AUDIO_MS
          @Suppress("UNCHECKED_CAST")
          val places = (a["places"] as List<String>).joinToString(", ")
          RadioService.alert(ctx, a["event"] as String, "$places · until ${fmtTime(a["expires"] as Double)}")
        }
      }
      "eom" -> {
        wxAudioUntil = min(wxAudioUntil, now + 3000)
        decodeVersion++
      }
      "tone" -> {
        wxTone = o.optBoolean("on")
        decodeVersion++
      }
    }
  }

  private fun aprsBlock(dsp: Dsp, audio: AudioOut) {
    val f = aprsFreq
    val frames = decodeAudio(dsp, f - OFFSET, f, 12_500, "aprs:$f")
    val hw = hwCenter ?: return
    val t0 = System.nanoTime()
    snr = channelSnr(dsp.psd, noiseFloor(dsp.psd), f - hw, 12_500)
    val now = SystemClock.elapsedRealtime()
    val d = aprsDec ?: AprsPacketDecoder().also { aprsDec = it }
    d.process(dsp.audio, frames, now)
    for (pk in d.take()) onAprsPacket(pk)
    audio.write(dsp.audio, frames, decodeListen)
    blocks++
    workNs += System.nanoTime() - t0
  }

  private fun onAprsPacket(json: String) {
    val o = try {
      JSONObject(json)
    } catch (e: Exception) {
      return
    }
    val src = o.optString("src")
    val info = o.optString("info")
    val pathArr = o.optJSONArray("path")
    val path = (0 until (pathArr?.length() ?: 0)).map { pathArr!!.getString(it) }
    val via = path.lastOrNull { it.endsWith("*") }?.removeSuffix("*") ?: "direct"
    val r = Aprs.parse(src, o.optString("dst"), info)
    val now = System.currentTimeMillis().toDouble()
    synchronized(decodeLock) {
      aprsPackets++
      val msg = r?.message
      if (msg != null) {
        aprsLog.addFirst(mapOf("t" to now, "kind" to "message", "from" to src, "to" to msg.first, "text" to msg.second))
      } else {
        val name = r?.name ?: src
        val st = aprsStations.getOrPut(name) { hashMapOf("call" to name, "count" to 0, "first" to now) }
        st["count"] = (st["count"] as Int) + 1
        st["last"] = now
        st["via"] = via
        st["raw"] = info.take(200)
        if (r != null) {
          val la = r.lat
          val lo = r.lon
          if (la != null && lo != null && la in -90.0..90.0 && lo in -180.0..180.0) {
            st["lat"] = la
            st["lon"] = lo
            val rla = rxLat
            val rlo = rxLon
            if (rla != null && rlo != null) {
              st["dist"] = Math.round(distanceNm(rla, rlo, la, lo) * 1.15078 * 10) / 10.0 // statute miles
              st["bearing"] = Math.round(bearing(rla, rlo, la, lo)).toDouble()
            }
          }
          if (r.lat != null || r.weather != null) st["symbol"] = r.symbol
          if (r.comment.isNotEmpty()) st["comment"] = r.comment
          r.course?.let { st["course"] = it }
          r.speedKt?.let { st["speedMph"] = Math.round(it * 1.15078).toDouble() }
          r.altFt?.let { st["altFt"] = Math.round(it).toDouble() }
          r.weather?.let { if (it.isNotEmpty()) st["weather"] = HashMap(it) }
          r.status?.let {
            st["status"] = it
            aprsLog.addFirst(mapOf("t" to now, "kind" to "status", "from" to src, "text" to it))
          }
        }
      }
      while (aprsLog.size > 60) aprsLog.removeLast()
      if (aprsStations.size > 300) aprsStations.values.minByOrNull { it["last"] as Double }?.let { aprsStations.remove(it["call"]) }
    }
    decodeVersion++
  }

  private fun acarsBlock(dsp: Dsp) {
    val centre = acarsCenter
    tuneHw(dsp, centre)
    readBlock(dsp, BLOCK)
    val t0 = System.nanoTime()
    val d = acarsDec ?: AcarsMessageDecoder(centre, acarsChannels).also { acarsDec = it }
    d.process(dsp.iq, BLOCK)
    val msgs = d.take()
    if (msgs.isNotEmpty()) {
      val now = System.currentTimeMillis().toDouble()
      synchronized(decodeLock) {
        for (m in msgs) {
          val o = try {
            JSONObject(m)
          } catch (e: Exception) {
            continue
          }
          val row = HashMap<String, Any?>()
          for (k in o.keys()) row[k] = o.get(k).let { if (it is Number) it.toDouble() else it }
          row["t"] = now
          row["labelName"] = AcarsLabels.NAMES[o.optString("label")] ?: ""
          acarsMsgs.addFirst(row)
          acarsCount++
        }
        while (acarsMsgs.size > 300) acarsMsgs.removeLast()
      }
      decodeVersion++
    }
    blocks++
    workNs += System.nanoTime() - t0
  }

  /** P25 trunking: the receiver says where the dongle should be (the control channel, or a call's voice channel). */
  private fun p25Block(dsp: Dsp, audio: AudioOut) {
    val want = P25Mode.wantCenter()
    if (want == 0L) { // no control channels configured
      sleepQuietly(100)
      return
    }
    if (want != hwCenter) tuneHw(dsp, want)
    val hw = hwCenter ?: return
    readBlock(dsp, P25_BLOCK)
    val t0 = System.nanoTime()
    val audible = P25Mode.block(dsp.iq, P25_BLOCK, hw, SystemClock.elapsedRealtime(), dsp.audio)
    audio.write(dsp.audio, P25_BLOCK / 50, audible)
    blocks++
    workNs += System.nanoTime() - t0
  }

  /** Counties around the phone, nearest first, for picking the weather-alert county by hand. */
  fun nearbyCounties(): List<Map<String, Any?>> {
    val ctx = appContext ?: return emptyList()
    val la = rxLat ?: return emptyList()
    val lo = rxLon ?: return emptyList()
    return Counties.nearby(ctx, la, lo, 8).map { mapOf("fips" to it.fips, "name" to "${it.name}, ${it.state}") }
  }

  private fun decodeInfo(): Map<String, Any?> = synchronized(decodeLock) {
    val ctx = appContext
    val county = wxCounty?.let { f -> ctx?.let { Counties.get(it, f) } }
    mapOf(
      "listen" to decodeListen,
      "weather" to mapOf(
        "available" to noaaAvailable,
        "freq" to wxFreq.toDouble(),
        "stations" to NOAA.indices.map { mapOf("f" to NOAA[it].toDouble(), "snr" to Math.round(wxSnr[it] * 10) / 10.0) },
        "alerts" to wxAlerts.toList(),
        "tone" to wxTone,
        "alerting" to (SystemClock.elapsedRealtime() < wxAudioUntil),
        "county" to county?.let { mapOf("fips" to it.fips, "name" to "${it.name}, ${it.state}", "manual" to wxCountyManual) },
      ),
      "aprs" to mapOf(
        "freq" to aprsFreq.toDouble(),
        "packets" to aprsPackets,
        "stations" to aprsStations.values.sortedByDescending { it["last"] as Double }.take(200).map { HashMap(it) },
        "log" to aprsLog.toList(),
      ),
      "acars" to mapOf(
        "channels" to acarsChannels.map { it.toDouble() },
        "count" to acarsCount,
        "messages" to acarsMsgs.take(200),
      ),
    )
  }

  // ---------- recording ----------

  private fun startRecording() {
    if (recorder != null) return
    val ctx = appContext ?: return
    val tag = label.filter { it.isLetterOrDigit() || it == ' ' }.trim().replace(' ', '-').take(24)
    val name = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date()) + "_%.4fMHz".format(freq / 1e6) +
      (if (tag.isNotEmpty()) "_$tag" else "") + ".wav"
    recorder = Recorder.start(ctx, name)
    if (recorder == null) fail("Couldn't start recording")
  }

  private fun stopRecording() {
    val r = recorder ?: return
    recorder = null
    r.close { recordingsChanged() }
  }

  fun recordings(): List<Map<String, Any?>> {
    val ctx = appContext ?: return emptyList()
    recordingsCache?.let { return it }
    return Recorder.list(ctx).also { recordingsCache = it }
  }

  fun recordingsChanged() {
    synchronized(lock) {
      recordingsCache = null
      listsVersion++
    }
    if (!running) emitState(force = true)
  }

  private fun applyTune(f: Long, newMode: String?, newBw: Int?, newLabel: String?) {
    val m = newMode ?: mode
    val b = newBw ?: if (m == mode) bw else DEFAULT_BW[m] ?: bw
    if (m != mode || b != bw) demodDirty = true
    if (f != freq) stationDirty = true
    freq = f
    mode = m
    bw = b
    label = if (!newLabel.isNullOrEmpty()) newLabel else labelFor(f)
    squelchOpen = false
    rds = null
  }

  // ---------- commands ----------

  /** Applies a command from JS: on the radio thread when running, right away otherwise. */
  fun command(cmd: Map<String, Any?>) {
    when (cmd["action"]) {
      "fav_add", "fav_remove" -> {
        favorite(cmd)
        emitState(force = true)
        return
      }
    }
    synchronized(lock) {
      if (thread != null) {
        cmds.add(cmd)
        return
      }
      if (applyCmd(cmd, null)) saveSettings()
    }
    emitState(force = true)
  }

  private fun favorite(cmd: Map<String, Any?>) = synchronized(lock) {
    val f = num(cmd["f"])?.toLong() ?: freq
    val list = favorites.filter { abs(it.optLong("f") - f) >= 1000 }.toMutableList()
    if (cmd["action"] == "fav_add") {
      val lbl = (cmd["label"] as? String)?.trim()?.take(40)?.ifEmpty { null } ?: "%.4f MHz".format(f / 1e6)
      list.add(
        JSONObject()
          .put("f", f)
          .put("mode", cmd["mode"] as? String ?: mode)
          .put("bw", num(cmd["bw"])?.toInt() ?: bw)
          .put("label", lbl),
      )
      list.sortBy { it.optLong("f") }
    }
    favorites = list
    if (abs(freq - f) < 1000 && cmd["action"] == "fav_add") label = list.first { abs(it.optLong("f") - f) < 1000 }.optString("label")
    listsVersion++
    saveSettings()
  }

  private fun num(v: Any?): Double? = (v as? Number)?.toDouble()

  private fun drainCmds(dsp: Dsp) {
    var changed = false
    while (true) {
      val cmd = cmds.poll() ?: break
      try {
        changed = applyCmd(cmd, dsp) or changed
      } catch (e: RtlSdrException) {
        fail(e.message ?: "USB error")
      } catch (e: Exception) {
        Log.w(TAG, "bad command $cmd: ${e.message}")
      }
    }
    if (changed) {
      saveSettings()
      emitState(force = true)
    }
  }

  /** Returns true when a persisted setting changed. */
  private fun applyCmd(cmd: Map<String, Any?>, dsp: Dsp?): Boolean {
    when (cmd["action"]) {
      "tune" -> {
        scan = null
        val f = num(cmd["f"])!!.toLong()
        applyTune(f, (cmd["mode"] as? String) ?: bandMode(f), num(cmd["bw"])?.toInt(), cmd["label"] as? String)
      }
      "mode" -> {
        val m = cmd["mode"] as String
        applyTune(freq, m, DEFAULT_BW[m], label)
      }
      "bw" -> applyTune(freq, mode, num(cmd["bw"])!!.toInt().coerceIn(100, 220_000), label)
      "squelch" -> squelch = num(cmd["db"])!!.coerceIn(0.0, 40.0)
      "gain" -> {
        gain = num(cmd["db"])
        dev?.setGain(gain)
      }
      "ppm" -> {
        ppm = num(cmd["ppm"])!!.toInt().coerceIn(-200, 200)
        dev?.let { d -> withStreamStopped(d) { d.setFreqCorrection(ppm) } }
      }
      "stereo" -> {
        stereo = cmd["on"] as Boolean
        dsp?.setOptions(Dsp.A, stereo, nr)
        dsp?.setOptions(Dsp.B, stereo, nr)
      }
      "nr" -> {
        nr = cmd["on"] as Boolean
        dsp?.setOptions(Dsp.A, stereo, nr)
        dsp?.setOptions(Dsp.B, stereo, nr)
      }
      "vfo_b" -> {
        val f = num(cmd["f"])!!.toLong()
        val prev = vfoB
        val m = (cmd["mode"] as? String) ?: bandMode(f) ?: prev?.mode ?: mode
        val b = num(cmd["bw"])?.toInt() ?: if (prev?.mode == m) prev.bw else DEFAULT_BW[m] ?: 12_500
        vfoB = VfoB(f, m, b.coerceIn(100, 220_000), num(cmd["squelch"]) ?: prev?.squelch ?: DEFAULT_SQUELCH).also {
          it.label = (cmd["label"] as? String) ?: labelFor(f)
        }
        demodBDirty = true
        return false
      }
      "vfo_b_squelch" -> {
        vfoB?.squelch = num(cmd["db"])!!.coerceIn(0.0, 40.0)
        return false
      }
      "vfo_b_off" -> {
        vfoB = null
        return false
      }
      "swap" -> {
        val b = vfoB ?: return false
        val newB = VfoB(freq, mode, bw, squelch).also { it.label = label }
        scan = null
        applyTune(b.freq, b.mode, b.bw, b.label)
        squelch = b.squelch
        vfoB = newB
        demodBDirty = true
      }
      "record" -> {
        if (cmd["on"] == true) startRecording() else stopRecording()
        return false
      }
      "sweep" -> {
        startSweep((num(cmd["start"])!! * 1e6).toLong(), (num(cmd["stop"])!! * 1e6).toLong())
        return false
      }
      "strongest" -> tuneStrongest()
      "scan", "survey" -> {
        @Suppress("UNCHECKED_CAST")
        val raw = cmd["channels"] as? List<Map<String, Any?>> ?: return false
        val groupMode = cmd["mode"] as? String
        val chans = raw.map {
          val m = it["mode"] as? String ?: groupMode ?: mode
          Channel(num(it["f"])!!.toLong(), it["label"] as? String ?: "", m, num(it["bw"])?.toInt() ?: DEFAULT_BW[m] ?: bw)
        }
        if (chans.isEmpty()) return false
        val threshold = num(cmd["threshold"])?.takeIf { it > 0 } ?: if (squelch > 0) squelch else DEFAULT_SQUELCH
        val action = cmd["action"] as String
        scan = Scan(
          if (action == "survey") "survey" else "search", cmd["group"] as? String ?: "", cmd["name"] as? String ?: "",
          makeWindows(chans), threshold, Tune(freq, mode, bw, label),
        )
        return false
      }
      "scan_stop" -> {
        scan?.let { sc ->
          if (sc.state == "survey" || sc.state == "sweep") applyTune(sc.prev.f, sc.prev.mode, sc.prev.bw, sc.prev.label)
          if (sc.state == "sweep") {
            sweepData = null
            notifySweep()
          }
        }
        scan = null
        return false
      }
      "scan_skip" -> {
        scan?.let { if (it.state == "hold") scanNext(it) }
        return false
      }
      "scan_ignore" -> {
        scan?.let {
          if (it.state == "hold") {
            it.lockout.add(freq)
            scanNext(it)
          }
        }
        return false
      }
      "scan_stay" -> {
        // keep listening to what the scan found
        scan = null
        return false
      }
      "app_mode" -> {
        val m = cmd["mode"] as? String
        appMode = if (m == "planes" || m == "sensors" || m in DECODE_MODES) m!! else "radio"
        return false
      }
      "region_apply" -> {
        dsp?.setDeemphasis(deemphUs)
        acarsDec?.release() // rebuilt for the new channels on the next ACARS block
        acarsDec = null
        if (hwMode == "sensors") {
          hopIdx = 0
          hopAt = 0 // retune to the first band on the next block
        }
        return false
      }
      "decode_listen" -> {
        decodeListen = cmd["on"] == true
        decodeVersion++
        return false
      }
      "decode_clear" -> {
        synchronized(decodeLock) {
          when (cmd["what"]) {
            "weather" -> wxAlerts.clear()
            "aprs" -> {
              aprsStations.clear()
              aprsLog.clear()
              aprsPackets = 0
            }
            "acars" -> {
              acarsMsgs.clear()
              acarsCount = 0
            }
          }
        }
        decodeVersion++
        return false
      }
      "wx_county" -> {
        val f = cmd["fips"] as? String
        wxCountyManual = f != null
        wxCounty = f ?: rxLat?.let { la -> rxLon?.let { lo -> appContext?.let { Counties.nearest(it, la, lo)?.fips } } }
        decodeVersion++
      }
      "location" -> {
        rxLat = num(cmd["lat"])
        rxLon = num(cmd["lon"])
        rxDirty = true
        // the weather alerts follow the phone's county unless one was picked by hand
        val la = rxLat
        val lo = rxLon
        val ctx = appContext
        if (!wxCountyManual && la != null && lo != null && ctx != null) {
          Counties.nearest(ctx, la, lo)?.let { wxCounty = it.fips }
          decodeVersion++
        }
      }
      "sensors_clear" -> {
        synchronized(sensorDevices) {
          sensorDevices.clear()
          sensorMessages = 0
        }
        sensorsVersion++
        return false
      }
      else -> {
        if ((cmd["action"] as? String)?.startsWith("p25_") == true) P25Mode.command(cmd, SystemClock.elapsedRealtime())
        return false
      }
    }
    return true
  }

  // ---------- state for JS ----------

  private fun emitState(force: Boolean = false) {
    val now = SystemClock.elapsedRealtime()
    if (!force && now - lastEmit < STATE_INTERVAL_MS) return
    lastEmit = now
    val l = stateListener
    if (l != null) {
      val full = sentListsVersion != listsVersion
      sentListsVersion = listsVersion
      val planes = sentPlanesVersion != planesVersion
      sentPlanesVersion = planesVersion
      val sensors = sentSensorsVersion != sensorsVersion
      sentSensorsVersion = sensorsVersion
      val decode = sentDecodeVersion != decodeVersion
      sentDecodeVersion = decodeVersion
      val p25 = sentP25Version != P25Mode.version
      sentP25Version = P25Mode.version
      val p25Dir = sentP25DirVersion != P25Mode.dirVersion
      sentP25DirVersion = P25Mode.dirVersion
      l(snapshot(full, planes, sensors, decode, p25, p25Dir))
    }
    val np = nowPlaying()
    if (np != lastNowPlaying) {
      lastNowPlaying = np
      nowPlayingListener?.invoke(np)
    }
  }

  fun nowPlaying(): String {
    val parts = ArrayList<String>()
    when (appMode) {
      "p25" -> return P25Mode.nowPlaying(status, error)
      "planes" -> {
        val f = planesFrame
        parts.add("Tracking planes")
        if (f != null) parts.add("${f.planes.size} aircraft, ${f.planes.count { it.hasPos }} on the map")
        if (status == "error") parts.add(error)
        return parts.joinToString(" · ")
      }
      "weather" -> {
        parts.add("Watching for weather alerts")
        parts.add("%.3f MHz".format(wxFreq / 1e6))
        if (SystemClock.elapsedRealtime() < wxAudioUntil) synchronized(decodeLock) { wxAlerts.firstOrNull() }?.let { parts.add("ALERT: ${it["event"]}") }
        if (status == "error") parts.add(error)
        return parts.joinToString(" · ")
      }
      "aprs" -> {
        parts.add("APRS %.3f MHz".format(aprsFreq / 1e6))
        parts.add("${synchronized(decodeLock) { aprsStations.size }} stations")
        if (status == "error") parts.add(error)
        return parts.joinToString(" · ")
      }
      "acars" -> {
        parts.add("ACARS")
        parts.add("$acarsCount messages")
        if (status == "error") parts.add(error)
        return parts.joinToString(" · ")
      }
      "sensors" -> {
        parts.add("Listening for sensors")
        parts.add("%.2f MHz".format(currentBand() / 1e6))
        parts.add("${synchronized(sensorDevices) { sensorDevices.size }} devices")
        if (status == "error") parts.add(error)
        return parts.joinToString(" · ")
      }
    }
    parts.add("%.3f MHz %s".format(freq / 1e6, mode))
    val name = rds?.ps?.ifEmpty { null } ?: label.ifEmpty { null }
    if (name != null) parts.add(name)
    if (recorder != null) parts.add("● recording")
    scan?.let { if (it.state != "hold") parts.add("${if (it.state == "sweep") "surveying" else "scanning"} ${it.name}") }
    if (status == "error") parts.add(error)
    return parts.joinToString(" · ")
  }

  /**
   * Everything JS shows. The lists (hits, favorites, survey, RDS names, recordings) are only included when [full],
   * the plane, sensor and decoder tables when [planes] / [sensors] / [decode], P25 when [p25] / [p25Dir].
   */
  fun snapshot(
    full: Boolean = true, planes: Boolean = full, sensors: Boolean = full, decode: Boolean = full, p25: Boolean = full,
    p25Dir: Boolean = full,
  ): Map<String, Any?> {
    val sc = scan
    val r = rds
    val b = vfoB
    val rec = recorder
    val m = HashMap<String, Any?>()
    m["running"] = running
    m["status"] = status
    m["error"] = error
    m["needsPermission"] = needsPermission
    m["device"] = deviceName
    m["freq"] = freq.toDouble()
    m["hwCenter"] = hwCenter?.toDouble()
    m["mode"] = mode
    m["bw"] = bw
    m["label"] = label
    m["squelch"] = squelch
    m["gain"] = gain
    m["gains"] = gains
    m["ppm"] = ppm
    m["stereo"] = stereo
    m["nr"] = nr
    m["stereoActive"] = stereoActive
    m["directSampling"] = directSampling
    m["snr"] = Math.round(snr * 10) / 10.0
    m["open"] = squelchOpen
    m["noise"] = Math.round(noiseDb * 10) / 10.0
    m["appMode"] = appMode
    m["receiver"] = rxLat?.let { la -> rxLon?.let { lo -> mapOf("lat" to la, "lon" to lo) } }
    if (planes) m["planes"] = planesInfo
    if (sensors) m["sensors"] = sensorsInfo()
    if (decode) m["decode"] = decodeInfo()
    if (p25) m["p25"] = P25Mode.info()
    if (p25Dir) m["p25Dir"] = P25Mode.directory()
    m["vfoB"] = b?.let {
      mapOf(
        "freq" to it.freq.toDouble(), "mode" to it.mode, "bw" to it.bw, "squelch" to it.squelch, "label" to it.label,
        "snr" to Math.round(it.snr * 10) / 10.0, "open" to it.open, "inView" to it.inView,
      )
    }
    m["recording"] = rec?.let { mapOf("name" to it.name, "seconds" to Math.round(it.frames / 4800.0) / 10.0) }
    m["scan"] = sc?.let {
      mapOf(
        "state" to it.state, "group" to it.group, "name" to it.name,
        "progress" to "${min(it.idx + 1, it.windows.size)}/${it.windows.size}", "ignored" to it.lockout.size,
      )
    }
    m["rds"] = r?.let {
      val pty = it.pty.toIntOrNull()?.let { i -> Dsp.PTY.getOrNull(i) } ?: ""
      mapOf("pi" to it.pi, "ps" to it.ps, "rt" to it.rt, "pty" to pty, "synced" to it.synced, "groups" to it.groups)
    }
    val d = dev
    m["stats"] = mapOf(
      "blocks" to blocks.toDouble(),
      "msPerBlock" to if (blocks > 0) Math.round(workNs / blocks / 1e4) / 100.0 else 0.0,
      "bytesIn" to ring.bytesIn.toDouble(),
      "dropped" to ring.bytesDropped.toDouble(),
      "streaming" to (d != null),
    )
    if (full) {
      m["listsVersion"] = listsVersion
      m["hits"] = hits.toList()
      m["favorites"] = favorites.map { mapOf("f" to it.optLong("f").toDouble(), "mode" to it.optString("mode"), "bw" to it.optInt("bw"), "label" to it.optString("label")) }
      m["survey"] = HashMap(survey)
      m["rdsNames"] = HashMap(rdsNames)
      m["sweep"] = sweepResult
      m["recordings"] = try {
        recordings()
      } catch (e: Exception) {
        emptyList<Map<String, Any?>>()
      }
    }
    return m
  }
}
