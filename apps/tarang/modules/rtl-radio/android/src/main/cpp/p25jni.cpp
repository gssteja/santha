// JNI bridge for expo.modules.rtlradio.dsp.NativeP25 (P25.kt): the trunked P25 receiver (p25.cpp).
#include <jni.h>

#include <string>
#include <unordered_map>
#include <vector>

#include "p25.h"

using tarang::p25::Receiver;

static Receiver* rx(jlong h) { return reinterpret_cast<Receiver*>(h); }
static void* addr(JNIEnv* env, jobject buf) { return buf ? env->GetDirectBufferAddress(buf) : nullptr; }

extern "C" {

JNIEXPORT jlong JNICALL Java_expo_modules_rtlradio_dsp_NativeP25_create(JNIEnv*, jclass) {
  return reinterpret_cast<jlong>(new Receiver());
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeP25_destroy(JNIEnv*, jclass, jlong h) { delete rx(h); }

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeP25_setControlChannels(JNIEnv* env, jclass, jlong h, jlongArray hz) {
  const jsize n = env->GetArrayLength(hz);
  std::vector<int64_t> v(n);
  env->GetLongArrayRegion(hz, 0, n, reinterpret_cast<jlong*>(v.data()));
  rx(h)->setControlChannels(v);
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeP25_setFlags(JNIEnv* env, jclass, jlong h, jintArray ids, jintArray flags) {
  const jsize n = env->GetArrayLength(ids);
  std::vector<jint> a(n), b(n);
  env->GetIntArrayRegion(ids, 0, n, a.data());
  env->GetIntArrayRegion(flags, 0, n, b.data());
  std::unordered_map<int, int> m;
  for (jsize i = 0; i < n; i++) m[a[i]] = b[i];
  rx(h)->setFlags(m);
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeP25_setOptions(
    JNIEnv*, jclass, jlong h, jboolean favoritesOnly, jint hangMs, jboolean muted) {
  rx(h)->setOptions(favoritesOnly, hangMs, muted);
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeP25_setSystem(JNIEnv*, jclass, jlong h, jint wacn, jint sysid, jint nac) {
  rx(h)->setSystem(static_cast<uint32_t>(wacn), sysid, nac);
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeP25_skip(JNIEnv*, jclass, jlong h, jlong nowMs) { rx(h)->skip(nowMs); }

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeP25_hold(JNIEnv*, jclass, jlong h, jint tg) { rx(h)->hold(tg); }

// Returns the centre frequency the dongle should be tuned to.
JNIEXPORT jlong JNICALL Java_expo_modules_rtlradio_dsp_NativeP25_process(
    JNIEnv* env, jclass, jlong h, jobject iq, jint n, jlong hwCenter, jlong nowMs) {
  auto* in = static_cast<const uint8_t*>(addr(env, iq));
  return in ? rx(h)->process(in, n, hwCenter, nowMs) : hwCenter;
}

// Fills [frames] interleaved stereo float frames at 48 kHz; returns whether any call audio was in them.
JNIEXPORT jboolean JNICALL Java_expo_modules_rtlradio_dsp_NativeP25_render(JNIEnv* env, jclass, jlong h, jobject audio, jint frames) {
  auto* out = static_cast<float*>(addr(env, audio));
  return out ? rx(h)->render(out, frames) : false;
}

// The receiver's state as JSON (numbers and fixed ASCII strings only, so NewStringUTF is safe).
JNIEXPORT jstring JNICALL Java_expo_modules_rtlradio_dsp_NativeP25_state(JNIEnv* env, jclass, jlong h, jlong nowMs) {
  return env->NewStringUTF(rx(h)->state(nowMs).c_str());
}

// Newline-separated JSON lines for calls that ended since the last call, or null.
JNIEXPORT jstring JNICALL Java_expo_modules_rtlradio_dsp_NativeP25_takeEvents(JNIEnv* env, jclass, jlong h) {
  const std::string s = rx(h)->takeEvents();
  return s.empty() ? nullptr : env->NewStringUTF(s.c_str());
}

}  // extern "C"
