package expo.modules.rtlradio

import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Byte ring between the USB thread (writer) and the radio thread (reader). If processing falls behind, the
 * oldest samples are dropped so the radio always works on fresh data.
 */
class IqRing(private val capacity: Int) {
  private val ring = ByteArray(capacity)
  private val lock = ReentrantLock()
  private val dataReady = lock.newCondition()
  private var readPos = 0
  private var available = 0

  @Volatile var bytesIn = 0L
    private set
  @Volatile var bytesDropped = 0L
    private set

  fun write(src: ByteArray, n: Int) = lock.withLock {
    var off = 0
    var writePos = (readPos + available) % capacity
    while (off < n) {
      val len = minOf(n - off, capacity - writePos)
      System.arraycopy(src, off, ring, writePos, len)
      off += len
      writePos = (writePos + len) % capacity
    }
    available += n
    bytesIn += n
    if (available > capacity) {
      val drop = available - capacity
      readPos = (readPos + drop) % capacity
      available = capacity
      bytesDropped += drop
    }
    dataReady.signalAll()
  }

  /** Copies the next [n] bytes into [dst] (from position 0). Returns false if they didn't arrive in time. */
  fun read(dst: ByteBuffer, n: Int, timeoutMs: Long): Boolean = lock.withLock {
    var waitNs = TimeUnit.MILLISECONDS.toNanos(timeoutMs)
    while (available < n) {
      if (waitNs <= 0) return false
      waitNs = dataReady.awaitNanos(waitNs)
    }
    dst.clear()
    var left = n
    while (left > 0) {
      val len = minOf(left, capacity - readPos)
      dst.put(ring, readPos, len)
      readPos = (readPos + len) % capacity
      left -= len
    }
    available -= n
    dst.flip()
    true
  }

  /** Drops everything queued, e.g. samples from before a retune. */
  fun discard() = lock.withLock {
    readPos = 0
    available = 0
  }

  /** Wakes a blocked reader (used when stopping). */
  fun wake() = lock.withLock { dataReady.signalAll() }
}
