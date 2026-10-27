package expo.modules.rtlradio

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.tan

/**
 * The offline outline map bundled with the app (assets/basemap.bin, made by tools/make_basemap.py from Natural
 * Earth and OurAirports, both public domain): coastlines, lakes, rivers, borders, highways, runways, cities and
 * airports, decoded once into Web Mercator units (0..1) and drawn with batched drawLines.
 */
internal object Basemap {
  const val COAST = 0
  const val LAKE = 1
  const val RIVER = 2
  const val COUNTRY = 3
  const val STATE = 4
  const val ROAD = 5
  const val RUNWAY = 6
  const val CITY = 7
  const val AIRPORT = 8
  const val COARSE = 0x10 // the same lines simplified to ~1.5 km, for zoomed-out views

  /** Polylines: points [start[i], start[i + 1]) of xy (x, y pairs) form feature i; bbox is minX, minY, maxX, maxY. */
  class Lines(val xy: FloatArray, val start: IntArray, val minZoom: ByteArray, val bbox: FloatArray)

  class Points(val x: FloatArray, val y: FloatArray, val minZoom: ByteArray, val names: Array<String>) {
    val widths = FloatArray(names.size) { -1f } // label widths, measured on first use
  }

  @Volatile var lines: Map<Int, Lines> = emptyMap()
    private set
  @Volatile var points: Map<Int, Points> = emptyMap()
    private set
  @Volatile var loaded = false
    private set
  private var loading = false
  private val waiting = ArrayList<() -> Unit>()
  private val main = Handler(Looper.getMainLooper())

  /** Decodes the asset on a background thread (about 4 MB, once per process); [done] runs on the main thread. */
  fun load(context: Context, done: () -> Unit) {
    synchronized(this) {
      if (loaded) {
        main.post(done)
        return
      }
      waiting.add(done)
      if (loading) return
      loading = true
    }
    val assets = context.applicationContext.assets
    Thread({
      try {
        parse(assets.open("basemap.bin").use { it.readBytes() })
      } catch (e: Exception) {
        Log.w("Basemap", "couldn't load the outline map: ${e.message}")
      }
      val callbacks = synchronized(this) {
        loaded = true
        ArrayList(waiting).also { waiting.clear() }
      }
      for (c in callbacks) main.post(c)
    }, "basemap").start()
  }

  private fun mercY(lat: Double): Float {
    val r = Math.toRadians(lat.coerceIn(-85.0, 85.0))
    return ((1 - ln(tan(r) + 1 / cos(r)) / PI) / 2).toFloat()
  }

  private fun parse(b: ByteArray) {
    if (b.size < 5 || b[0] != 'T'.code.toByte() || b[1] != 'B'.code.toByte() || b[2] != 'M'.code.toByte() || b[3] != '1'.code.toByte()) {
      throw IllegalStateException("not a basemap")
    }
    var pos = 4
    fun u8() = b[pos++].toInt() and 0xff
    fun varint(): Int {
      var v = 0
      var shift = 0
      while (true) {
        val c = b[pos++].toInt() and 0xff
        v = v or ((c and 0x7f) shl shift)
        if (c < 0x80) return v
        shift += 7
      }
    }
    fun zig(): Int = varint().let { (it ushr 1) xor -(it and 1) }

    val ls = HashMap<Int, Lines>()
    val ps = HashMap<Int, Points>()
    repeat(u8()) {
      val id = u8()
      val kind = u8()
      val n = varint()
      if (kind == 0) {
        val start = IntArray(n + 1)
        val mz = ByteArray(n)
        val bbox = FloatArray(n * 4)
        var xy = FloatArray(4096)
        var np = 0
        for (f in 0 until n) {
          mz[f] = b[pos++]
          val cnt = varint()
          if ((np + cnt) * 2 > xy.size) xy = xy.copyOf(max(xy.size * 2, (np + cnt) * 2))
          var lat = 0
          var lon = 0
          var x0 = 1f
          var y0 = 1f
          var x1 = 0f
          var y1 = 0f
          for (k in 0 until cnt) {
            lat += zig()
            lon += zig()
            val x = ((lon / 1e5 + 180.0) / 360.0).toFloat()
            val y = mercY(lat / 1e5)
            xy[np * 2] = x
            xy[np * 2 + 1] = y
            np++
            x0 = min(x0, x)
            y0 = min(y0, y)
            x1 = max(x1, x)
            y1 = max(y1, y)
          }
          start[f + 1] = np
          bbox[f * 4] = x0
          bbox[f * 4 + 1] = y0
          bbox[f * 4 + 2] = x1
          bbox[f * 4 + 3] = y1
        }
        ls[id] = Lines(xy.copyOf(np * 2), start, mz, bbox)
      } else {
        val x = FloatArray(n)
        val y = FloatArray(n)
        val mz = ByteArray(n)
        val names = Array(n) { "" }
        for (f in 0 until n) {
          mz[f] = b[pos++]
          val lat = zig()
          val lon = zig()
          x[f] = ((lon / 1e5 + 180.0) / 360.0).toFloat()
          y[f] = mercY(lat / 1e5)
          val len = u8()
          names[f] = String(b, pos, len, Charsets.UTF_8)
          pos += len
        }
        ps[id] = Points(x, y, mz, names)
      }
    }
    lines = ls
    points = ps
  }

  // ---------- drawing ----------

  /** Where the map is looking: centre in Mercator units, zoom, and the size of the whole world in pixels. */
  class View(val cx: Double, val cy: Double, val zoom: Double, val worldPx: Double, val width: Int, val height: Int)

