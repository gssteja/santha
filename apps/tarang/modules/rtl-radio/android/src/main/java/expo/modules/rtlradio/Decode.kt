package expo.modules.rtlradio

import android.content.Context
import kotlin.math.cos
import kotlin.math.pow

/** US counties by FIPS code (assets/counties.tsv, from the Census Gazetteer): SAME alerts name counties this way. */
internal object Counties {
  class County(val fips: String, val state: String, val name: String, val lat: Double, val lon: Double)

  @Volatile private var all: Map<String, County>? = null

  private fun load(context: Context): Map<String, County> {
    all?.let { return it }
    val m = HashMap<String, County>(3400)
    try {
      context.assets.open("counties.tsv").bufferedReader().useLines { lines ->
        for (l in lines) {
          val f = l.split('\t')
          if (f.size >= 5) m[f[0]] = County(f[0], f[1], f[2], f[3].toDouble(), f[4].toDouble())
        }
      }
    } catch (_: Exception) {
    }
    all = m
    return m
  }

  fun get(context: Context, fips: String): County? = load(context)[fips]

  /** State abbreviation for a two-digit state FIPS code. */
  fun state(context: Context, ss: String): String? = load(context).values.firstOrNull { it.fips.startsWith(ss) }?.state

  /** The county whose centre is nearest: right away from the border, a fair guess near it. */
  fun nearest(context: Context, lat: Double, lon: Double): County? = nearby(context, lat, lon, 1).firstOrNull()

  /** The [n] counties with the nearest centres, nearest first (to correct a guess near a county line). */
  fun nearby(context: Context, lat: Double, lon: Double, n: Int): List<County> {
    val k = cos(Math.toRadians(lat))
    return load(context).values.sortedBy { c ->
      val dy = c.lat - lat
      val dx = (c.lon - lon) * k
      dx * dx + dy * dy
    }.take(n)
  }
}

/** NOAA Weather Radio SAME headers: event names, and what a header means. */
internal object Same {
  val EVENTS = mapOf(
    "ADR" to "Administrative Message", "AVA" to "Avalanche Watch", "AVW" to "Avalanche Warning",
    "BHW" to "Biological Hazard Warning", "BLU" to "Blue Alert", "BZW" to "Blizzard Warning",
    "CAE" to "Child Abduction Emergency", "CDW" to "Civil Danger Warning", "CEM" to "Civil Emergency Message",
    "CFA" to "Coastal Flood Watch", "CFW" to "Coastal Flood Warning", "CHW" to "Chemical Hazard Warning",
    "DMO" to "Practice / Demo", "DSW" to "Dust Storm Warning", "EAN" to "Emergency Action Notification",
    "EAT" to "Emergency Action Termination", "EQW" to "Earthquake Warning", "EVA" to "Evacuation Watch",
    "EVI" to "Evacuation Immediate", "EWW" to "Extreme Wind Warning", "FFA" to "Flash Flood Watch",
    "FFS" to "Flash Flood Statement", "FFW" to "Flash Flood Warning", "FLA" to "Flood Watch", "FLS" to "Flood Statement",
    "FLW" to "Flood Warning", "FRW" to "Fire Warning", "FSW" to "Flash Freeze Warning", "FZW" to "Freeze Warning",
    "HLS" to "Hurricane Statement", "HMW" to "Hazardous Materials Warning", "HUA" to "Hurricane Watch",
    "HUW" to "Hurricane Warning", "HWA" to "High Wind Watch", "HWW" to "High Wind Warning",
    "IFW" to "Industrial Fire Warning", "LAE" to "Local Area Emergency", "LEW" to "Law Enforcement Warning",
    "LSW" to "Landslide Warning", "NAT" to "National Audible Test", "NIC" to "National Information Center",
    "NMN" to "Network Message Notification", "NPT" to "National Periodic Test", "NST" to "National Silent Test",
    "NUW" to "Nuclear Power Plant Warning", "POS" to "Power Outage Statement", "RHW" to "Radiological Hazard Warning",
    "RMT" to "Required Monthly Test", "RWT" to "Required Weekly Test", "SMW" to "Special Marine Warning",
    "SPS" to "Special Weather Statement", "SPW" to "Shelter in Place Warning", "SQW" to "Snow Squall Warning",
    "SSA" to "Storm Surge Watch", "SSW" to "Storm Surge Warning", "SVA" to "Severe Thunderstorm Watch",
    "SVR" to "Severe Thunderstorm Warning", "SVS" to "Severe Weather Statement", "TOA" to "Tornado Watch",
    "TOE" to "911 Telephone Outage", "TOR" to "Tornado Warning", "TRA" to "Tropical Storm Watch",
    "TRW" to "Tropical Storm Warning", "TSA" to "Tsunami Watch", "TSW" to "Tsunami Warning", "VOW" to "Volcano Warning",
    "WSA" to "Winter Storm Watch", "WSW" to "Winter Storm Warning",
  )
  private val TESTS = setOf("RWT", "RMT", "NPT", "NST", "NAT", "DMO")
  private val EMERGENCIES = setOf("EAN", "CAE", "CEM", "EVI", "LAE", "TOE", "BLU", "CDW", "SPW")
  private val ORGS = mapOf("WXR" to "National Weather Service", "EAS" to "EAS participant", "CIV" to "Civil authorities", "PEP" to "National (PEP)")

