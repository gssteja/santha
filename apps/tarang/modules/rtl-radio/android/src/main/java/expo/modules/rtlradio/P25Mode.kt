package expo.modules.rtlradio

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import expo.modules.rtlradio.dsp.P25Receiver
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap

/**
 * The P25 trunking mode (appMode "p25"): the system preset (assets/p25/charlotte.json: sites, control channels,
 * talkgroup names), the user's talkgroup names, favorites and lockouts and options (persisted), and the native
 * receiver, which only the radio thread touches. JS gets [info] (activity, current call, log, receiver stats)
 * and [directory] (every named talkgroup) through the engine's state.
 */
internal object P25Mode {
  private const val TAG = "P25"
  private const val STATE_MS = 500L

  class Tg(val id: Int, val name: String, val desc: String, val cat: String, val enc: Boolean)
  class Site(val name: String, val rfss: Int, val site: Int, val nac: Int, val ccs: List<Long>)

  private var prefs: SharedPreferences? = null
  @Volatile private var systemName = ""
  @Volatile private var presetSource = ""
  @Volatile private var wacn = 0
  @Volatile private var sysid = -1
  @Volatile private var sites: List<Site> = emptyList()
  @Volatile private var presetTgs: Map<Int, Tg> = emptyMap()
  private val names = ConcurrentHashMap<Int, String>() // the user's names (over the preset's)
  private val cats = ConcurrentHashMap<Int, String>()
  private val flags = ConcurrentHashMap<Int, Int>()    // 1 favorite, 2 locked out
  @Volatile private var siteIdx = 0
  @Volatile private var customCcs: List<Long> = emptyList()
  @Volatile private var listen = true
  @Volatile private var favoritesOnly = false
  @Volatile private var hangMs = 1200
  @Volatile private var hold = -1

  // radio thread
  private var rx: P25Receiver? = null
  @Volatile private var dirty = true
  private var want = 0L
  private var appliedCcs: List<Long>? = null // the control channel list the receiver has (it adds the ones it hears of)
  private var lastStateMs = 0L
  @Volatile private var stateJson: String? = null

  /** Bumped when [info] / [directory] change. */
  @Volatile var version = 0
    private set
  @Volatile var dirVersion = 0
    private set

  fun init(context: Context) {
    if (prefs != null) return
    try {
      val o = JSONObject(context.assets.open("p25/charlotte.json").bufferedReader().use { it.readText() })
      systemName = o.optString("name")
      presetSource = o.optString("source")
      wacn = o.optInt("wacn")
      sysid = o.optInt("sysid", -1)
      val s = o.getJSONArray("sites")
      sites = (0 until s.length()).map { i ->
        val x = s.getJSONObject(i)
        val c = x.getJSONArray("ccs")
        Site(x.optString("name"), x.optInt("rfss"), x.optInt("site"), x.optInt("nac", -1), (0 until c.length()).map { c.getLong(it) })
      }
      val t = o.getJSONArray("talkgroups")
      presetTgs = (0 until t.length()).associate { i ->
        val x = t.getJSONObject(i)
        x.getInt("id") to Tg(x.getInt("id"), x.optString("name"), x.optString("desc"), x.optString("cat"), x.optBoolean("enc"))
      }
    } catch (e: Exception) {
      Log.w(TAG, "no P25 preset: ${e.message}")
    }
    val p = context.getSharedPreferences("tarang_p25", Context.MODE_PRIVATE)
    prefs = p
    siteIdx = p.getInt("site", 0).coerceIn(0, maxOf(0, sites.size - 1))
    customCcs = p.getString("ccs", "")!!.split(',').mapNotNull { it.trim().toLongOrNull() }
    listen = p.getBoolean("listen", true)
    favoritesOnly = p.getBoolean("favorites_only", false)
    hangMs = p.getInt("hang_ms", 1200)
    readMap(p.getString("names", null)) { k, v -> names[k] = v }
    readMap(p.getString("cats", null)) { k, v -> cats[k] = v }
    readMap(p.getString("flags", null)) { k, v -> v.toIntOrNull()?.let { flags[k] = it } }
  }

  private fun readMap(s: String?, put: (Int, String) -> Unit) {
    if (s == null) return
    try {
      val o = JSONObject(s)
      for (k in o.keys()) k.toIntOrNull()?.let { put(it, o.getString(k)) }
    } catch (_: Exception) {
    }
  }