  class Style(private val density: Float) {
    private fun stroke(r: Int, g: Int, b: Int, w: Float) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.rgb(r, g, b)
      strokeWidth = w * density
      strokeCap = Paint.Cap.ROUND
    }

    // drawn in this order: faint first
    val layers = listOf(
      RIVER to stroke(36, 64, 82, 0.8f),
      ROAD to stroke(92, 78, 58, 1f),
      STATE to stroke(78, 84, 100, 0.9f),
      LAKE to stroke(52, 92, 112, 1f),
      COAST to stroke(64, 110, 128, 1.3f),
      COUNTRY to stroke(120, 120, 140, 1.3f),
    )
    val runway = stroke(150, 156, 168, 3.5f).apply { strokeCap = Paint.Cap.BUTT }
    val cityDot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(130, 140, 152) }
    val city = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.rgb(150, 158, 168)
      textSize = 11 * density
    }
    val airport = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.rgb(222, 170, 52)
      textSize = 10 * density
      isFakeBoldText = true
    }
    val airportDot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(222, 170, 52) }
    val dot = 2.2f * density
    val minSeg2 = (1.5f * density) * (1.5f * density) // skip points closer than this on screen
  }

  private var seg = FloatArray(16384)
  private val placed = ArrayList<RectF>()

  /** Draws the outline map for [v]. Main thread only. */
  fun draw(canvas: Canvas, v: View, s: Style, density: Float) {
    if (!loaded) return
    val coarse = v.zoom < 6.5
    for ((id, paint) in s.layers) {
      val l = (if (coarse) lines[id or COARSE] else null) ?: lines[id] ?: continue
      drawLines(canvas, l, v, paint, s.minSeg2)
    }
    if (v.zoom >= 9) lines[RUNWAY]?.let { drawLines(canvas, it, v, s.runway, 0f) }
    placed.clear()
    points[AIRPORT]?.let { drawLabels(canvas, it, v, s.airport, s.airportDot, s.dot, density) }
    points[CITY]?.let { drawLabels(canvas, it, v, s.city, s.cityDot, s.dot, density) }
  }

  private fun drawLines(canvas: Canvas, l: Lines, v: View, paint: Paint, minSeg2: Float) {
    val w = v.worldPx
    val hw = v.width / 2.0
    val hh = v.height / 2.0
    val vx0 = v.cx - hw / w
    val vx1 = v.cx + hw / w
    val vy0 = v.cy - hh / w
    val vy1 = v.cy + hh / w
    val right = v.width.toFloat()
    val bottom = v.height.toFloat()
    val z = v.zoom
    val xy = l.xy
    val bb = l.bbox
    var n = 0
    for (f in 0 until l.minZoom.size) {
      if (l.minZoom[f] > z) continue
      if (bb[f * 4 + 1] > vy1 || bb[f * 4 + 3] < vy0) continue
      // the copy of the world (left, here, right) that overlaps the view, if any
      val off = when {
        bb[f * 4] <= vx1 && bb[f * 4 + 2] >= vx0 -> 0.0
        bb[f * 4] - 1 <= vx1 && bb[f * 4 + 2] - 1 >= vx0 -> -1.0
        bb[f * 4] + 1 <= vx1 && bb[f * 4 + 2] + 1 >= vx0 -> 1.0
        else -> continue
      }
      val s = l.start[f]
      val e = l.start[f + 1]
      var px = ((xy[2 * s] + off - v.cx) * w + hw).toFloat()
      var py = ((xy[2 * s + 1] - v.cy) * w + hh).toFloat()
      for (k in s + 1 until e) {
        val x = ((xy[2 * k] + off - v.cx) * w + hw).toFloat()
        val y = ((xy[2 * k + 1] - v.cy) * w + hh).toFloat()
        val dx = x - px
        val dy = y - py
        if (dx * dx + dy * dy < minSeg2 && k < e - 1) continue
        // skip segments wholly off one side of the screen
        if (!((px < 0 && x < 0) || (px > right && x > right) || (py < 0 && y < 0) || (py > bottom && y > bottom))) {
          if (n + 4 > seg.size) seg = seg.copyOf(seg.size * 2)
          seg[n] = px
          seg[n + 1] = py
          seg[n + 2] = x
          seg[n + 3] = y
          n += 4
        }
        px = x
        py = y
      }
    }
    if (n > 0) canvas.drawLines(seg, 0, n, paint)
  }

  /** Dots with names, skipping any whose label would overlap one already placed (points are sorted by importance). */
  private fun drawLabels(canvas: Canvas, p: Points, v: View, text: Paint, dotPaint: Paint, dot: Float, density: Float) {
    val w = v.worldPx
    val hw = v.width / 2.0
    val hh = v.height / 2.0
    val pad = 3 * density
    for (i in p.x.indices) {
      if (p.minZoom[i] > v.zoom) continue
      var dx = p.x[i] - v.cx
      if (dx > 0.5) dx -= 1.0 else if (dx < -0.5) dx += 1.0
      val x = (dx * w + hw).toFloat()
      val y = ((p.y[i] - v.cy) * w + hh).toFloat()
      if (x < -50 * density || y < -20 * density || x > v.width + 50 * density || y > v.height + 20 * density) continue
      val name = p.names[i]
      var tw = p.widths[i]
      if (tw < 0) {
        tw = text.measureText(name)
        p.widths[i] = tw
      }
      val r = RectF(x + dot + pad - 2, y - text.textSize, x + dot + pad + tw + 2, y + 3 * density)
      if (placed.any { RectF.intersects(it, r) }) continue
      placed.add(r)
      canvas.drawCircle(x, y, dot, dotPaint)
      canvas.drawText(name, x + dot + pad, y + text.textSize * 0.35f, text)
    }
  }
}