  /** "warning" | "watch" | "statement" | "test" */
  fun level(code: String): String = when {
    code in TESTS -> "test"
    code in EMERGENCIES || code.endsWith("W") || code == "TOR" || code == "SVR" -> "warning"
    code.endsWith("A") -> "watch"
    else -> "statement"
  }

  /**
   * ZCZC-ORG-EEE-PSSCCC-...+TTTT-JJJHHMM-LLLLLLLL- as a map for JS, or null if it doesn't parse. [myFips] marks
   * alerts that cover the phone's county (or its whole state).
   */
  fun parse(context: Context, text: String, receivedMs: Long, myFips: String?): Map<String, Any?>? {
    if (!text.startsWith("ZCZC-")) return null
    val body = text.removePrefix("ZCZC-")
    val plus = body.indexOf('+')
    if (plus < 0) return null
    val head = body.substring(0, plus).split('-')
    val tail = body.substring(plus + 1).split('-')
    if (head.size < 3 || tail.size < 3 || tail[0].length != 4 || tail[1].length != 7) return null
    val org = head[0]
    val code = head[1]
    val places = ArrayList<String>()
    var mine = false
    for (loc in head.drop(2)) {
      if (loc.length != 6) continue
      val fips = loc.substring(1)
      val ss = fips.substring(0, 2)
      if (fips.endsWith("000")) {
        places.add("all of " + (Counties.state(context, ss) ?: "state $ss"))
        if (myFips != null && myFips.startsWith(ss)) mine = true
      } else {
        val c = Counties.get(context, fips)
        places.add(if (c != null) "${c.name}, ${c.state}" else "county $fips")
        if (fips == myFips) mine = true
      }
    }
    val durMin = (tail[0].substring(0, 2).toIntOrNull() ?: 0) * 60 + (tail[0].substring(2).toIntOrNull() ?: 0)
    val issued = issueTime(tail[1], receivedMs)
    return mapOf(
      "code" to code, "event" to (EVENTS[code] ?: "Alert $code"), "level" to level(code), "org" to (ORGS[org] ?: org),
      "places" to places, "mine" to mine, "issued" to issued.toDouble(), "expires" to (issued + durMin * 60_000L).toDouble(),
      "station" to tail[2].trim(), "received" to receivedMs.toDouble(), "raw" to text,
    )
  }

  /** JJJHHMM (UTC day of year, hour, minute) -> epoch ms, in the year that puts it nearest [nowMs]. */
  private fun issueTime(jjjhhmm: String, nowMs: Long): Long {
    val day = jjjhhmm.substring(0, 3).toIntOrNull() ?: return nowMs
    val hh = jjjhhmm.substring(3, 5).toIntOrNull() ?: 0
    val mm = jjjhhmm.substring(5, 7).toIntOrNull() ?: 0
    val cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"))
    cal.timeInMillis = nowMs
    var best = nowMs
    var bestDiff = Long.MAX_VALUE
    for (y in cal.get(java.util.Calendar.YEAR) - 1..cal.get(java.util.Calendar.YEAR)) {
      val c = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"))
      c.clear()
      c.set(java.util.Calendar.YEAR, y)
      c.set(java.util.Calendar.DAY_OF_YEAR, day)
      c.set(java.util.Calendar.HOUR_OF_DAY, hh)
      c.set(java.util.Calendar.MINUTE, mm)
      val d = kotlin.math.abs(c.timeInMillis - nowMs)
      if (d < bestDiff) {
        bestDiff = d
        best = c.timeInMillis
      }
    }
    return best
  }
}

