package expo.modules.rtlradio

import android.content.Context
import android.os.StatFs
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import kotlin.math.PI
import kotlin.math.asinh
import kotlin.math.tan

/**
 * Downloads the offline map: the areas in assets/maps/areas.json, cut straight out of a Protomaps planet build with
 * HTTP range requests (only the needed directories and tiles) and written as one PMTiles v3 archive per area under
 * files/maps, which [RadarView] draws with MapLibre. A port of tools/make_offline_map.py, but streaming each area's
 * tiles to disk (India alone is ~125 MB) and resumable: finished areas are kept if a later one fails.
 * Protomaps allows extracts from its builds; OSM's own tile servers forbid bulk downloads.
 */
object MapDownloader {
  private const val BUILDS = "https://build.protomaps.com/"
  private const val BUILD_LIST = "https://build-metadata.protomaps.dev/builds.json"
  private const val UA = "Tarang/1.4 offline maps (personal Android RTL-SDR radio app)"
  private const val MAX_GAP = 256L * 1024        // merge tile reads separated by less than this
  private const val MAX_SPAN = 8L * 1024 * 1024  // but keep each request under this
  private const val ROOT_MAX = 16384 - 127

  data class Area(val file: String, val name: String, val w: Double, val s: Double, val e: Double, val n: Double, val z0: Int, val z1: Int)

  @Volatile var running = false
    private set
  @Volatile private var cancelled = false

  fun dir(ctx: Context) = File(ctx.filesDir, "maps")

  fun areas(ctx: Context): List<Area> {
    val json = JSONObject(ctx.assets.open("maps/areas.json").use { it.readBytes().decodeToString() })
    val arr = json.getJSONArray("areas")
    return (0 until arr.length()).map {
      val a = arr.getJSONObject(it)
      val b = a.getJSONArray("bounds")
      Area(a.getString("file"), a.getString("name"), b.getDouble(0), b.getDouble(1), b.getDouble(2), b.getDouble(3), a.getInt("minzoom"), a.getInt("maxzoom"))
    }
  }

  /** What is on the phone: { installed (all areas), build, bytes, areas: [{name, file, done}] }. */
  fun status(ctx: Context): Map<String, Any?> {
    val d = dir(ctx)
    val list = areas(ctx).map { mapOf("name" to it.name, "file" to it.file, "done" to File(d, it.file).isFile) }
    val build = File(d, "build.txt").takeIf { it.isFile }?.readText()?.trim()
    return mapOf(
      "installed" to list.all { it["done"] == true },
      "any" to list.any { it["done"] == true },
      "build" to build,
      "bytes" to (d.listFiles()?.filter { it.name.endsWith(".pmtiles") }?.sumOf { it.length() } ?: 0L).toDouble(),
      "areas" to list,
      "running" to running,
    )
  }

  fun cancel() {
    cancelled = true
  }

  fun delete(ctx: Context) {
    if (!running) dir(ctx).deleteRecursively()
  }

  /** Blocking; call off the main thread. [progress] gets (phase, doneBytes, totalBytes). Throws on failure. */
  fun download(ctx: Context, progress: (String, Long, Long) -> Unit) {
    synchronized(this) {
      if (running) throw IllegalStateException("A map download is already running")
      running = true
      cancelled = false
    }
    try {
      run(ctx, progress)
    } finally {
      running = false
    }
  }

  private fun run(ctx: Context, progress: (String, Long, Long) -> Unit) {
    val out = dir(ctx).apply { mkdirs() }
    val areas = areas(ctx)
    progress("Finding the latest map build…", 0, 0)
    val oldBuild = File(out, "build.txt").takeIf { it.isFile }?.readText()?.trim()
    val build = oldBuild?.takeIf { areas.any { a -> !File(out, a.file).isFile } }  // finish a partial set from the same build
      ?: JSONArray(httpGet(URL(BUILD_LIST)).decodeToString()).let { it.getJSONObject(it.length() - 1).getString("key").removeSuffix(".pmtiles") }
    if (build != oldBuild) {  // a new build: start over so every area matches
      out.listFiles()?.forEach { it.delete() }
      File(out, "build.txt").writeText(build)
    }
    val src = Remote(URL("$BUILDS$build.pmtiles"))
    val todo = areas.filter { !File(out, it.file).isFile }
    progress("Reading the map index…", 0, 0)
    val plan = todo.map { it to src.lookup(wantedIds(it)) }
    val total = plan.sumOf { (_, tiles) -> tiles.sumOf { it.len } }
    val free = StatFs(out.path).availableBytes
    if (free < total * 2 + 50_000_000) {
      throw IllegalStateException("Not enough space: the map needs %.0f MB free (plus room to assemble), the phone has %.0f MB".format(total / 1e6, free / 1e6))
    }
    val meta = src.metadata()
    var done = 0L
    for ((area, tiles) in plan) {
      if (cancelled) throw InterruptedException("Cancelled")
      writeArea(src, area, tiles, meta, File(out, area.file)) { n ->
        done += n
        progress(area.name, done, total)
      }
    }
    progress("Done", total, total)
  }

