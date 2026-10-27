package expo.modules.rtlradio

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.LruCache
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.rtlradio.dsp.Plane
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sinh
import kotlin.math.tan

/** Hosts the plane map (a module can define only one native view). */
class RtlMapModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RtlRadioMap")

    /** "streets" (OSM tiles, the outline map wherever none are cached offline) or "outline" (offline only). */
    Function("getStyle") {
      val ctx = appContext.reactContext ?: return@Function "streets"
      ctx.getSharedPreferences("tarang_map", Context.MODE_PRIVATE).getString("style", "streets")
    }

    View(RadarView::class) {
      Events("onSelect")
      Prop("selected") { view: RadarView, hex: String? -> view.setSelected(hex) }
      Prop("focus") { view: RadarView, focus: Map<String, Any?>? -> view.setFocus(focus) }
      Prop("basemap") { view: RadarView, style: String? -> view.setBasemap(style) }
    }
  }
}

/**
 * Live plane map, drawn natively from the engine's once-a-second [RadioEngine.PlanesFrame]: OpenStreetMap tiles
 * (darkened on the GPU, cached on disk) or the bundled offline outline map ([Basemap]), which also fills in
 * wherever no tile is cached and the phone is offline. On top: range rings around the phone, trails and aircraft
 * coloured by altitude like dump1090's SkyAware map. Drag to pan, pinch or double-tap to zoom, tap a plane to
 * select it (onSelect, with hex "" for a tap on empty map).
 */
class RadarView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  companion object {
    // OSM's standard tiles: free for interactive use with a real User-Agent, attribution and local caching, but no
    // prefetching or "download for offline" (https://operations.osmfoundation.org/policies/tiles/). Offline, the map
    // shows tiles it has already cached plus the bundled outline map.
    private const val TILE_URL = "https://tile.openstreetmap.org/%d/%d/%d.png"
    private const val TILE_PX = 256
    private const val MIN_ZOOM = 2.0
    private const val MAX_ZOOM = 16.0
    private const val TILE_MAX_AGE_MS = 30L * 24 * 3600 * 1000 // then revalidated (If-Modified-Since)
    private const val TILE_CACHE_BYTES = 300L * 1024 * 1024
    @Volatile private var trimmed = false

    // shared by every map instance: decoded tiles, in-flight fetches, recent failures
    private val tiles = object : LruCache<Long, Bitmap>(40 * 1024 * 1024) {
      override fun sizeOf(key: Long, value: Bitmap) = value.byteCount
    }
    private val inFlight = HashSet<Long>()
    private val failedAt = HashMap<Long, Long>()
    private val fetcher = Executors.newFixedThreadPool(2) // the tile policy's limit

    // light OSM tiles -> dark: invert, rotate hue 180 degrees (so water stays blue), mute and dim
    private val DARK = ColorMatrixColorFilter(
      ColorMatrix(floatArrayOf(-1f, 0f, 0f, 0f, 255f, 0f, -1f, 0f, 0f, 255f, 0f, 0f, -1f, 0f, 255f, 0f, 0f, 0f, 1f, 0f)).apply {
        postConcat(
          ColorMatrix(
            floatArrayOf(
              -0.574f, 1.430f, 0.144f, 0f, 0f, 0.426f, 0.430f, 0.144f, 0f, 0f, 0.426f, 1.430f, -0.856f, 0f, 0f, 0f, 0f, 0f, 1f, 0f,
            ),
          ),
        )
        postConcat(ColorMatrix().apply { setSaturation(0.5f) })
        postConcat(ColorMatrix(floatArrayOf(0.8f, 0f, 0f, 0f, 4f, 0f, 0.84f, 0f, 0f, 7f, 0f, 0f, 0.92f, 0f, 12f, 0f, 0f, 0f, 1f, 0f)))
      },
    )

    private fun key(z: Int, x: Int, y: Int) = (z.toLong() shl 48) or (x.toLong() shl 24) or y.toLong()

