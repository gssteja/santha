package expo.modules.rtlradio

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.rtlradio.usb.RtlSdr

class RtlRadioModule : Module() {
  companion object {
    private const val ACTION_USB_PERMISSION = "expo.modules.rtlradio.USB_PERMISSION"
  }

  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "React context is gone", null)

  override fun definition() = ModuleDefinition {
    Name("RtlRadio")

    Events("onState")

    OnCreate {
      RadioEngine.init(context)
    }

    OnStartObserving {
      RadioEngine.stateListener = { sendEvent("onState", it) }
    }

    OnStopObserving {
      RadioEngine.stateListener = null
    }

    Function("getState") {
      RadioEngine.snapshot(full = true)
    }

    Function("command") { cmd: Map<String, Any?> ->
      RadioEngine.command(cmd)
    }

    /**
     * Finds the dongle, asks for USB permission if needed, and starts the radio service. The engine polls for
     * the permission itself, so the radio comes up as soon as the user taps Allow, whether or not the
     * permission broadcast reaches us.
     */
    AsyncFunction("start") { promise: Promise ->
      val ctx = context
      val mgr = ctx.getSystemService(Context.USB_SERVICE) as UsbManager
      val device = mgr.deviceList.values.firstOrNull { RtlSdr.isSupported(it) }
      if (device == null) {
        promise.reject(
          "ERR_NO_DONGLE", "No RTL-SDR found. Plug the dongle into the USB-C port (through an OTG adapter or hub if needed).", null,
        )
        return@AsyncFunction
      }
      // the playback notification (with its Stop button) needs this on Android 13+
      requestNotificationPermission()
      if (!mgr.hasPermission(device)) requestPermission(ctx, mgr, device)
      RadioService.start(ctx)
      promise.resolve(true)
    }

    Function("stop") {
      RadioService.stop(context)
    }

    Function("openRecording") { id: String ->
      Recorder.open(context, id)
    }

    Function("deleteRecording") { id: String ->
      Recorder.delete(context, id)
      RadioEngine.recordingsChanged()
    }

    View(SpectrumView::class) {
      Events("onTune")
    }
  }

  private fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT < 33) return
    val activity = appContext.currentActivity ?: return
    if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4711)
    }
  }

  private fun requestPermission(ctx: Context, mgr: UsbManager, device: UsbDevice) {
    // explicit (package-scoped) intent: required for a mutable PendingIntent on Android 14+. Nothing needs to
    // receive it: the engine notices the granted permission on its own.
    val intent = Intent(ACTION_USB_PERMISSION).setPackage(ctx.packageName)
    val pi = PendingIntent.getBroadcast(ctx, 0, intent, PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    mgr.requestPermission(device, pi)
  }
}
