package expo.modules.rtlradio

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.rtlradio.dsp.Plane
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.module.http.HttpRequestUtil
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point
import java.io.File
import java.util.Collections
import java.util.WeakHashMap
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/** Hosts the plane map (a module can define only one native view) and the offline map download. */
class RtlMapModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RtlRadioMap")
    Events("onMapDownload")

    /** "streets" (OSM tiles over the offline map) or "outline" (the offline map alone). */
    Function("getStyle") {
      val ctx = appContext.reactContext ?: return@Function "streets"
      ctx.getSharedPreferences("tarang_map", Context.MODE_PRIVATE).getString("style", "streets")
    }

    /** The region setting ("auto" or a region id from src/regions.json); persisted here so JS can read it synchronously. */
    Function("getRegion") {
      val ctx = appContext.reactContext ?: return@Function "auto"
      ctx.getSharedPreferences("tarang_map", Context.MODE_PRIVATE).getString("region", "auto")
    }
    Function("saveRegion") { region: String ->
      appContext.reactContext?.getSharedPreferences("tarang_map", Context.MODE_PRIVATE)?.edit()?.putString("region", region)?.apply()
    }

    Function("offlineMaps") {
      val ctx = appContext.reactContext ?: return@Function null
      MapDownloader.status(ctx)
    }

    /** Downloads every missing area (Wi-Fi recommended: ~260 MB); progress arrives as onMapDownload events. */
    AsyncFunction("downloadOfflineMaps") { promise: Promise ->
      val ctx = appContext.reactContext ?: return@AsyncFunction promise.reject("ERR_NO_CONTEXT", "No context", null)
      Thread({
        var lastSent = 0L
        try {
          MapDownloader.download(ctx) { phase, done, total ->
            val now = SystemClock.elapsedRealtime()
            if (now - lastSent > 250 || done == total) {
              lastSent = now
              sendEvent("onMapDownload", mapOf("phase" to phase, "done" to done.toDouble(), "total" to total.toDouble()))
            }
          }
          RadarView.mapsChanged()
          promise.resolve(MapDownloader.status(ctx))
        } catch (e: Throwable) {
          RadarView.mapsChanged() // finished areas are usable even if a later one failed
          promise.reject("ERR_MAP_DOWNLOAD", e.message ?: e.toString(), e)
        }
      }, "map-download").start()
    }

    Function("cancelMapDownload") { MapDownloader.cancel() }

    Function("deleteOfflineMaps") {
      val ctx = appContext.reactContext ?: return@Function null
      MapDownloader.delete(ctx)
      RadarView.mapsChanged()
      null
    }

    View(RadarView::class) {
      Events("onSelect")
      Prop("selected") { view: RadarView, hex: String? -> view.setSelected(hex) }
      Prop("focus") { view: RadarView, focus: Map<String, Any?>? -> view.setFocus(focus) }
      Prop("basemap") { view: RadarView, style: String? -> view.setBasemap(style) }
      /** Extra points to draw (e.g. APRS stations): a GeoJSON FeatureCollection string; properties label, color. */
      Prop("overlay") { view: RadarView, geojson: String? -> view.setOverlay(geojson) }
      OnViewDestroys { view: RadarView -> view.destroy() }
    }
  }
}

/**
 * Live plane map on MapLibre Native (GPU): the offline vector map downloaded by [MapDownloader] (Protomaps/OSM, one
 * PMTiles archive per area, coarse to fine; the bundled z0-4 world until then), optionally with OpenStreetMap
 * raster tiles on top ("streets", darkened on the GPU; the vector map shows through wherever no tile is cached and the
 * phone is offline). On top: range rings around the phone, trails and aircraft coloured by altitude like dump1090's
 * SkyAware map, fed by the engine's once-a-second [RadioEngine.PlanesFrame]. Tap a plane to select it (onSelect, hex
 * "" for empty map).
 */
class RadarView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  companion object {
    // OSM's standard tiles: free for interactive use with a real User-Agent, attribution and caching, but no
    // prefetching or "download for offline" (https://operations.osmfoundation.org/policies/tiles/).
    private const val OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    private const val UA = "Tarang/1.4 (personal Android RTL-SDR radio app)"
    private val RINGS_NM = intArrayOf(5, 10, 25, 50, 100, 150, 200, 250)
    private const val TRAIL_POINTS = 25

