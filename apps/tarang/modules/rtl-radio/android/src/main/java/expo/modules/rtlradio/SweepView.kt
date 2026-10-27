package expo.modules.rtlradio

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.MotionEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/** Hosts the band-sweep chart (a module can define only one native view). */
class RtlSweepModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RtlRadioSweep")
    View(SweepView::class) {
      Events("onTune")
    }
  }
}

/**
 * Band activity chart from the last sweep: one bar per pixel column (the max of its 25 kHz bins), coloured by
 * SNR. Fills in live while the sweep runs. Tap to tune to the strongest bin under your finger.
 */
class SweepView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onTune by EventDispatcher()
  private val density = resources.displayMetrics.density
  private val bg = Paint().apply { color = Color.rgb(10, 13, 17) }
  private val bar = Paint()
  private val grid = Paint().apply { color = Color.rgb(31, 37, 46); strokeWidth = 1f }
  private val axis = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(139, 148, 158); textSize = 10 * density }
  private val listener: () -> Unit = { postInvalidateOnAnimation() }

  init {
    setWillNotDraw(false)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    RadioEngine.addSweepListener(listener)
    invalidate()
  }

  override fun onDetachedFromWindow() {
    RadioEngine.removeSweepListener(listener)
    super.onDetachedFromWindow()
  }

  private fun colorFor(db: Float): Int {
    val t = ((db - 6) / 34f).coerceIn(0f, 1f)
    // teal -> amber -> red as signals get stronger
    return if (t < 0.5f) {
      val u = t * 2
      Color.rgb((40 + u * 200).toInt(), (120 + u * 60).toInt(), (140 - u * 100).toInt())
    } else {
      val u = (t - 0.5f) * 2
      Color.rgb(240, (180 - u * 110).toInt(), (40 - u * 10).toInt())
    }
  }

  override fun onDraw(canvas: Canvas) {
    val w = width.toFloat()
    val h = height.toFloat()
    canvas.drawRect(0f, 0f, w, h, bg)
    val d = RadioEngine.sweepData ?: return
    val n = d.bins.size
    if (n == 0 || w <= 0) return
    val chartTop = 14 * density
    val chartH = h - chartTop
    val stopHz = d.start + n * d.step

    // MHz grid: pick a step that gives ~5 labels
    val spanMhz = (stopHz - d.start) / 1e6
    val stepMhz = listOf(0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0).firstOrNull { spanMhz / it <= 6 } ?: 500.0
    var m = ceil(d.start / 1e6 / stepMhz) * stepMhz
    while (m * 1e6 < stopHz) {
      val x = ((m * 1e6 - d.start) / (stopHz - d.start) * w).toFloat()
      canvas.drawLine(x, chartTop, x, h, grid)
      canvas.drawText(if (stepMhz < 1) "%.1f".format(m) else "%.0f".format(m), x + 2 * density, 10 * density, axis)
      m += stepMhz
    }

    val cols = w.toInt()
    for (x in 0 until cols) {
      val i0 = (x.toLong() * n / cols).toInt()
      val i1 = max(i0 + 1, ((x + 1).toLong() * n / cols).toInt())
      var v = -10f
      for (i in i0 until min(i1, n)) if (d.bins[i] > v) v = d.bins[i]
      if (v < 4) continue
      val bh = (v / 45f).coerceIn(0.02f, 1f) * chartH
      bar.color = colorFor(v)
      canvas.drawRect(x.toFloat(), h - bh, x + 1f, h, bar)
    }
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    val d = RadioEngine.sweepData ?: return false
    if (event.actionMasked == MotionEvent.ACTION_DOWN) return true
    if (event.actionMasked != MotionEvent.ACTION_UP) return true
    val n = d.bins.size
    val i0 = (event.x / width * n).toInt()
    val reach = max(2, (6 * density / width * n).toInt()) // snap to the strongest bin within a few px
    var best = i0.coerceIn(0, n - 1)
    for (i in max(0, i0 - reach) until min(n, i0 + reach)) if (d.bins[i] > d.bins[best]) best = i
    onTune(mapOf("freq" to (d.start + best * d.step + d.step / 2).toDouble(), "drag" to false))
    return true
  }
}
