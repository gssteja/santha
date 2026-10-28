package expo.modules.rtlradio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.hardware.usb.UsbManager
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * Keeps the radio playing with the screen off: a media-playback foreground service holding a partial wake
 * lock (scanning writes no audio, so nothing else would keep the CPU awake). Stops when the headphones are
 * unplugged (so the radio doesn't suddenly play out loud), from the notification, or when the dongle has
 * been gone for a while.
 */
class RadioService : Service() {
  companion object {
    private const val CHANNEL = "radio"
    private const val NOTIFICATION_ID = 1
    const val ACTION_STOP = "expo.modules.rtlradio.STOP"

    fun start(context: Context) {
      context.startForegroundService(Intent(context, RadioService::class.java))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, RadioService::class.java))
    }

    private const val ALERTS = "weather_alerts"
    private var alertId = 100

    /** A heads-up notification for a weather alert decoded from NOAA Weather Radio. */
    fun alert(context: Context, title: String, text: String) {
      val nm = context.getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(
        NotificationChannel(ALERTS, "Weather alerts", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "Warnings and watches decoded from NOAA Weather Radio"
        },
      )
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP }
      val open = PendingIntent.getActivity(context, 2, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      val n = Notification.Builder(context, ALERTS)
        .setSmallIcon(R.drawable.ic_radio_notification)
        .setContentTitle(title)
        .setContentText(text)
        .setStyle(Notification.BigTextStyle().bigText(text))
        .setContentIntent(open)
        .setAutoCancel(true)
        .setCategory(Notification.CATEGORY_ALARM)
        .build()
      nm.notify(alertId++, n)
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private val main = Handler(Looper.getMainLooper())

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        AudioManager.ACTION_AUDIO_BECOMING_NOISY -> stopSelf()
        // the engine notices the lost stream by itself; this just makes the status update immediate
        UsbManager.ACTION_USB_DEVICE_DETACHED -> Unit
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CHANNEL, "Radio playback", NotificationManager.IMPORTANCE_LOW))
    val filter = IntentFilter().apply {
      addAction(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
      addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
    }
    if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED) else registerReceiver(receiver, filter)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }
    val notification = buildNotification(RadioEngine.nowPlaying())
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    if (wakeLock == null) {
      wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tarang:radio")
        .apply { acquire() }
    }
    RadioEngine.nowPlayingListener = { text ->
      main.post { getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(text)) }
    }
    RadioEngine.stoppedListener = { main.post { stopSelf() } }
    RadioEngine.start(this)
    return START_NOT_STICKY
  }

  private fun buildNotification(text: String): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply { flags = Intent.FLAG_ACTIVITY_SINGLE_TOP }
    val open = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val stop = PendingIntent.getService(
      this, 1, Intent(this, RadioService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return Notification.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.ic_radio_notification)
      .setContentTitle("Tarang")
      .setContentText(text)
      .setContentIntent(open)
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_TRANSPORT)
      .addAction(Notification.Action.Builder(null, "Stop", stop).build())
      .build()
  }

  override fun onDestroy() {
    RadioEngine.nowPlayingListener = null
    RadioEngine.stoppedListener = null
    // joining the radio thread can take a moment; don't hold up the main thread for it
    Thread { RadioEngine.stop() }.start()
    try {
      unregisterReceiver(receiver)
    } catch (_: Exception) {
    }
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }
}
