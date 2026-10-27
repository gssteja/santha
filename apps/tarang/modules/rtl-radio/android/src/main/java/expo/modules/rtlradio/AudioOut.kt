package expo.modules.rtlradio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * 48 kHz stereo float output. Writes never block: the radio thread is paced by the dongle, and if the dongle
 * clock runs slightly fast the surplus is dropped. Uses the power-saving (deep buffer) path, since a radio
 * doesn't need low latency.
 */
class AudioOut(context: Context) {
  companion object {
    const val RATE = 48_000
    private const val BYTES_PER_FRAME = 8
  }

  private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val attrs = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_MEDIA)
    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
    .build()

  @Volatile private var focusLost = false
  private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
    .setAudioAttributes(attrs)
    .setOnAudioFocusChangeListener { change -> focusLost = change < 0 }
    .build()

  private val track: AudioTrack
  private val silence: ByteBuffer

  init {
    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
      .setSampleRate(RATE)
      .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
      .build()
    val min = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_FLOAT)
    track = AudioTrack.Builder()
      .setAudioAttributes(attrs)
      .setAudioFormat(format)
      .setBufferSizeInBytes(maxOf(min, RATE * BYTES_PER_FRAME * 2 / 5)) // ~400 ms of cushion
      .setTransferMode(AudioTrack.MODE_STREAM)
      .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_POWER_SAVING)
      .build()
    silence = ByteBuffer.allocateDirect(RATE / 10 * BYTES_PER_FRAME).order(ByteOrder.nativeOrder())
  }

  /** Muted while another app holds audio focus (a call, navigation prompt, other music). */
  val muted: Boolean get() = focusLost

  fun start() {
    focusLost = audioManager.requestAudioFocus(focusRequest) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    track.play()
    // a little cushion so small scheduling hiccups don't underrun
    writeSilence(RATE / 10)
    writeSilence(RATE / 10)
  }

  /** [buf] holds [frames] interleaved stereo frames from position 0; plays silence instead when not [audible]. */
  fun write(buf: ByteBuffer, frames: Int, audible: Boolean) {
    if (frames <= 0) return
    if (audible && !focusLost) {
      buf.position(0)
      track.write(buf, frames * BYTES_PER_FRAME, AudioTrack.WRITE_NON_BLOCKING)
    } else {
      writeSilence(frames)
    }
  }

  private fun writeSilence(frames: Int) {
    var left = frames
    while (left > 0) {
      val n = minOf(left, silence.capacity() / BYTES_PER_FRAME)
      silence.clear()
      silence.limit(n * BYTES_PER_FRAME)
      if (track.write(silence, n * BYTES_PER_FRAME, AudioTrack.WRITE_NON_BLOCKING) <= 0) return
      left -= n
    }
  }

  fun release() {
    try {
      track.pause()
      track.flush()
      track.release()
    } catch (_: Exception) {
    }
    audioManager.abandonAudioFocusRequest(focusRequest)
  }
}