  private fun save() {
    val p = prefs ?: return
    p.edit()
      .putInt("site", siteIdx)
      .putString("ccs", customCcs.joinToString(","))
      .putBoolean("listen", listen)
      .putBoolean("favorites_only", favoritesOnly)
      .putInt("hang_ms", hangMs)
      .putString("names", JSONObject(names.mapKeys { it.key.toString() }).toString())
      .putString("cats", JSONObject(cats.mapKeys { it.key.toString() }).toString())
      .putString("flags", JSONObject(flags.mapKeys { it.key.toString() }.mapValues { it.value.toString() }).toString())
      .apply()
  }

  private fun ccs(): List<Long> = customCcs.ifEmpty { sites.getOrNull(siteIdx)?.ccs ?: emptyList() }

  private fun nameOf(id: Int): String? = names[id] ?: presetTgs[id]?.name

  private fun catOf(id: Int): String = cats[id] ?: presetTgs[id]?.cat ?: ""

  // ---------- radio thread ----------

  /** Where the dongle should be tuned for the next block (the first control channel to start with). */
  fun wantCenter(): Long {
    if (want != 0L) return want
    val cc = ccs().firstOrNull() ?: return 0L
    return (cc - 250_000L + 3125) / 6250 * 6250
  }

  /** One block of IQ; renders the block's worth of call audio into [audio]. Returns whether it's audible. */
  fun block(iq: ByteBuffer, n: Int, hwCenter: Long, nowMs: Long, audio: ByteBuffer): Boolean {
    val r = rx ?: P25Receiver().also {
      rx = it
      dirty = true
      appliedCcs = null
    }
    if (dirty) {
      dirty = false
      val c = ccs()
      if (c != appliedCcs) {
        r.setControlChannels(c.toLongArray())
        appliedCcs = c
      }
      val ids = flags.keys.toIntArray()
      r.setFlags(ids, IntArray(ids.size) { flags[ids[it]] ?: 0 })
      r.setOptions(favoritesOnly, hangMs, !listen)
      r.setSystem(wacn, sysid, sites.getOrNull(siteIdx)?.nac ?: -1)
      r.hold(hold)
    }
    want = r.process(iq, n, hwCenter, nowMs)
    val audible = r.render(audio, n / 50)
    r.takeEvents()
    if (nowMs - lastStateMs >= STATE_MS) {
      lastStateMs = nowMs
      val js = r.state(nowMs)
      stateJson = js
      version++
    }
    return audible && listen
  }

  fun release() {
    rx?.release()
    rx = null
    want = 0
    stateJson = null
    version++
  }

  // ---------- commands (radio thread while running, the caller's otherwise) ----------

  @Suppress("UNCHECKED_CAST")
  fun command(cmd: Map<String, Any?>, nowMs: Long) {
    when (cmd["action"]) {
      "p25_listen" -> listen = cmd["on"] == true
      "p25_favorites_only" -> favoritesOnly = cmd["on"] == true
      "p25_hang" -> hangMs = ((cmd["ms"] as? Number)?.toInt() ?: hangMs).coerceIn(0, 10_000)
      "p25_site" -> {
        siteIdx = ((cmd["index"] as? Number)?.toInt() ?: 0).coerceIn(0, maxOf(0, sites.size - 1))
        customCcs = emptyList()
      }
      "p25_ccs" -> customCcs = (cmd["mhz"] as? List<Any?>)?.mapNotNull { (it as? Number)?.toDouble() }
        ?.filter { it in 25.0..1766.0 }?.map { Math.round(it * 1e6) } ?: emptyList()
      "p25_tg" -> {
        val id = (cmd["id"] as? Number)?.toInt() ?: return
        (cmd["name"] as? String)?.let { n -> if (n.isBlank()) names.remove(id) else names[id] = n.trim().take(32) }
        var f = flags[id] ?: 0
        (cmd["fav"] as? Boolean)?.let { f = if (it) (f or 1) and 2.inv() else f and 1.inv() }
        (cmd["lockout"] as? Boolean)?.let { f = if (it) (f or 2) and 1.inv() else f and 2.inv() }
        if (f == 0) flags.remove(id) else flags[id] = f
        dirVersion++
      }
      "p25_import" -> {
        importCsv(cmd["text"] as? String ?: "")
        dirVersion++
      }
      "p25_names_reset" -> {
        names.clear()
        cats.clear()
        dirVersion++
      }
      "p25_hold" -> hold = (cmd["tg"] as? Number)?.toInt() ?: -1
      "p25_skip" -> rx?.skip(nowMs)
      else -> return
    }
    dirty = true
    version++
    save()
  }