    private val live = Collections.newSetFromMap(WeakHashMap<RadarView, Boolean>())
    private var initialised = false

    /** The offline map files changed (download finished or deleted): reload every open map. */
    fun mapsChanged() {
      Handler(Looper.getMainLooper()).post { synchronized(live) { live.toList() }.forEach { it.loadStyle() } }
    }

    private fun init(ctx: Context) {
      if (initialised) return
      initialised = true
      MapLibre.getInstance(ctx.applicationContext)
      // OSM asks for an identifying User-Agent
      HttpRequestUtil.setOkHttpClient(
        OkHttpClient.Builder().addInterceptor { chain ->
          chain.proceed(chain.request().newBuilder().header("User-Agent", UA).build())
        }.build(),
      )
    }

    /** SkyAware's altitude colours: orange near the ground through green and blue to magenta at 40,000 ft. */
    fun altitudeColor(alt: Int?, ground: Boolean): Int {
      if (ground) return Color.rgb(150, 150, 150)
      if (alt == null || alt < 0) return Color.rgb(190, 190, 190)
      val h = when {
        alt <= 2000 -> 20.0
        alt <= 10000 -> 20.0 + (alt - 2000) * 120.0 / 8000
        alt <= 40000 -> 140.0 + (alt - 10000) * 160.0 / 30000
        else -> 300.0
      }
      return hsl(h, 0.85, 0.52)
    }

    private fun hsl(h: Double, s: Double, l: Double): Int {
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
      return Color.rgb(((r + m) * 255).roundToInt(), ((g + m) * 255).roundToInt(), ((b + m) * 255).roundToInt())
    }