/** APRS payloads (APRS 1.01): positions (plain, compressed, Mic-E), objects, items, weather, status, messages. */
internal object Aprs {
  class Report {
    var name = ""           // station, object or item
    var lat: Double? = null
    var lon: Double? = null
    var symbol = "/."       // table + code
    var comment = ""
    var course: Int? = null
    var speedKt: Double? = null
    var altFt: Double? = null
    var weather: MutableMap<String, Double>? = null
    var message: Pair<String, String>? = null // addressee, text
    var status: String? = null
  }

  private fun b91(s: String): Int? {
    var v = 0
    for (c in s) {
      val d = c.code - 33
      if (d < 0 || d > 90) return null
      v = v * 91 + d
    }
    return v
  }

  fun parse(src: String, dst: String, info: String): Report? {
    if (info.isEmpty()) return null
    val r = Report()
    r.name = src
    when (info[0]) {
      '!', '=' -> position(info.substring(1), r)
      '/', '@' -> if (info.length > 8) position(info.substring(8), r)
      ';' -> { // object: name(9) live/killed(1) time(7) position
        if (info.length < 18) return null
        r.name = info.substring(1, 10).trim()
        position(info.substring(18), r)
      }
      ')' -> { // item: name(3-9) then ! or _
        val end = info.indexOfAny(charArrayOf('!', '_'), 1)
        if (end < 4) return null
        r.name = info.substring(1, end).trim()
        position(info.substring(end + 1), r)
      }
      '`', '\'', '\u001c', '\u001d' -> micE(dst, info, r)
      '_' -> { // weather report without a position: MMDDHHMM then fields
        r.symbol = "/_"
        r.weather = weather(if (info.length > 9) info.substring(9) else "")
      }
      '>' -> r.status = info.substring(1)
      ':' -> {
        if (info.length < 11 || info[10] != ':') return null
        r.message = info.substring(1, 10).trim() to info.substring(11)
      }
      else -> return null
    }
    // altitude anywhere in the comment: /A=dddddd feet
    Regex("/A=(-?\\d{5,6})").find(r.comment)?.let { r.altFt = it.groupValues[1].toDouble() }
    return r
  }

  private fun position(p: String, r: Report) {
    if (p.isEmpty()) return
    if (p[0].isDigit()) { // DDMM.hhN/DDDMM.hhW$ : spaces mark position ambiguity
      if (p.length < 19) return
      val lat = p.substring(0, 8).replace(' ', '0')
      val lon = p.substring(9, 18).replace(' ', '0')
      val la = (lat.substring(0, 2).toDoubleOrNull() ?: return) + (lat.substring(2, 7).toDoubleOrNull() ?: return) / 60
      val lo = (lon.substring(0, 3).toDoubleOrNull() ?: return) + (lon.substring(3, 8).toDoubleOrNull() ?: return) / 60
      r.lat = if (lat[7] == 'S') -la else la
      r.lon = if (lon[8] == 'W') -lo else lo
      r.symbol = "${p[8]}${p[18]}"
      var rest = p.substring(19)
      if (r.symbol[1] == '_') {
        r.weather = weather(rest)
        rest = ""
      } else if (rest.length >= 7 && rest[3] == '/' && rest.substring(0, 3).all { it.isDigit() } && rest.substring(4, 7).all { it.isDigit() }) {
        r.course = rest.substring(0, 3).toInt().takeIf { it in 1..360 }
        r.speedKt = rest.substring(4, 7).toDouble()
        rest = rest.substring(7)
      }
      r.comment = rest.trim()
    } else { // compressed: table, YYYY, XXXX, code, cs, type
      if (p.length < 13) return
      val y = b91(p.substring(1, 5)) ?: return
      val x = b91(p.substring(5, 9)) ?: return
      r.lat = 90 - y / 380926.0
      r.lon = -180 + x / 190463.0
      r.symbol = "${p[0]}${p[9]}"
      val c = p[10].code - 33
      val s = p[11].code - 33
      val t = p[12].code - 33
      if (p[10] != ' ') {
        if ((t and 0x18) == 0x10) r.altFt = 1.002.pow(c * 91 + s)
        else if (c in 0..89) {
          r.course = (c * 4).takeIf { it > 0 }
          r.speedKt = 1.08.pow(s) - 1
        }
      }
      val rest = p.substring(13)
      if (r.symbol[1] == '_') r.weather = weather(rest) else r.comment = rest.trim()
    }
  }