  // ---------- PMTiles v3 ----------

  private class Tile(val id: Long, val off: Long, val len: Long)
  private class Entry(val id: Long, val run: Long, val off: Long, val len: Long)

  fun zxyToId(z: Int, x0: Int, y0: Int): Long {
    var acc = ((1L shl (2 * z)) - 1) / 3
    var x = x0.toLong()
    var y = y0.toLong()
    var s = if (z > 0) 1L shl (z - 1) else 0L
    while (s > 0) {
      val rx = if (x and s != 0L) 1L else 0L
      val ry = if (y and s != 0L) 1L else 0L
      acc += s * s * ((3 * rx) xor ry)
      if (ry == 0L) {
        if (rx == 1L) {
          x = s - 1 - x
          y = s - 1 - y
        }
        val t = x; x = y; y = t
      }
      s = s shr 1
    }
    return acc
  }

  private fun tileXY(lon: Double, lat: Double, z: Int): Pair<Int, Int> {
    val n = 1 shl z
    val la = Math.toRadians(lat.coerceIn(-85.0511, 85.0511))
    val x = ((lon + 180) / 360 * n).toInt()
    val y = ((1 - asinh(tan(la)) / PI) / 2 * n).toInt()
    return x.coerceIn(0, n - 1) to y.coerceIn(0, n - 1)
  }

  private fun wantedIds(a: Area): LongArray {
    val ids = ArrayList<Long>()
    for (z in a.z0..a.z1) {
      val (x0, y0) = tileXY(a.w, a.n, z)
      val (x1, y1) = tileXY(a.e, a.s, z)
      for (x in x0..x1) for (y in y0..y1) ids.add(zxyToId(z, x, y))
    }
    return ids.distinct().sorted().toLongArray()
  }

  private class Reader(val b: ByteArray) {
    var pos = 0
    fun varint(): Long {
      var shift = 0
      var r = 0L
      while (true) {
        val c = b[pos++].toInt() and 0xff
        r = r or ((c and 0x7f).toLong() shl shift)
        if (c and 0x80 == 0) return r
        shift += 7
      }
    }
  }

  private fun parseDir(raw: ByteArray): List<Entry> {
    val r = Reader(raw)
    val n = r.varint().toInt()
    val ids = LongArray(n)
    val runs = LongArray(n)
    val lens = LongArray(n)
    val offs = LongArray(n)
    var last = 0L
    for (i in 0 until n) { last += r.varint(); ids[i] = last }
    for (i in 0 until n) runs[i] = r.varint()
    for (i in 0 until n) lens[i] = r.varint()
    for (i in 0 until n) {
      val v = r.varint()
      offs[i] = if (v == 0L && i > 0) offs[i - 1] + lens[i - 1] else v - 1
    }
    return (0 until n).map { Entry(ids[it], runs[it], offs[it], lens[it]) }
  }

  private fun putVarint(o: ByteArrayOutputStream, v0: Long) {
    var v = v0
    while (v >= 0x80) {
      o.write(((v and 0x7f) or 0x80).toInt())
      v = v ushr 7
    }
    o.write(v.toInt())
  }

  private fun serializeDir(entries: List<Entry>): ByteArray {
    val o = ByteArrayOutputStream()
    putVarint(o, entries.size.toLong())
    var last = 0L
    for (e in entries) { putVarint(o, e.id - last); last = e.id }
    for (e in entries) putVarint(o, e.run)
    for (e in entries) putVarint(o, e.len)
    for ((i, e) in entries.withIndex()) {
      val p = if (i > 0) entries[i - 1] else null
      putVarint(o, if (p != null && e.off == p.off + p.len) 0 else e.off + 1)
    }
    return gzip(o.toByteArray())
  }