    private fun lonToX(lon: Double) = (lon + 180.0) / 360.0
    private fun latToY(lat: Double): Double {
      val r = Math.toRadians(lat.coerceIn(-85.0, 85.0))
      return (1 - ln(tan(r) + 1 / cos(r)) / PI) / 2
    }
    private fun xToLon(x: Double) = x * 360.0 - 180.0
    private fun yToLat(y: Double) = Math.toDegrees(atan(sinh(PI * (1 - 2 * y))))

    /** SkyAware's altitude colours: orange near the ground through green and blue to magenta at 40,000 ft. */
    fun altitudeColor(alt: Int?, ground: Boolean, alpha: Int = 255): Int {
      if (ground) return Color.argb(alpha, 150, 150, 150)
      if (alt == null || alt < 0) return Color.argb(alpha, 190, 190, 190)
      val h = when {
        alt <= 2000 -> 20.0
        alt <= 10000 -> 20.0 + (alt - 2000) * 120.0 / 8000
        alt <= 40000 -> 140.0 + (alt - 10000) * 160.0 / 30000
        else -> 300.0
      }
      return hsl(h, 0.85, 0.52, alpha)
    }

    private fun hsl(h: Double, s: Double, l: Double, alpha: Int): Int {
      val c = (1 - kotlin.math.abs(2 * l - 1)) * s
      val hp = h / 60
      val x = c * (1 - kotlin.math.abs(hp % 2 - 1))
      val (r, g, b) = when {
        hp < 1 -> Triple(c, x, 0.0)
        hp < 2 -> Triple(x, c, 0.0)
        hp < 3 -> Triple(0.0, c, x)
        hp < 4 -> Triple(0.0, x, c)
        hp < 5 -> Triple(x, 0.0, c)
        else -> Triple(c, 0.0, x)
      }
      val m = l - c / 2
      return Color.argb(alpha, ((r + m) * 255).roundToInt(), ((g + m) * 255).roundToInt(), ((b + m) * 255).roundToInt())
    }
  }

  private val onSelect by EventDispatcher()
  private val density = resources.displayMetrics.density
  private val main = Handler(Looper.getMainLooper())
  private val prefs = context.getSharedPreferences("tarang_map", Context.MODE_PRIVATE)
  // in files, not cache: Android may empty the cache dir, and these are the map when offline
  private val tileDir = File(context.filesDir, "osm-tiles").apply { mkdirs() }
  private val outline = Basemap.Style(density)
  private var style = prefs.getString("style", "streets") ?: "streets"

  // camera: centre in Mercator units (0..1) and zoom
  private var cx = lonToX(-80.84)
  private var cy = latToY(35.22)
  private var zoom = 8.0
  private var cameraSet = false

  private var frame: RadioEngine.PlanesFrame? = RadioEngine.planesFrame
  private var selected: String? = null
  private var focusToken: Any? = null

  private val tilePaint = Paint(Paint.FILTER_BITMAP_FLAG).apply { colorFilter = DARK }
  private val bg = Paint().apply { color = Color.rgb(14, 17, 22) }
  private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(110, 63, 208, 201)
    style = Paint.Style.STROKE
    strokeWidth = 1f * density
  }
  private val ringText = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(170, 63, 208, 201); textSize = 10 * density }
  private val me = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(77, 163, 255) }
  private val meEdge = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.STROKE; strokeWidth = 2 * density }
  private val trail = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeWidth = 2f * density; strokeCap = Paint.Cap.ROUND }
  private val planeFill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val planeEdge = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = 1.2f * density
    color = Color.argb(220, 0, 0, 0)
    strokeJoin = Paint.Join.ROUND
  }
  private val selEdge = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2.2f * density; color = Color.WHITE }
  private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(230, 237, 243); textSize = 11 * density; isFakeBoldText = true }
  private val labelHalo = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(230, 10, 13, 17)
    textSize = 11 * density
    isFakeBoldText = true
    style = Paint.Style.STROKE
    strokeWidth = 3 * density
  }
  private val attrib = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(200, 160, 168, 178); textSize = 9 * density }
  private val attribBg = Paint().apply { color = Color.argb(150, 10, 13, 17) }
  private val src = Rect()
  private val dst = RectF()

  // a plane pointing north, about 22 dp long, centred on its middle
  private val planePath = Path().apply {
    val u = density
    moveTo(0f, -11f * u)
    lineTo(1.6f * u, -6f * u); lineTo(1.6f * u, -2f * u); lineTo(10f * u, 3f * u); lineTo(10f * u, 5f * u)
    lineTo(1.6f * u, 2.5f * u); lineTo(1.4f * u, 7.5f * u); lineTo(4.2f * u, 10f * u); lineTo(4.2f * u, 11.5f * u)
    lineTo(0f, 10.3f * u)
    lineTo(-4.2f * u, 11.5f * u); lineTo(-4.2f * u, 10f * u); lineTo(-1.4f * u, 7.5f * u); lineTo(-1.6f * u, 2.5f * u)
    lineTo(-10f * u, 5f * u); lineTo(-10f * u, 3f * u); lineTo(-1.6f * u, -2f * u); lineTo(-1.6f * u, -6f * u)
    close()
  }

  private val listener: () -> Unit = {
    val f = RadioEngine.planesFrame
    main.post {
      frame = f
      maybeCentreOnTraffic()
      invalidate()
    }
  }

  private val saveCamera = Runnable {
    prefs.edit().putFloat("x", cx.toFloat()).putFloat("y", cy.toFloat()).putFloat("z", zoom.toFloat()).apply()
  }

  init {
    setWillNotDraw(false)
    if (prefs.contains("z")) {
      cx = prefs.getFloat("x", cx.toFloat()).toDouble()
      cy = prefs.getFloat("y", cy.toFloat()).toDouble()
      zoom = prefs.getFloat("z", zoom.toFloat()).toDouble()
      cameraSet = true
    } else {
      val lat = RadioEngine.rxLat
      val lon = RadioEngine.rxLon
      if (lat != null && lon != null) {
        cx = lonToX(lon)
        cy = latToY(lat)
        cameraSet = true
      }
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    RadioEngine.addPlanesListener(listener)
    frame = RadioEngine.planesFrame
    Basemap.load(context) { invalidate() }
    if (!trimmed) {
      trimmed = true
      val old = File(context.cacheDir, "osm-tiles") // where 1.1 kept them
      fetcher.execute {
        old.deleteRecursively()
        trimTileCache(tileDir)
      }
    }
    invalidate()
  }

  /** Keeps the tile cache under its cap, dropping the tiles fetched longest ago. */
  private fun trimTileCache(dir: File) {
    val files = dir.listFiles() ?: return
    var total = files.sumOf { it.length() }
    if (total <= TILE_CACHE_BYTES) return
    for (f in files.sortedBy { it.lastModified() }) {
      total -= f.length()
      f.delete()
      if (total <= TILE_CACHE_BYTES * 9 / 10) break
    }
  }

  override fun onDetachedFromWindow() {
    RadioEngine.removePlanesListener(listener)
    main.removeCallbacks(saveCamera)
    saveCamera.run()
    super.onDetachedFromWindow()
  }

  fun setBasemap(s: String?) {
    val v = if (s == "outline") "outline" else "streets"
    if (v == style) return
    style = v
    prefs.edit().putString("style", v).apply()
    invalidate()
  }

  fun setSelected(hex: String?) {
    selected = hex
    invalidate()
  }

  /** { lat, lon, zoom?, token }: moves the camera once per token (JS's "centre on me" / "show this plane"). */
  fun setFocus(focus: Map<String, Any?>?) {
    if (focus == null || focus["token"] == focusToken) return
    focusToken = focus["token"]
    val lat = (focus["lat"] as? Number)?.toDouble() ?: return
    val lon = (focus["lon"] as? Number)?.toDouble() ?: return
    cx = lonToX(lon)
    cy = latToY(lat)
    (focus["zoom"] as? Number)?.let { zoom = it.toDouble().coerceIn(MIN_ZOOM, MAX_ZOOM) }
    cameraSet = true
    cameraMoved()
  }

  /** With no saved camera and no location, look at wherever the first planes turn up. */
  private fun maybeCentreOnTraffic() {
    if (cameraSet) return
    val f = frame ?: return
    val lat = f.rxLat
    val lon = f.rxLon
    if (lat != null && lon != null) {
      cx = lonToX(lon)
      cy = latToY(lat)
      cameraSet = true
      return
    }
    val pos = f.planes.filter { it.hasPos }
    if (pos.isEmpty()) return
    cx = pos.map { lonToX(it.lon) }.average()
    cy = pos.map { latToY(it.lat) }.average()
    cameraSet = true
  }

  private fun cameraMoved() {
    main.removeCallbacks(saveCamera)
    main.postDelayed(saveCamera, 1500)
    invalidate()
  }

  // ---------- projection ----------

  private val worldPx: Double get() = 256.0 * density * 2.0.pow(zoom)

  private fun screenX(mx: Double): Float {
    var d = mx - cx
    if (d > 0.5) d -= 1.0 else if (d < -0.5) d += 1.0 // nearest copy of the world
    return (width / 2.0 + d * worldPx).toFloat()
  }

  private fun screenY(my: Double): Float = (height / 2.0 + (my - cy) * worldPx).toFloat()

  // ---------- gestures ----------

  private val scaleDetector = ScaleGestureDetector(
    context,
    object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
      override fun onScale(d: ScaleGestureDetector): Boolean {
        zoomAround(d.focusX, d.focusY, ln(d.scaleFactor.toDouble()) / ln(2.0))
        return true
      }
    },
  )

  private val gestureDetector = GestureDetector(
    context,
    object : GestureDetector.SimpleOnGestureListener() {
      override fun onDown(e: MotionEvent) = true

      override fun onScroll(e1: MotionEvent?, e2: MotionEvent, dx: Float, dy: Float): Boolean {
        if (scaleDetector.isInProgress) return true
        cx = ((cx + dx / worldPx) % 1.0 + 1.0) % 1.0
        cy = (cy + dy / worldPx).coerceIn(0.0, 1.0)
        cameraSet = true
        cameraMoved()
        return true
      }

      override fun onDoubleTap(e: MotionEvent): Boolean {
        zoomAround(e.x, e.y, 1.0)
        return true
      }

      override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
        val hit = planeAt(e.x, e.y)
        selected = hit?.hex
        onSelect(mapOf("hex" to (hit?.hex ?: ""))) // "" = nothing selected
        invalidate()
        return true
      }
    },
  )

  private fun zoomAround(fx: Float, fy: Float, dz: Double) {
    val z = (zoom + dz).coerceIn(MIN_ZOOM, MAX_ZOOM)
    if (z == zoom) return
    // keep the point under the fingers where it is
    val mx = cx + (fx - width / 2.0) / worldPx
    val my = cy + (fy - height / 2.0) / worldPx
    zoom = z
    cx = mx - (fx - width / 2.0) / worldPx
    cy = my - (fy - height / 2.0) / worldPx
    cameraSet = true
    cameraMoved()
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) parent?.requestDisallowInterceptTouchEvent(true)
    scaleDetector.onTouchEvent(event)
    gestureDetector.onTouchEvent(event)
    return true
  }

  private fun planeAt(x: Float, y: Float): Plane? {
    val f = frame ?: return null
    var best: Plane? = null
    var bestD = 26 * density
    for (p in f.planes) {
      if (!p.hasPos) continue
      val d = hypot(screenX(lonToX(p.lon)) - x, screenY(latToY(p.lat)) - y)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best
  }

  // ---------- tiles ----------

  private fun tile(z: Int, x: Int, y: Int): Bitmap? {
    val k = key(z, x, y)
    tiles.get(k)?.let { return it }
    synchronized(inFlight) {
      if (k in inFlight) return null
      val failed = failedAt[k]
      if (failed != null && SystemClock.elapsedRealtime() - failed < 20_000) return null
      inFlight.add(k)
    }
    fetcher.execute { fetch(z, x, y, k) }
    return null
  }

  private fun fetch(z: Int, x: Int, y: Int, k: Long) {
    var bmp: Bitmap? = null
    val file = File(tileDir, "${z}_${x}_$y.png")
    val cached = file.exists()
    try {
      if (cached && System.currentTimeMillis() - file.lastModified() < TILE_MAX_AGE_MS) {
        bmp = decode(file.readBytes())
      }
      if (bmp == null) {
        val conn = URL(TILE_URL.format(z, x, y)).openConnection() as HttpURLConnection
        conn.connectTimeout = 8000
        conn.readTimeout = 10000
        conn.setRequestProperty("User-Agent", "Tarang/1.2 (personal Android RTL-SDR radio app)")
        if (cached) conn.ifModifiedSince = file.lastModified()
        try {
          when (conn.responseCode) {
            200 -> {
              val bytes = conn.inputStream.use { it.readBytes() }
              bmp = decode(bytes)
              if (bmp != null) file.writeBytes(bytes)
            }
            304 -> {
              file.setLastModified(System.currentTimeMillis())
              bmp = decode(file.readBytes())
            }
          }
        } finally {
          conn.disconnect()
        }
      }
    } catch (_: Exception) {
    }
    if (bmp == null && cached) {
      // offline (or the server is unhappy): an old tile beats no tile
      bmp = try {
        decode(file.readBytes())
      } catch (_: Exception) {
        null
      }
    }
    synchronized(inFlight) {
      inFlight.remove(k)
      if (bmp == null) failedAt[k] = SystemClock.elapsedRealtime() else failedAt.remove(k)
    }
    if (bmp != null) {
      tiles.put(k, bmp)
      postInvalidateOnAnimation()
    }
  }

  private fun decode(bytes: ByteArray): Bitmap? =
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.RGB_565 })

  /** Draws the tiles (or only counts, with [draw] false); returns how many visible cells have nothing to show. */
  private fun drawTiles(canvas: Canvas, draw: Boolean): Int {
    // a tile spans 150-300 dp: sharper than OSM's 256 px at 1 dp each, labels still readable
    val z = (zoom + 0.3).roundToInt().coerceIn(MIN_ZOOM.toInt(), MAX_ZOOM.toInt() + 1)
    val n = 1 shl z
    val size = worldPx / n // on-screen size of one tile
    val left = cx * n - width / 2.0 / size
    val top = cy * n - height / 2.0 / size
    val x0 = floor(left).toInt()
    val y0 = floor(top).toInt()
    val x1 = floor(left + width / size).toInt()
    val y1 = floor(top + height / size).toInt()
    var missing = 0
    for (ty in max(y0, 0)..min(y1, n - 1)) {
      for (tx in x0..x1) {
        val wx = ((tx % n) + n) % n
        dst.set(
          ((tx - left) * size).toFloat(), ((ty - top) * size).toFloat(),
          ((tx + 1 - left) * size).toFloat() + 0.5f, ((ty + 1 - top) * size).toFloat() + 0.5f,
        )
        val bmp = tile(z, wx, ty)
        if (bmp != null) {
          if (draw) canvas.drawBitmap(bmp, null, dst, tilePaint)
          continue
        }
        // until it arrives, stretch the closest cached ancestor over the gap
        var covered = false
        for (up in 1..4) {
          val pz = z - up
          if (pz < 0) break
          val parent = tiles.get(key(pz, wx shr up, ty shr up)) ?: continue
          val part = TILE_PX shr up
          val sx = (wx and ((1 shl up) - 1)) * part
          val sy = (ty and ((1 shl up) - 1)) * part
          src.set(sx, sy, sx + part, sy + part)
          if (draw) canvas.drawBitmap(parent, src, dst, tilePaint)
          covered = true
          break
        }
        if (!covered) missing++
      }
    }
    return missing
  }

  // ---------- overlays ----------

  private fun drawRings(canvas: Canvas, lat: Double, lon: Double) {
    val x = screenX(lonToX(lon))
    val y = screenY(latToY(lat))
    val metersPerPx = cos(Math.toRadians(lat)) * 40_075_016.0 / worldPx
    val nmPx = 1852.0 / metersPerPx
    val step = listOf(1, 2, 5, 10, 25, 50, 100, 200, 500).firstOrNull { it * nmPx >= 64 * density } ?: 500
    for (i in 1..6) {
      val r = (i * step * nmPx).toFloat()
      if (r > hypot(width.toFloat(), height.toFloat()) + hypot(x - width / 2f, y - height / 2f)) break
      canvas.drawCircle(x, y, r, ring)
      canvas.drawText("${i * step} nm", x + 4 * density, y - r - 3 * density, ringText)
    }
    canvas.drawCircle(x, y, 5.5f * density, me)
    canvas.drawCircle(x, y, 5.5f * density, meEdge)
  }

  private fun drawTrail(canvas: Canvas, pts: FloatArray, ground: Boolean, from: Int) {
    var i = max(from, 0)
    while (i + 1 < pts.size / 3) {
      val a = i * 3
      val b = a + 3
      val alt = pts[b + 2].toInt()
      trail.color = altitudeColor(if (alt < 0) null else alt, ground || alt == 0, 190)
      canvas.drawLine(
        screenX(lonToX(pts[a + 1].toDouble())), screenY(latToY(pts[a].toDouble())),
        screenX(lonToX(pts[b + 1].toDouble())), screenY(latToY(pts[b].toDouble())), trail,
      )
      i++
    }
  }

  private fun drawPlane(canvas: Canvas, p: Plane, sel: Boolean) {
    val x = screenX(lonToX(p.lon))
    val y = screenY(latToY(p.lat))
    if (x < -40 * density || y < -40 * density || x > width + 40 * density || y > height + 40 * density) return
    val stale = p.posAgoMs > 15_000
    val alpha = if (stale) 110 else 255
    planeFill.color = altitudeColor(p.alt, p.ground, alpha)
    planeEdge.alpha = if (stale) 110 else 220
    canvas.save()
    canvas.translate(x, y)
    val s = if (sel) 1.25f else 1f
    canvas.scale(s, s)
    canvas.rotate(p.track ?: p.heading ?: 0f)
    canvas.drawPath(planePath, planeFill)
    canvas.drawPath(planePath, if (sel) selEdge else planeEdge)
    canvas.restore()
    if (sel || zoom >= 7.5) {
      val name = p.flight.ifEmpty { p.hex.uppercase() }
      val alt = when {
        p.ground -> "GND"
        p.alt == null -> ""
        p.alt >= 18000 -> "FL%03d".format((p.alt + 50) / 100)
        else -> "%,d ft".format(p.alt)
      }
      val tx = x + 14 * density
      canvas.drawText(name, tx, y - 1 * density, labelHalo)
      canvas.drawText(name, tx, y - 1 * density, label)
      if (alt.isNotEmpty()) {
        canvas.drawText(alt, tx, y + 11 * density, labelHalo)
        canvas.drawText(alt, tx, y + 11 * density, label)
      }
    }
  }

  override fun onDraw(canvas: Canvas) {
    canvas.clipRect(0, 0, width, height) // React Native parents don't clip their children
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bg)
    val streets = style == "streets"
    // the outline map shows through wherever no tile (or stretched ancestor) is available, e.g. offline
    val gaps = !streets || drawTiles(canvas, draw = false) > 0
    if (gaps) Basemap.draw(canvas, Basemap.View(cx, cy, zoom, worldPx, width, height), outline, density)
    if (streets) drawTiles(canvas, draw = true)
    val f = frame
    val lat = f?.rxLat ?: RadioEngine.rxLat
    val lon = f?.rxLon ?: RadioEngine.rxLon
    if (lat != null && lon != null) drawRings(canvas, lat, lon)
    if (f != null) {
      val sel = selected
      for ((icao, pts) in f.trails) {
        val p = f.planes.firstOrNull { it.icao == icao } ?: continue
        // every plane gets its recent path; the selected one its whole track
        drawTrail(canvas, pts, p.ground, if (p.hex == sel) 0 else pts.size / 3 - 25)
      }
      var selPlane: Plane? = null
      for (p in f.planes) {
        if (!p.hasPos) continue
        if (p.hex == sel) selPlane = p else drawPlane(canvas, p, false)
      }
      selPlane?.let { drawPlane(canvas, it, true) } // on top
    }
    val text = when {
      !streets -> "Natural Earth · OurAirports"
      gaps -> "© OpenStreetMap contributors · Natural Earth"
      else -> "© OpenStreetMap contributors"
    }
    val w = attrib.measureText(text)
    val pad = 4 * density
    canvas.drawRect(width - w - 2 * pad, height - 14 * density, width.toFloat(), height.toFloat(), attribBg)
    canvas.drawText(text, width - w - pad, height - 4 * density, attrib)
  }
}