  /** Mic-E: the latitude and flags live in the destination address, the rest in the info field. */
  private fun micE(dst: String, info: String, r: Report) {
    val d = dst.substringBefore('-')
    if (d.length < 6 || info.length < 9) return
    val digits = IntArray(6)
    for (i in 0 until 6) {
      val c = d[i]
      digits[i] = when (c) {
        in '0'..'9' -> c - '0'
        in 'A'..'J' -> c - 'A'
        in 'P'..'Y' -> c - 'P'
        else -> 0 // K, L, Z: ambiguity
      }
    }
    val north = d[3] in 'P'..'Z'
    val lonOffset = d[4] in 'P'..'Z'
    val west = d[5] in 'P'..'Z'
    val lat = digits[0] * 10 + digits[1] + (digits[2] * 10 + digits[3] + (digits[4] * 10 + digits[5]) / 100.0) / 60
    var deg = info[1].code - 28
    if (lonOffset) deg += 100
    if (deg in 180..189) deg -= 80 else if (deg in 190..199) deg -= 190
    var min = info[2].code - 28
    if (min >= 60) min -= 60
    val hun = info[3].code - 28
    val lon = deg + (min + hun / 100.0) / 60
    r.lat = if (north) lat else -lat
    r.lon = if (west) -lon else lon
    val sp = info[4].code - 28
    val dc = info[5].code - 28
    val se = info[6].code - 28
    var speed = sp * 10 + dc / 10
    if (speed >= 800) speed -= 800
    var course = (dc % 10) * 100 + se
    if (course >= 400) course -= 400
    r.speedKt = speed.toDouble()
    r.course = course.takeIf { it in 1..360 }
    r.symbol = "${info[8]}${info[7]}"
    var rest = info.substring(9)
    // optional altitude: three base-91 digits and '}' (metres above -10 km)
    val alt = Regex("(.{3})\\}").find(rest)
    if (alt != null) {
      b91(alt.groupValues[1])?.let { r.altFt = (it - 10000) * 3.28084 }
      rest = rest.removeRange(alt.range)
    }
    r.comment = rest.trimStart('>', ']', '`', '\'').trim()
  }

  /** Weather fields: ddd/sss wind, gGGG gust, tTTT temp F, rRRR / pPPP / PPPP rain, hHH humidity, bBBBBB pressure. */
  private fun weather(w: String): MutableMap<String, Double> {
    val m = LinkedHashMap<String, Double>()
    var s = w
    if (s.length >= 7 && s[3] == '/') {
      s.substring(0, 3).toDoubleOrNull()?.let { m["windDir"] = it }
      s.substring(4, 7).toDoubleOrNull()?.let { m["windMph"] = it }
      s = s.substring(7)
    } else if (s.startsWith("c") && s.length >= 8 && s[4] == 's') {
      s.substring(1, 4).toDoubleOrNull()?.let { m["windDir"] = it }
      s.substring(5, 8).toDoubleOrNull()?.let { m["windMph"] = it }
      s = s.substring(8)
    }
    val fields = mapOf('g' to 3, 't' to 3, 'r' to 3, 'p' to 3, 'P' to 3, 'h' to 2, 'b' to 5, 'L' to 3, 'l' to 3)
    var i = 0
    while (i < s.length) {
      val len = fields[s[i]] ?: break
      if (i + 1 + len > s.length) break
      val v = s.substring(i + 1, i + 1 + len).trim().toDoubleOrNull()
      if (v != null) {
        when (s[i]) {
          'g' -> m["gustMph"] = v
          't' -> m["tempF"] = v
          'r' -> m["rain1hIn"] = v / 100
          'p' -> m["rain24hIn"] = v / 100
          'P' -> m["rainTodayIn"] = v / 100
          'h' -> m["humidity"] = if (v == 0.0) 100.0 else v
          'b' -> m["pressureMb"] = v / 10
          'L' -> m["lightWm2"] = v
          'l' -> m["lightWm2"] = v + 1000
        }
      }
      i += 1 + len
    }
    return m
  }
}

/** The ACARS message labels you'll see most (anything else shows as its two-character code). */
internal object AcarsLabels {
  val NAMES = mapOf(
    "H1" to "Crew / datalink message", "_d" to "No data (keep-alive)", "Q0" to "Link test", "SA" to "Link status",
    "5Z" to "Airline message",
  )
}