  /**
   * Talkgroup names pasted as CSV / TSV: RadioReference's export (Decimal, Hex, Alpha Tag, Mode, Description,
   * Tag, Category) or plain "id, name[, category]" lines. Returns how many were read.
   */
  private fun importCsv(text: String): Int {
    var n = 0
    for (raw in text.lineSequence()) {
      val f = raw.split(if ('\t' in raw) "\t" else ",").map { it.trim().trim('"').trim() }
      val id = f.firstOrNull()?.toIntOrNull() ?: continue
      if (id !in 1..65535) continue
      val rr = f.size >= 4 && f[1].matches(Regex("[0-9a-fA-F]{1,4}")) && f[1].toIntOrNull(16) == id
      val name = (if (rr) f.getOrNull(2) else f.getOrNull(1))?.takeIf { it.isNotEmpty() } ?: continue
      names[id] = name.take(32)
      val cat = if (rr) f.getOrNull(6) ?: f.getOrNull(5) else f.getOrNull(2)
      if (!cat.isNullOrEmpty()) cats[id] = cat.take(24)
      n++
    }
    return n
  }

  // ---------- state for JS ----------

  private fun js(v: Any?): Any? = when (v) {
    is JSONObject -> HashMap<String, Any?>().also { m -> for (k in v.keys()) m[k] = js(v.get(k)) }
    is JSONArray -> (0 until v.length()).map { js(v.get(it)) }
    is Number -> v.toDouble()
    JSONObject.NULL -> null
    else -> v
  }

  @Suppress("UNCHECKED_CAST")
  private fun tgFields(m: HashMap<String, Any?>, id: Int) {
    m["name"] = nameOf(id) ?: ""
    m["cat"] = catOf(id)
    m["fav"] = (flags[id] ?: 0) and 1 != 0
    m["lockout"] = (flags[id] ?: 0) and 2 != 0
  }

  @Suppress("UNCHECKED_CAST")
  fun info(): Map<String, Any?> {
    val now = System.currentTimeMillis()
    val m = HashMap<String, Any?>()
    val s = stateJson?.let {
      try {
        js(JSONObject(it)) as HashMap<String, Any?>
      } catch (e: Exception) {
        null
      }
    }
    if (s != null) {
      m.putAll(s)
      (s["call"] as? HashMap<String, Any?>)?.let { c -> tgFields(c, (c["tg"] as Double).toInt()) }
      m["tgs"] = (s["tgs"] as? List<HashMap<String, Any?>>)?.map { t ->
        tgFields(t, (t["id"] as Double).toInt())
        t["t"] = now - (t["ago"] as Double)
        t
      }
      m["log"] = (s["log"] as? List<HashMap<String, Any?>>)?.map { e ->
        tgFields(e, (e["tg"] as Double).toInt())
        e["t"] = now - (e["ago"] as Double)
        e
      }
    } else {
      m["mode"] = "off"
    }
    m["system"] = systemName
    m["sites"] = sites.mapIndexed { i, x ->
      mapOf("index" to i, "name" to x.name, "nac" to x.nac.toDouble(), "ccs" to x.ccs.map { it.toDouble() })
    }
    m["settings"] = mapOf(
      "site" to siteIdx, "ccs" to ccs().map { it.toDouble() }, "custom" to customCcs.isNotEmpty(), "listen" to listen,
      "favoritesOnly" to favoritesOnly, "hangMs" to hangMs, "hold" to hold,
    )
    return m
  }

  /** Every named talkgroup (the preset's and the user's), for browsing and setting favorites / lockouts. */
  fun directory(): List<Map<String, Any?>> {
    val ids = (presetTgs.keys + names.keys + flags.keys).toSortedSet()
    return ids.map { id ->
      val p = presetTgs[id]
      mapOf(
        "id" to id, "name" to (nameOf(id) ?: ""), "cat" to catOf(id), "desc" to (p?.desc ?: ""), "enc" to (p?.enc ?: false),
        "fav" to ((flags[id] ?: 0) and 1 != 0), "lockout" to ((flags[id] ?: 0) and 2 != 0),
      )
    }.sortedWith(compareBy({ it["cat"] as String }, { it["id"] as Int }))
  }

  fun source(): String = presetSource

  /** The notification line. */
  fun nowPlaying(status: String, error: String): String {
    val parts = arrayListOf("P25")
    val s = stateJson
    if (s == null) {
      parts.add("starting")
    } else {
      try {
        val o = JSONObject(s)
        val c = o.optJSONObject("call")
        when {
          c != null -> {
            val tg = c.getInt("tg")
            parts.add(nameOf(tg) ?: "TG $tg")
            parts.add("%.4f MHz".format(c.getLong("f") / 1e6))
          }
          o.optString("mode") == "control" -> parts.add("control channel %.4f MHz".format(o.getLong("cc") / 1e6))
          else -> parts.add("looking for the control channel")
        }
      } catch (_: Exception) {
      }
    }
    if (!listen) parts.add("muted")
    if (status == "error") parts.add(error)
    return parts.joinToString(" · ")
  }
}
