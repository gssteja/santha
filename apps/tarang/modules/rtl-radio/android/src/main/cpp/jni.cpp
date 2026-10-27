// JNI bridge for expo.modules.rtlradio.dsp.NativeDsp. Buffers are direct NIO buffers, so blocks move between
// Kotlin, this code and AudioTrack without copies or JNI critical sections. `ch` selects channel A (0) or B (1).
#include <jni.h>

#include <cstdio>

#include "dsp.h"

using tarang::Channel;
using tarang::Dsp;

static Dsp* dsp(jlong h) { return reinterpret_cast<Dsp*>(h); }
static Channel& chan(jlong h, jint ch) { return ch ? dsp(h)->b : dsp(h)->a; }

static void* addr(JNIEnv* env, jobject buf) { return buf ? env->GetDirectBufferAddress(buf) : nullptr; }

extern "C" {

JNIEXPORT jlong JNICALL Java_expo_modules_rtlradio_dsp_NativeDsp_nativeCreate(JNIEnv*, jclass) {
  return reinterpret_cast<jlong>(new Dsp());
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDsp_nativeDestroy(JNIEnv*, jclass, jlong h) {
  delete dsp(h);
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDsp_nativeConfigure(JNIEnv*, jclass, jlong h, jint ch, jint mode, jint bw) {
  chan(h, ch).configure(mode, bw);
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDsp_nativeSetOffset(JNIEnv*, jclass, jlong h, jint ch, jint cycles) {
  chan(h, ch).setOffset(cycles);
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDsp_nativeResetStation(JNIEnv*, jclass, jlong h, jint ch) {
  chan(h, ch).resetStation();
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDsp_nativeSetOptions(JNIEnv*, jclass, jlong h, jint ch, jboolean stereo, jboolean nr) {
  chan(h, ch).setStereo(stereo);
  chan(h, ch).setNoiseReduction(nr);
}

JNIEXPORT jboolean JNICALL Java_expo_modules_rtlradio_dsp_NativeDsp_nativeStereoActive(JNIEnv*, jclass, jlong h, jint ch) {
  return chan(h, ch).stereoActive();
}

JNIEXPORT jint JNICALL Java_expo_modules_rtlradio_dsp_NativeDsp_nativeProcess(
    JNIEnv* env, jclass, jlong h, jobject iq, jint n, jobject psd, jint psdFrames, jobject audioA, jobject audioB) {
  auto* in = static_cast<const uint8_t*>(addr(env, iq));
  if (!in) return -1;
  return dsp(h)->process(in, n, static_cast<float*>(addr(env, psd)), psdFrames, static_cast<float*>(addr(env, audioA)),
                         static_cast<float*>(addr(env, audioB)));
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDsp_nativeMix(
    JNIEnv* env, jclass, jobject audioA, jobject audioB, jint frames, jfloat ga, jfloat gb) {
  Dsp::mix(static_cast<float*>(addr(env, audioA)), static_cast<const float*>(addr(env, audioB)), frames, ga, gb);
}

// [pi (hex, or ""), pty (index, or ""), ps, rt, synced ("1"/"0"), groups decoded]; null when nothing decoded yet
JNIEXPORT jobjectArray JNICALL Java_expo_modules_rtlradio_dsp_NativeDsp_nativeRdsInfo(JNIEnv* env, jclass, jlong h, jint ch) {
  const tarang::RdsDecoder* r = chan(h, ch).rds();
  if (!r || !r->hasInfo()) return nullptr;
  char pi[8] = "", pty[8] = "", groups[16];
  if (r->pi() >= 0) snprintf(pi, sizeof pi, "%04X", r->pi());
  if (r->pty() >= 0) snprintf(pty, sizeof pty, "%d", r->pty());
  snprintf(groups, sizeof groups, "%d", r->groups());
  const char* fields[6] = {pi, pty, r->ps().c_str(), r->rt().c_str(), r->synced() ? "1" : "0", groups};
  jobjectArray out = env->NewObjectArray(6, env->FindClass("java/lang/String"), nullptr);
  for (int i = 0; i < 6; i++) {
    jstring s = env->NewStringUTF(fields[i]);
    env->SetObjectArrayElement(out, i, s);
    env->DeleteLocalRef(s);
  }
  return out;
}

}  // extern "C"
