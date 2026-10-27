package expo.modules.rtlradio

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.os.SystemClock
import android.view.MotionEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max

/**
 * Live spectrum + waterfall drawn natively from the engine's frames (never through JS). Tap to tune, drag
 * sideways to fine-tune, long-press to put channel B there. Emits onTune({ freq, drag, b }) with the raw
 * frequency; JS snaps it to the channel grid.
 */
class SpectrumView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  companion object {
    private const val BINS = 1024
    private const val ROWS = 180
    private const val SPECTRUM_SHARE = 0.42f

    // dark blue -> blue -> cyan -> yellow -> red, as on the Mac panel
    private val LUT = IntArray(256).also { lut ->
      val stops = arrayOf(
        floatArrayOf(0f, 10f, 12f, 40f), floatArrayOf(0.3f, 20f, 60f, 160f), floatArrayOf(0.55f, 30f, 190f, 200f),
        floatArrayOf(0.75f, 240f, 220f, 60f), floatArrayOf(1f, 250f, 70f, 40f),
      )
      for (i in 0 until 256) {
        val v = i / 255f
        var k = 0
        while (k < stops.size - 2 && v > stops[k + 1][0]) k++
        val a = stops[k]
        val b = stops[k + 1]
        val t = (v - a[0]) / (b[0] - a[0])
        lut[i] = Color.rgb(
          (a[1] + (b[1] - a[1]) * t).toInt(), (a[2] + (b[2] - a[2]) * t).toInt(), (a[3] + (b[3] - a[3]) * t).toInt(),
        )
      }
    }
  }

  private val onTune by EventDispatcher()
  private val density = resources.displayMetrics.density

  // latest frame from the radio thread
  private val lock = Any()
  private val incoming = FloatArray(BINS)
  private var hasNew = false
  private var center = 0L
  private var rate = RadioEngine.FS
  private var listenFreq = 0L
  private var chanBw = 0
  private var bFreq = 0L
  private var bBw = 0
  private var scanning = false

  // drawing state (UI thread)
  private val bins = FloatArray(BINS)
  private val sortScratch = FloatArray(BINS)
  private var haveData = false
  private var floorEma = Float.NaN
  private val waterfall = Bitmap.createBitmap(BINS, ROWS, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.rgb(10, 13, 17)) }
  private val row = IntArray(BINS)
  private var newestRow = 0
  private val path = Path()
  private val fillPath = Path()
  private val bg = Paint().apply { color = Color.rgb(10, 13, 17) }
  private val grid = Paint().apply { color = Color.rgb(31, 37, 46); strokeWidth = 1f }
  private val axis = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(139, 148, 158); textSize = 10 * density }
  private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(63, 208, 201); strokeWidth = 1.2f * density; style = Paint.Style.STROKE }
  private val fill = Paint().apply { color = Color.argb(40, 63, 208, 201); style = Paint.Style.FILL }
  private val chan = Paint().apply { color = Color.argb(46, 240, 180, 41) }
  private val chanLine = Paint().apply { color = Color.rgb(240, 180, 41); strokeWidth = 1.5f * density }
  private val chanB = Paint().apply { color = Color.argb(46, 167, 139, 250) }
  private val chanBLine = Paint().apply { color = Color.rgb(167, 139, 250); strokeWidth = 1.5f * density }
  private val tag = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 11 * density; isFakeBoldText = true }
  private val wfPaint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val src = Rect()
  private val dst = RectF()

  private val listener: (RadioEngine.SpectrumFrame) -> Unit = { f ->
    synchronized(lock) {
      System.arraycopy(f.bins, 0, incoming, 0, BINS)
      center = f.center
      rate = f.rate
      listenFreq = f.listenFreq
      chanBw = f.bw
      bFreq = f.bFreq
      bBw = f.bBw
      scanning = f.scanning
      hasNew = true
    }
    postInvalidateOnAnimation()
  }

  init {
    setWillNotDraw(false)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    RadioEngine.addSpectrumListener(listener)
  }

  override fun onDetachedFromWindow() {
    RadioEngine.removeSpectrumListener(listener)
    super.onDetachedFromWindow()
  }

  private fun takeFrame() {
    synchronized(lock) {
      if (!hasNew) return
      System.arraycopy(incoming, 0, bins, 0, BINS)
      hasNew = false
    }
    haveData = true
    // display range follows the noise floor (median), smoothed so it doesn't pump
    val sorted = sortScratch
    System.arraycopy(bins, 0, sorted, 0, BINS)
    sorted.sort()
    val median = sorted[BINS / 2]
    floorEma = if (floorEma.isNaN()) median else floorEma * 0.9f + median * 0.1f
    val lo = floorEma - 8
    val span = 58f
    for (i in 0 until BINS) {
      val v = ((bins[i] - lo) / span * 255).toInt().coerceIn(0, 255)
      row[i] = LUT[v]
    }
    newestRow = (newestRow - 1 + ROWS) % ROWS
    waterfall.setPixels(row, 0, BINS, 0, newestRow, BINS, 1)
  }

  override fun onDraw(canvas: Canvas) {
    takeFrame()
    val w = width.toFloat()
    val h = height.toFloat()
    val specH = h * SPECTRUM_SHARE
    canvas.drawRect(0f, 0f, w, specH, bg)
    if (!haveData) return

    val c: Long
    val r: Int
    val lf: Long
    val b: Int
    val bf: Long
    val bb: Int
    val sc: Boolean
    synchronized(lock) {
      c = center
      r = rate
      lf = listenFreq
      b = chanBw
      bf = bFreq
      bb = bBw
      sc = scanning
    }
    val start = c - r / 2
    fun xOf(hz: Long) = ((hz - start).toFloat() / r) * w

    // grid + MHz labels
    val step = if (w / density < 420) 400_000L else 200_000L
    var f = ceil(start / step.toDouble()).toLong() * step
    while (f < start + r) {
      val x = xOf(f)
      canvas.drawLine(x, 0f, x, specH, grid)
      canvas.drawText("%.1f".format(f / 1e6), x + 3 * density, 12 * density, axis)
      f += step
    }

    // listening channels: A in amber, B in violet
    if (!sc && lf != 0L) {
      val x0 = xOf(lf - b / 2)
      val x1 = max(xOf(lf + b / 2), x0 + 2 * density)
      canvas.drawRect(x0, 0f, x1, h, chan)
      val xc = xOf(lf)
      canvas.drawLine(xc, 0f, xc, specH, chanLine)
      if (bf != 0L) {
        val bx0 = xOf(bf - bb / 2)
        canvas.drawRect(bx0, 0f, max(xOf(bf + bb / 2), bx0 + 2 * density), h, chanB)
        val bx = xOf(bf)
        canvas.drawLine(bx, 0f, bx, specH, chanBLine)
        tag.color = chanBLine.color
        canvas.drawText("B", bx + 3 * density, specH - 4 * density, tag)
        tag.color = chanLine.color
        canvas.drawText("A", xc + 3 * density, specH - 4 * density, tag)
      }
    }

    // spectrum trace
    val lo = floorEma - 8
    val hi = floorEma + 50
    path.rewind()
    fillPath.rewind()
    fillPath.moveTo(0f, specH)
    for (i in 0 until BINS) {
      val x = i * w / (BINS - 1)
      val y = specH - ((bins[i] - lo) / (hi - lo)).coerceIn(0f, 1f) * specH
      if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
      fillPath.lineTo(x, y)
    }
    fillPath.lineTo(w, specH)
    fillPath.close()
    canvas.drawPath(fillPath, fill)
    canvas.drawPath(path, line)

    // waterfall: newest row at the top, in two slices of the circular bitmap
    val wfTop = specH
    val rowH = (h - wfTop) / ROWS
    val firstRows = ROWS - newestRow
    src.set(0, newestRow, BINS, ROWS)
    dst.set(0f, wfTop, w, wfTop + firstRows * rowH)
    canvas.drawBitmap(waterfall, src, dst, wfPaint)
    if (newestRow > 0) {
      src.set(0, 0, BINS, newestRow)
      dst.set(0f, wfTop + firstRows * rowH, w, h)
      canvas.drawBitmap(waterfall, src, dst, wfPaint)
    }
    if (!sc && lf != 0L) {
      val x0 = xOf(lf - b / 2)
      canvas.drawRect(x0, wfTop, max(xOf(lf + b / 2), x0 + 2 * density), h, chan)
    }
  }

  // ---------- touch: tap to tune, drag to fine-tune ----------

  private var downX = 0f
  private var downFreq = 0L
  private var dragging = false
  private var longPressed = false
  private var lastDragEmit = 0L
  private val longPress = Runnable {
    if (!dragging) {
      longPressed = true
      performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
      onTune(mapOf("freq" to hzAt(downX).toDouble(), "drag" to false, "b" to true))
    }
  }

  private fun hzAt(x: Float): Long {
    val c: Long
    val r: Int
    synchronized(lock) {
      c = center
      r = rate
    }
    return c - r / 2 + (x / width * r).toLong()
  }

  private fun hzPerPx(): Double = synchronized(lock) { rate.toDouble() } / max(width, 1)

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!haveData) return false
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.x
        downFreq = synchronized(lock) { listenFreq }
        dragging = false
        longPressed = false
        parent?.requestDisallowInterceptTouchEvent(true)
        postDelayed(longPress, android.view.ViewConfiguration.getLongPressTimeout().toLong())
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = event.x - downX
        if (!dragging && !longPressed && abs(dx) > 12 * density) {
          dragging = true
          removeCallbacks(longPress)
        }
        if (dragging) {
          val now = SystemClock.uptimeMillis()
          if (now - lastDragEmit > 60) {
            lastDragEmit = now
            // slower than the spectrum scale, for fine control
            onTune(mapOf("freq" to (downFreq + dx * hzPerPx() * 0.25).toDouble(), "drag" to true))
          }
        }
        return true
      }
      MotionEvent.ACTION_UP -> {
        removeCallbacks(longPress)
        parent?.requestDisallowInterceptTouchEvent(false)
        if (dragging) {
          val dx = event.x - downX
          onTune(mapOf("freq" to (downFreq + dx * hzPerPx() * 0.25).toDouble(), "drag" to true))
        } else if (!longPressed) {
          onTune(mapOf("freq" to hzAt(event.x).toDouble(), "drag" to false))
        }
        dragging = false
        return true
      }
      MotionEvent.ACTION_CANCEL -> {
        removeCallbacks(longPress)
        parent?.requestDisallowInterceptTouchEvent(false)
        dragging = false
        return true
      }
    }
    return super.onTouchEvent(event)
  }
}