  private fun gzip(b: ByteArray): ByteArray = ByteArrayOutputStream().also { o -> GZIPOutputStream(o).use { it.write(b) } }.toByteArray()
  private fun gunzip(b: ByteArray): ByteArray = GZIPInputStream(b.inputStream()).use { it.readBytes() }

  /** Root directory, plus leaf directories when the root would not fit in the first 16 KB. */
  private fun buildDirs(entries: List<Entry>): Pair<ByteArray, ByteArray> {
    val root = serializeDir(entries)
    if (root.size <= ROOT_MAX) return root to ByteArray(0)
    var leafSize = 4096
    while (true) {
      val leaves = ByteArrayOutputStream()
      val roots = ArrayList<Entry>()
      for (i in entries.indices step leafSize) {
        val chunk = entries.subList(i, minOf(i + leafSize, entries.size))
        val d = serializeDir(chunk)
        roots.add(Entry(chunk[0].id, 0, leaves.size().toLong(), d.size.toLong()))
        leaves.write(d)
      }
      val r = serializeDir(roots)
      if (r.size <= ROOT_MAX) return r to leaves.toByteArray()
      leafSize *= 2
    }
  }

  private class Remote(val url: URL) {
    val header: ByteBuffer
    val root: List<Entry>
    private val leaves = HashMap<Long, List<Entry>>()
    val dataOff: Long
    val tileComp: Int
    val tileType: Int

    init {
      header = ByteBuffer.wrap(get(0, 127)).order(ByteOrder.LITTLE_ENDIAN)
      check(String(header.array(), 0, 7) == "PMTiles" && header.get(7).toInt() == 3) { "Not a PMTiles v3 build" }
      root = parseDir(gunzip(get(header.getLong(8), header.getLong(16))))
      dataOff = header.getLong(56)
      tileComp = header.get(98).toInt()
      tileType = header.get(99).toInt()
    }

    fun get(off: Long, len: Long): ByteArray {
      var err: Exception? = null
      repeat(5) { attempt ->
        try {
          val b = httpGet(url, "bytes=$off-${off + len - 1}")
          if (b.size.toLong() == len) return b
          err = IllegalStateException("short read ${b.size}/$len")
        } catch (e: Exception) {
          err = e
        }
        Thread.sleep(1000L + attempt * 2000L)
      }
      throw IllegalStateException("Map download failed: ${err?.message}")
    }

    fun metadata(): JSONObject = JSONObject(gunzip(get(header.getLong(24), header.getLong(32))).decodeToString())

    private fun leaf(off: Long, len: Long): List<Entry> =
      synchronized(leaves) { leaves[off] } ?: parseDir(gunzip(get(header.getLong(40) + off, len))).also { synchronized(leaves) { leaves[off] = it } }

    /** Sorted tile ids -> where their bytes are in the build (absolute offsets). */
    fun lookup(ids: LongArray): List<Tile> {
      val out = ArrayList<Tile>()
      val stack = ArrayDeque<Pair<List<Entry>, List<Long>>>()
      stack.add(root to ids.toList())
      while (stack.isNotEmpty()) {
        val (entries, want) = stack.removeLast()
        val groups = LinkedHashMap<Int, MutableList<Long>>()
        var j = 0
        for (id in want) {
          while (j + 1 < entries.size && entries[j + 1].id <= id) j++
          val e = entries[j]
          if (id < e.id) continue
          if (e.run == 0L) groups.getOrPut(j) { ArrayList() }.add(id)
          else if (id < e.id + e.run) out.add(Tile(id, dataOff + e.off, e.len))
        }
        for ((k, sub) in groups) stack.add(leaf(entries[k].off, entries[k].len) to sub)
      }
      return out.sortedBy { it.id }
    }
  }

  private fun httpGet(url: URL, range: String? = null): ByteArray {
    val c = url.openConnection() as HttpURLConnection
    c.connectTimeout = 15_000
    c.readTimeout = 60_000
    c.setRequestProperty("User-Agent", UA)
    if (range != null) c.setRequestProperty("Range", range)
    try {
      val code = c.responseCode
      if (code != 200 && code != 206) throw IllegalStateException("HTTP $code")
      if (range != null && code != 206) throw IllegalStateException("server ignored the byte range")
      return c.inputStream.use { it.readBytes() }
    } finally {
      c.disconnect()
    }
  }