    private fun hex(c: Int) = "#%06x".format(c and 0xffffff)
  }

  override val shouldUseAndroidLayout = true

  private val onSelect by EventDispatcher()
  private val density = resources.displayMetrics.density
  private val prefs = context.getSharedPreferences("tarang_map", Context.MODE_PRIVATE)
  private var style = prefs.getString("style", "streets") ?: "streets"
  private var frame: RadioEngine.PlanesFrame? = RadioEngine.planesFrame
  private var selected: String? = null
  private var focusToken: Any? = null
  private var cameraSet = false
  private var overlayJson: String? = null
  private var map: MapLibreMap? = null
  private var loaded: Style? = null
  private var destroyed = false
  private var ringsAt: Pair<Double, Double>? = null

  private val mapView: MapView

  private val listener: () -> Unit = {
    val f = RadioEngine.planesFrame
    post {
      frame = f
      maybeCentreOnTraffic()
      updatePlanes()
    }
  }

  init {
    init(context)
    val opts = MapLibreMapOptions.createFromAttributes(context).textureMode(true).logoEnabled(false).compassEnabled(false)
      // attribution "i" top right, under the JS "centre on me" button (the bottom corners hold the JS controls)
      .attributionEnabled(true).attributionGravity(Gravity.TOP or Gravity.END)
      .attributionMargins(intArrayOf(0, (58 * density).roundToInt(), (18 * density).roundToInt(), 0))
    mapView = MapView(context, opts)
    mapView.onCreate(null)
    addView(mapView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    synchronized(live) { live.add(this) }
    mapView.getMapAsync { m ->
      map = m
      m.uiSettings.isRotateGesturesEnabled = false
      m.uiSettings.isTiltGesturesEnabled = false
      m.uiSettings.isCompassEnabled = false
      m.setMinZoomPreference(1.0)
      m.setMaxZoomPreference(17.0)
      m.cameraPosition = initialCamera()
      m.addOnCameraIdleListener {
        val c = m.cameraPosition
        val t = c.target ?: return@addOnCameraIdleListener
        prefs.edit().putFloat("lat", t.latitude.toFloat()).putFloat("lon", t.longitude.toFloat()).putFloat("zoom", c.zoom.toFloat()).apply()
      }
      m.addOnMoveListener(object : MapLibreMap.OnMoveListener {
        override fun onMoveBegin(d: org.maplibre.android.gestures.MoveGestureDetector) {
          cameraSet = true
        }
        override fun onMove(d: org.maplibre.android.gestures.MoveGestureDetector) {}
        override fun onMoveEnd(d: org.maplibre.android.gestures.MoveGestureDetector) {}
      })
      m.addOnMapClickListener { ll ->
        val p = m.projection.toScreenLocation(ll)
        val r = 26 * density
        val hit = m.queryRenderedFeatures(RectF(p.x - r, p.y - r, p.x + r, p.y + r), "planes").firstOrNull()
        val h = hit?.getStringProperty("hex")
        selected = h
        onSelect(mapOf("hex" to (h ?: "")))
        updatePlanes()
        true
      }
      loadStyle()
    }
  }

  private fun initialCamera(): CameraPosition {
    val b = CameraPosition.Builder()
    when {
      prefs.contains("zoom") -> {
        cameraSet = true
        b.target(LatLng(prefs.getFloat("lat", 0f).toDouble(), prefs.getFloat("lon", 0f).toDouble())).zoom(prefs.getFloat("zoom", 8f).toDouble())
      }
      prefs.contains("z") -> { // 1.2 kept the camera in Mercator units
        cameraSet = true
        val x = prefs.getFloat("x", 0.5f).toDouble()
        val y = prefs.getFloat("y", 0.5f).toDouble()
        val lat = Math.toDegrees(kotlin.math.atan(kotlin.math.sinh(PI * (1 - 2 * y))))
        b.target(LatLng(lat, x * 360 - 180)).zoom(prefs.getFloat("z", 8f).toDouble())
      }
      RadioEngine.rxLat != null && RadioEngine.rxLon != null -> {
        cameraSet = true
        b.target(LatLng(RadioEngine.rxLat!!, RadioEngine.rxLon!!)).zoom(8.0)
      }
      else -> b.target(LatLng(20.0, 0.0)).zoom(1.5)
    }
    return b.build()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (destroyed) return
    mapView.onStart()
    mapView.onResume()
    RadioEngine.addPlanesListener(listener)
    frame = RadioEngine.planesFrame
    updatePlanes()
  }

  override fun onDetachedFromWindow() {
    RadioEngine.removePlanesListener(listener)
    if (!destroyed) {
      mapView.onPause()
      mapView.onStop()
    }
    super.onDetachedFromWindow()
  }

  fun destroy() {
    if (destroyed) return
    destroyed = true
    RadioEngine.removePlanesListener(listener)
    synchronized(live) { live.remove(this) }
    mapView.onDestroy()
  }

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    // keep React Native's scroll views from stealing the map's drags
    if (ev.actionMasked == MotionEvent.ACTION_DOWN) parent?.requestDisallowInterceptTouchEvent(true)
    return super.dispatchTouchEvent(ev)
  }

  // ---------- props ----------

  fun setBasemap(s: String?) {
    val v = if (s == "outline") "outline" else "streets"
    if (v == style) return
    style = v
    prefs.edit().putString("style", v).apply()
    loadStyle()
  }

  fun setSelected(hex: String?) {
    selected = hex
    updatePlanes()
  }

  /** { lat, lon, zoom?, token }: moves the camera once per token (JS's "centre on me" / "show this plane"). */
  fun setFocus(focus: Map<String, Any?>?) {
    if (focus == null || focus["token"] == focusToken) return
    focusToken = focus["token"]
    val lat = (focus["lat"] as? Number)?.toDouble() ?: return
    val lon = (focus["lon"] as? Number)?.toDouble() ?: return
    cameraSet = true
    val m = map
    if (m == null) { // map not ready yet: start there
      prefs.edit().putFloat("lat", lat.toFloat()).putFloat("lon", lon.toFloat())
        .putFloat("zoom", (focus["zoom"] as? Number)?.toFloat() ?: prefs.getFloat("zoom", 8f)).apply()
      return
    }
    val zoom = (focus["zoom"] as? Number)?.toDouble() ?: m.cameraPosition.zoom
    m.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(lat, lon), zoom), 600)
  }

  fun setOverlay(geojson: String?) {
    overlayJson = geojson
    val s = loaded ?: return
    (s.getSource("overlay") as? GeoJsonSource)?.setGeoJson(overlayJson ?: """{"type":"FeatureCollection","features":[]}""")
  }

  // ---------- style ----------

  /** The offline vector style with each area's archive (skipping areas not downloaded yet), plus OSM tiles for "streets". */
  private fun styleJson(): String {
    val ctx = context
    val dir = MapDownloader.dir(ctx)
    val json = JSONObject(ctx.assets.open("maps/style.json").use { it.readBytes().decodeToString() })
    json.put("glyphs", "asset://maps/fonts/{fontstack}/{range}.pbf")
    val sources = json.getJSONObject("sources")
    val drop = HashSet<String>()
    for (key in sources.keys().asSequence().toList()) {
      val src = sources.getJSONObject(key)
      val file = src.getString("url").substringAfterLast('/')
      val local = File(dir, file)
      when {
        local.isFile -> src.put("url", "pmtiles://file://${local.absolutePath}")
        file == "world.pmtiles" -> src.put("url", "pmtiles://file://${worldLite(ctx).absolutePath}")
        else -> drop.add(key)
      }
    }
    drop.forEach { sources.remove(it) }
    val layers = json.getJSONArray("layers")
    val kept = JSONArray()
    for (i in 0 until layers.length()) {
      val l = layers.getJSONObject(i)
      if (l.optString("source") !in drop) kept.put(l)
    }
    if (style == "streets") {
      sources.put("osm", JSONObject().put("type", "raster").put("tiles", JSONArray().put(OSM_TILES)).put("tileSize", 256)
        .put("maxzoom", 19).put("attribution", "© OpenStreetMap contributors"))
      // light OSM tiles -> dark: invert (brightness min > max), turn the hue back so water stays blue, mute
      kept.put(JSONObject().put("id", "osm").put("type", "raster").put("source", "osm").put("paint", JSONObject()
        .put("raster-brightness-min", 0.88).put("raster-brightness-max", 0.06).put("raster-hue-rotate", 180)
        .put("raster-saturation", -0.45).put("raster-contrast", 0.05)))
    }
    json.put("layers", kept)
    return json.toString()
  }

  /** The bundled z0-4 world, copied out of the APK once (this MapLibre reads PMTiles from files, not assets). */
  private fun worldLite(ctx: Context): File {
    val f = File(ctx.filesDir, "maps-lite/world-lite.pmtiles")
    val stamp = File(f.path + ".version")
    val version = ctx.packageManager.getPackageInfo(ctx.packageName, 0).lastUpdateTime.toString()
    if (!f.isFile || !stamp.isFile || stamp.readText() != version) {
      f.parentFile?.mkdirs()
      ctx.assets.open("maps/world-lite.pmtiles").use { i -> f.outputStream().use { i.copyTo(it) } }
      stamp.writeText(version)
    }
    return f
  }

  fun loadStyle() {
    val m = map ?: return
    if (destroyed) return
    loaded = null
    m.setStyle(Style.Builder().fromJson(styleJson())) { s ->
      loaded = s
      addOverlays(s)
      ringsAt = null
      updatePlanes()
      setOverlay(overlayJson)
    }
  }

  private fun planeBitmap(): Bitmap {
    // a plane pointing north, about 22 dp long; white so icon-color can tint it (SDF)
    val u = density
    val size = (28 * u).roundToInt()
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    c.translate(size / 2f, size / 2f)
    val path = Path().apply {
      moveTo(0f, -11f * u)
      lineTo(1.6f * u, -6f * u); lineTo(1.6f * u, -2f * u); lineTo(10f * u, 3f * u); lineTo(10f * u, 5f * u)
      lineTo(1.6f * u, 2.5f * u); lineTo(1.4f * u, 7.5f * u); lineTo(4.2f * u, 10f * u); lineTo(4.2f * u, 11.5f * u)
      lineTo(0f, 10.3f * u)
      lineTo(-4.2f * u, 11.5f * u); lineTo(-4.2f * u, 10f * u); lineTo(-1.4f * u, 7.5f * u); lineTo(-1.6f * u, 2.5f * u)
      lineTo(-10f * u, 5f * u); lineTo(-10f * u, 3f * u); lineTo(-1.6f * u, -2f * u); lineTo(-1.6f * u, -6f * u)
      close()
    }
    c.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
    return bmp
  }

  private fun addOverlays(s: Style) {
    val get = { k: String -> Expression.get(k) }
    s.addImage("plane", planeBitmap(), true)
    val font = arrayOf("Noto Sans Medium")
    for (id in listOf("rings", "me", "trails", "planes", "overlay")) s.addSource(GeoJsonSource(id))
    s.addLayer(LineLayer("rings", "rings").withProperties(
      PropertyFactory.lineColor("#3fd0c9"), PropertyFactory.lineOpacity(0.45f), PropertyFactory.lineWidth(1f),
    ))
    s.addLayer(SymbolLayer("rings-label", "rings").withProperties(
      PropertyFactory.symbolPlacement(Property.SYMBOL_PLACEMENT_LINE), PropertyFactory.textField(get("label")),
      PropertyFactory.textFont(font), PropertyFactory.textSize(10f), PropertyFactory.textColor("#3fd0c9"),
      PropertyFactory.textOpacity(0.7f), PropertyFactory.textHaloColor("#0a1018"), PropertyFactory.textHaloWidth(1f),
    ))
    s.addLayer(LineLayer("trails", "trails").withProperties(
      PropertyFactory.lineColor(get("color")), PropertyFactory.lineWidth(2f), PropertyFactory.lineOpacity(0.75f),
      PropertyFactory.lineCap(Property.LINE_CAP_ROUND), PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
    ))
    s.addLayer(CircleLayer("me", "me").withProperties(
      PropertyFactory.circleRadius(5.5f), PropertyFactory.circleColor("#4da3ff"),
      PropertyFactory.circleStrokeColor("#ffffff"), PropertyFactory.circleStrokeWidth(2f),
    ))
    s.addLayer(CircleLayer("overlay-dot", "overlay").withProperties(
      PropertyFactory.circleRadius(4.5f), PropertyFactory.circleColor(Expression.coalesce(get("color"), Expression.literal("#f2b33d"))),
      PropertyFactory.circleStrokeColor("#0a1018"), PropertyFactory.circleStrokeWidth(1f),
    ))
    s.addLayer(SymbolLayer("overlay-label", "overlay").withProperties(
      PropertyFactory.textField(get("label")), PropertyFactory.textFont(font), PropertyFactory.textSize(10f),
      PropertyFactory.textAnchor(Property.TEXT_ANCHOR_LEFT), PropertyFactory.textOffset(arrayOf(0.8f, 0f)),
      PropertyFactory.textColor("#f2d9a0"), PropertyFactory.textHaloColor("#0a1018"), PropertyFactory.textHaloWidth(1.2f),
      PropertyFactory.textOptional(true),
    ))
    s.addLayer(SymbolLayer("planes", "planes").withProperties(
      PropertyFactory.iconImage("plane"), PropertyFactory.iconColor(get("color")), PropertyFactory.iconRotate(get("track")),
      PropertyFactory.iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_MAP), PropertyFactory.iconAllowOverlap(true),
      PropertyFactory.iconIgnorePlacement(true), PropertyFactory.iconSize(get("size")), PropertyFactory.iconOpacity(get("opacity")),
      PropertyFactory.iconHaloColor("#000000"), PropertyFactory.iconHaloWidth(1.2f),
      // names from zoom 7.5 on (or the selected plane at any zoom)
      PropertyFactory.textField(Expression.step(Expression.zoom(),
        Expression.switchCase(get("sel"), get("label"), Expression.literal("")), Expression.stop(7.5, get("label")))),
      PropertyFactory.textFont(font), PropertyFactory.textSize(11f), PropertyFactory.textColor("#e6edf3"),
      PropertyFactory.textHaloColor("#0a0d11"), PropertyFactory.textHaloWidth(1.6f),
      PropertyFactory.textAnchor(Property.TEXT_ANCHOR_LEFT), PropertyFactory.textJustify(Property.TEXT_JUSTIFY_LEFT),
      PropertyFactory.textOffset(arrayOf(1.4f, 0f)), PropertyFactory.textOptional(true),
      PropertyFactory.symbolSortKey(get("sort")),
    ))
  }

  // ---------- planes ----------

  /** With no saved camera and no location, look at wherever the first planes turn up. */
  private fun maybeCentreOnTraffic() {
    if (cameraSet) return
    val m = map ?: return
    val f = frame ?: return
    val lat = f.rxLat
    val lon = f.rxLon
    if (lat != null && lon != null) {
      cameraSet = true
      m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(lat, lon), 8.0))
      return
    }
    val pos = f.planes.filter { it.hasPos }
    if (pos.isEmpty()) return
    cameraSet = true
    m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(pos.map { it.lat }.average(), pos.map { it.lon }.average()), 8.0))
  }

  private fun ringFeatures(lat: Double, lon: Double): FeatureCollection {
    val feats = RINGS_NM.map { nm ->
      val rDeg = nm * 1852.0 / 111_320.0
      val pts = (0..96).map { i ->
        val a = i / 96.0 * 2 * PI
        Point.fromLngLat(lon + rDeg * sin(a) / cos(Math.toRadians(lat)), lat + rDeg * cos(a))
      }
      Feature.fromGeometry(LineString.fromLngLats(pts)).apply { addStringProperty("label", "$nm nm") }
    }
    return FeatureCollection.fromFeatures(feats)
  }

  private fun label(p: Plane): String {
    val name = p.flight.ifEmpty { p.hex.uppercase() }
    val alt = when {
      p.ground -> "GND"
      p.alt == null -> ""
      p.alt >= 18000 -> "FL%03d".format((p.alt + 50) / 100)
      else -> "%,d ft".format(p.alt)
    }
    return if (alt.isEmpty()) name else "$name\n$alt"
  }

  private fun updatePlanes() {
    val s = loaded ?: return
    val f = frame
    val lat = f?.rxLat ?: RadioEngine.rxLat
    val lon = f?.rxLon ?: RadioEngine.rxLon
    if (lat != null && lon != null && ringsAt != lat to lon) {
      ringsAt = lat to lon
      (s.getSource("rings") as? GeoJsonSource)?.setGeoJson(ringFeatures(lat, lon))
      (s.getSource("me") as? GeoJsonSource)?.setGeoJson(Feature.fromGeometry(Point.fromLngLat(lon, lat)))
    }
    val sel = selected
    val planes = ArrayList<Feature>()
    val trails = ArrayList<Feature>()
    if (f != null) {
      for (p in f.planes) {
        if (!p.hasPos) continue
        val isSel = p.hex == sel
        val stale = p.posAgoMs > 15_000
        planes.add(Feature.fromGeometry(Point.fromLngLat(p.lon, p.lat)).apply {
          addStringProperty("hex", p.hex)
          addStringProperty("label", label(p))
          addStringProperty("color", hex(altitudeColor(p.alt, p.ground)))
          addNumberProperty("track", p.track ?: p.heading ?: 0f)
          addNumberProperty("size", if (isSel) 1.25f else 1f)
          addNumberProperty("opacity", if (stale) 0.45f else 1f)
          addBooleanProperty("sel", isSel)
          addNumberProperty("sort", if (isSel) 1 else 0)
        })
        val pts = f.trails[p.icao] ?: continue
        // every plane gets its recent path; the selected one its whole track
        val n = pts.size / 3
        val from = if (isSel) 0 else maxOf(0, n - TRAIL_POINTS)
        if (n - from < 2) continue
        val line = (from until n).map { Point.fromLngLat(pts[it * 3 + 1].toDouble(), pts[it * 3].toDouble()) }
        trails.add(Feature.fromGeometry(LineString.fromLngLats(line)).apply {
          addStringProperty("color", hex(altitudeColor(p.alt, p.ground)))
        })
      }
    }
    (s.getSource("planes") as? GeoJsonSource)?.setGeoJson(FeatureCollection.fromFeatures(planes))
    (s.getSource("trails") as? GeoJsonSource)?.setGeoJson(FeatureCollection.fromFeatures(trails))
  }
}
