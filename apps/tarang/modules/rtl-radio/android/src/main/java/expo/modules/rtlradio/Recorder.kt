package expo.modules.rtlradio

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.util.Log
import expo.modules.rtlradio.dsp.Dsp
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.util.concurrent.Executors

/**
 * Records what you hear to a 16-bit stereo 48 kHz WAV in Recordings/Tarang (visible in the Files app).
 * Only audible blocks are written, so silent gaps between transmissions are skipped. File writes happen on
 * their own thread so slow storage never stalls the radio.
 */
class Recorder private constructor(private val context: Context, val name: String, private val uri: Uri) {
  companion object {
    private const val TAG = "Recorder"
    private const val RATE = 48_000
    private const val FOLDER = "Tarang"

    /** Android 10+ (scoped storage, no permission needed); null if it can't start. */
    fun start(context: Context, name: String): Recorder? = try {
      if (Build.VERSION.SDK_INT < 29) throw IllegalStateException("recording needs Android 10 or newer")
      val values = ContentValues().apply {
        put(MediaStore.Audio.Media.DISPLAY_NAME, name)
        put(MediaStore.Audio.Media.MIME_TYPE, "audio/wav")
        val dir = if (Build.VERSION.SDK_INT >= 31) Environment.DIRECTORY_RECORDINGS else Environment.DIRECTORY_MUSIC
        put(MediaStore.Audio.Media.RELATIVE_PATH, "$dir/$FOLDER")
        put(MediaStore.Audio.Media.IS_PENDING, 1)
      }
      val uri = context.contentResolver.insert(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values)
        ?: throw IllegalStateException("MediaStore insert failed")
      Recorder(context, name, uri)
    } catch (e: Exception) {
      Log.w(TAG, "can't start recording: ${e.message}")
      null
    }

    /** Recordings made by this app, newest first. */
    fun list(context: Context): List<Map<String, Any?>> {
      if (Build.VERSION.SDK_INT < 29) return emptyList()
      val out = ArrayList<Map<String, Any?>>()
      val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      val projection = arrayOf(MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DISPLAY_NAME, MediaStore.Audio.Media.SIZE)
      val sel = "${MediaStore.Audio.Media.RELATIVE_PATH} LIKE ? AND ${MediaStore.Audio.Media.IS_PENDING} = 0"
      context.contentResolver.query(collection, projection, sel, arrayOf("%/$FOLDER/%"), "${MediaStore.Audio.Media.DATE_ADDED} DESC")?.use { c ->
        while (c.moveToNext() && out.size < 30) {
          val id = c.getLong(0)
          out.add(mapOf("id" to ContentUris.withAppendedId(collection, id).toString(), "name" to c.getString(1), "seconds" to seconds(c.getLong(2))))
        }
      }
      return out
    }

    private fun seconds(bytes: Long) = Math.round(maxOf(0L, bytes - 44) / 4.0 / RATE * 10) / 10.0

    fun delete(context: Context, id: String) {
      context.contentResolver.delete(Uri.parse(id), null, null)
    }

    /** Opens the recording in the user's audio player. */
    fun open(context: Context, id: String) {
      val uri = Uri.parse(id)
      val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "audio/wav")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(Intent.createChooser(intent, "Play recording").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "recorder") }
  private val pfd: ParcelFileDescriptor = context.contentResolver.openFileDescriptor(uri, "rw") ?: throw IllegalStateException("can't open $uri")
  private val channel: FileChannel = FileOutputStream(pfd.fileDescriptor).channel
  @Volatile var frames = 0L
    private set
  private val floats = FloatArray((Dsp.MAX_BLOCK / 50 + 16) * 2)

  init {
    channel.write(header(0))
  }

  private fun header(dataBytes: Long): ByteBuffer {
    val b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    b.put("RIFF".toByteArray()).putInt((36 + dataBytes).toInt()).put("WAVE".toByteArray())
    b.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(2).putInt(RATE).putInt(RATE * 4).putShort(4).putShort(16)
    b.put("data".toByteArray()).putInt(dataBytes.toInt())
    b.flip()
    return b
  }

  /** [audio] holds [n] interleaved stereo float frames from position 0. */
  fun write(audio: ByteBuffer, n: Int) {
    if (n <= 0) return
    audio.position(0)
    audio.asFloatBuffer().get(floats, 0, n * 2)
    val pcm = ByteBuffer.allocate(n * 4).order(ByteOrder.LITTLE_ENDIAN)
    for (i in 0 until n * 2) pcm.putShort((floats[i] * 32767f).toInt().coerceIn(-32768, 32767).toShort())
    pcm.flip()
    frames += n
    io.execute {
      try {
        channel.write(pcm)
      } catch (e: Exception) {
        Log.w(TAG, "write failed: ${e.message}")
      }
    }
  }

  /** Finishes the file in the background; [done] runs once it is visible to other apps. */
  fun close(done: () -> Unit = {}) {
    io.execute {
      try {
        val bytes = channel.size() - 44
        channel.write(header(bytes), 0)
        channel.close()
        pfd.close()
        context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }, null, null)
      } catch (e: Exception) {
        Log.w(TAG, "close failed: ${e.message}")
      }
      done()
    }
    io.shutdown()
  }
}