  /** Fetches one area's tiles into a temp file (deduplicated), then writes header + directories + metadata + data. */
  private fun writeArea(src: Remote, a: Area, tiles: List<Tile>, meta: JSONObject, dest: File, onBytes: (Long) -> Unit) {
    val dataFile = File(dest.path + ".data")
    val part = File(dest.path + ".part")
    val placed = HashMap<Long, Pair<Long, Long>>(tiles.size * 2)   // tile id -> (offset, length) in dataFile
    val byHash = HashMap<String, Long>()
    RandomAccessFile(dataFile, "rw").use { data ->
      data.setLength(0)
      val pool = Executors.newFixedThreadPool(4)
      try {
        val batches = ArrayList<List<Tile>>()
        var cur = ArrayList<Tile>()
        for (t in tiles.sortedBy { it.off }) {
          if (cur.isNotEmpty()) {
            val last = cur.last()
            if (t.off - (last.off + last.len) > MAX_GAP || t.off + t.len - cur[0].off > MAX_SPAN) {
              batches.add(cur)
              cur = ArrayList()
            }
          }
          cur.add(t)
        }
        if (cur.isNotEmpty()) batches.add(cur)
        val futures = batches.map { batch ->
          pool.submit(Callable {
            if (cancelled) throw InterruptedException("Cancelled")
            val start = batch[0].off
            val blob = src.get(start, batch.last().off + batch.last().len - start)
            synchronized(data) {
              for (t in batch) {
                val bytes = blob.copyOfRange((t.off - start).toInt(), (t.off - start + t.len).toInt())
                val h = MessageDigest.getInstance("SHA-1").digest(bytes).joinToString("") { "%02x".format(it) }
                val off = byHash[h] ?: data.length().also { o ->
                  data.seek(o)
                  data.write(bytes)
                  byHash[h] = o
                }
                placed[t.id] = off to t.len
              }
              onBytes(batch.sumOf { it.len })
            }
          })
        }
        futures.forEach { it.get() }
      } finally {
        pool.shutdownNow()
      }
    }
    // directory entries in tile order, runs of identical consecutive tiles collapsed
    val entries = ArrayList<Entry>()
    for (id in placed.keys.sorted()) {
      val (off, len) = placed.getValue(id)
      val last = entries.lastOrNull()
      if (last != null && last.id + last.run == id && last.off == off) entries[entries.size - 1] = Entry(last.id, last.run + 1, off, len)
      else entries.add(Entry(id, 1, off, len))
    }
    val (root, leafDirs) = buildDirs(entries)
    meta.put("description", "Tarang offline map: ${a.name}")
    val metaB = gzip(meta.toString().toByteArray())
    val dataLen = dataFile.length()
    val h = ByteBuffer.allocate(127).order(ByteOrder.LITTLE_ENDIAN)
    val rootOff = 127L
    val metaOff = rootOff + root.size
    val leafOff = metaOff + metaB.size
    val dataOff = leafOff + leafDirs.size
    h.put("PMTiles".toByteArray()).put(3)
    for (v in longArrayOf(rootOff, root.size.toLong(), metaOff, metaB.size.toLong(), leafOff, leafDirs.size.toLong(),
      dataOff, dataLen, placed.size.toLong(), entries.size.toLong(), byHash.size.toLong())) h.putLong(v)
    h.put(0) // not clustered: tiles arrive in download order
    h.put(2).put(src.tileComp.toByte()).put(src.tileType.toByte()).put(a.z0.toByte()).put(a.z1.toByte())
    for (v in doubleArrayOf(a.w, a.s, a.e, a.n)) h.putInt((v * 1e7).toInt())
    h.put(a.z0.toByte()).putInt(((a.w + a.e) / 2 * 1e7).toInt()).putInt(((a.s + a.n) / 2 * 1e7).toInt())
    part.outputStream().buffered(1 shl 20).use { o ->
      o.write(h.array())
      o.write(root)
      o.write(metaB)
      o.write(leafDirs)
      dataFile.inputStream().use { it.copyTo(o, 1 shl 20) }
    }
    dataFile.delete()
    check(part.renameTo(dest)) { "couldn't save ${dest.name}" }
  }
}
