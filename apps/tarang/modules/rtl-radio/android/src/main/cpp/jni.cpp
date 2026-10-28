// JNI bridge for expo.modules.rtlradio.dsp.NativeDsp. Buffers are direct NIO buffers, so blocks move between
// Kotlin, this code and AudioTrack without copies or JNI critical sections. `ch` selects channel A (0) or B (1).
#include <jni.h>

#include <cstdio>
#include <string>

#include "acars.h"
#include "adsb.h"
#include "aprs.h"
#include "dsp.h"
#include "r433.h"
#include "same.h"

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

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDsp_nativeSetDeemphasis(JNIEnv*, jclass, jlong h, jdouble tauUs) {
  dsp(h)->setDeemphasis(tauUs);
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

// ---------- ADS-B (expo.modules.rtlradio.dsp.NativeDecoders) ----------

static tarang::Adsb* adsb(jlong h) { return reinterpret_cast<tarang::Adsb*>(h); }

JNIEXPORT jlong JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_adsbCreate(JNIEnv*, jclass) {
  return reinterpret_cast<jlong>(new tarang::Adsb());
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_adsbDestroy(JNIEnv*, jclass, jlong h) { delete adsb(h); }

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_adsbSetReceiver(
    JNIEnv*, jclass, jlong h, jboolean known, jdouble lat, jdouble lon) {
  if (known) adsb(h)->setReceiver(lat, lon);
  else adsb(h)->clearReceiver();
}

JNIEXPORT jint JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_adsbProcess(JNIEnv* env, jclass, jlong h, jobject iq, jint n, jlong nowMs) {
  auto* in = static_cast<const uint8_t*>(addr(env, iq));
  return in ? adsb(h)->process(in, n, nowMs) : -1;
}

// Writes tarang::AircraftRecord structs into [out]; returns how many.
JNIEXPORT jint JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_adsbSnapshot(JNIEnv* env, jclass, jlong h, jobject out, jlong nowMs) {
  auto* recs = static_cast<tarang::AircraftRecord*>(addr(env, out));
  if (!recs) return 0;
  const int max = static_cast<int>(env->GetDirectBufferCapacity(out) / sizeof(tarang::AircraftRecord));
  return adsb(h)->snapshot(recs, max, nowMs);
}

JNIEXPORT jlong JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_adsbMessages(JNIEnv*, jclass, jlong h) {
  return static_cast<jlong>(adsb(h)->messages());
}

// ---------- audio decoders: NOAA SAME weather alerts, APRS ----------

static jstring takeString(JNIEnv* env, const std::string& s) { return s.empty() ? nullptr : env->NewStringUTF(s.c_str()); }

JNIEXPORT jlong JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_sameCreate(JNIEnv*, jclass) {
  return reinterpret_cast<jlong>(new tarang::SameDecoder());
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_sameDestroy(JNIEnv*, jclass, jlong h) {
  delete reinterpret_cast<tarang::SameDecoder*>(h);
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_sameProcess(
    JNIEnv* env, jclass, jlong h, jobject audio, jint frames, jlong nowMs) {
  auto* a = static_cast<const float*>(addr(env, audio));
  if (a) reinterpret_cast<tarang::SameDecoder*>(h)->process(a, frames, nowMs);
}

// SAME output is built from printable ASCII only, so it's safe for NewStringUTF.
JNIEXPORT jstring JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_sameTake(JNIEnv* env, jclass, jlong h) {
  return takeString(env, reinterpret_cast<tarang::SameDecoder*>(h)->take());
}

JNIEXPORT jlong JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_aprsCreate(JNIEnv*, jclass) {
  return reinterpret_cast<jlong>(new tarang::AprsDecoder());
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_aprsDestroy(JNIEnv*, jclass, jlong h) {
  delete reinterpret_cast<tarang::AprsDecoder*>(h);
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_aprsProcess(
    JNIEnv* env, jclass, jlong h, jobject audio, jint frames, jlong nowMs) {
  auto* a = static_cast<const float*>(addr(env, audio));
  if (a) reinterpret_cast<tarang::AprsDecoder*>(h)->process(a, frames, nowMs);
}

// Packets are JSON with every non-printable byte escaped, so the string is plain ASCII.
JNIEXPORT jstring JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_aprsTake(JNIEnv* env, jclass, jlong h) {
  return takeString(env, reinterpret_cast<tarang::AprsDecoder*>(h)->take());
}

// ---------- ACARS ----------

JNIEXPORT jlong JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_acarsCreate(JNIEnv* env, jclass, jlong centerHz, jlongArray channels) {
  const jsize n = env->GetArrayLength(channels);
  std::vector<int64_t> ch(n);
  env->GetLongArrayRegion(channels, 0, n, reinterpret_cast<jlong*>(ch.data()));
  return reinterpret_cast<jlong>(new tarang::AcarsDecoder(centerHz, ch));
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_acarsDestroy(JNIEnv*, jclass, jlong h) {
  delete reinterpret_cast<tarang::AcarsDecoder*>(h);
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_acarsProcess(JNIEnv* env, jclass, jlong h, jobject iq, jint n) {
  auto* in = static_cast<const uint8_t*>(addr(env, iq));
  if (in) reinterpret_cast<tarang::AcarsDecoder*>(h)->process(in, n);
}

JNIEXPORT jstring JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_acarsTake(JNIEnv* env, jclass, jlong h) {
  return takeString(env, reinterpret_cast<tarang::AcarsDecoder*>(h)->take());
}

// ---------- rtl_433 sensors ----------

static r433_t* r433(jlong h) { return reinterpret_cast<r433_t*>(h); }

JNIEXPORT jlong JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_sensorsCreate(JNIEnv*, jclass, jint rate) {
  return reinterpret_cast<jlong>(r433_create(static_cast<uint32_t>(rate)));
}

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_sensorsDestroy(JNIEnv*, jclass, jlong h) { r433_free(r433(h)); }

JNIEXPORT void JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_sensorsReset(JNIEnv*, jclass, jlong h, jint centerHz) {
  r433_reset(r433(h), static_cast<uint32_t>(centerHz));
}

JNIEXPORT jint JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_sensorsProcess(JNIEnv* env, jclass, jlong h, jobject iq, jint n) {
  auto* in = static_cast<const uint8_t*>(addr(env, iq));
  return in ? r433_process(r433(h), in, static_cast<unsigned>(n)) : -1;
}

// Newline-separated JSON messages decoded since the last call, or null when there are none.
JNIEXPORT jstring JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_sensorsTake(JNIEnv* env, jclass, jlong h) {
  size_t len = 0;
  const char* out = r433_take(r433(h), &len);
  if (!len) return nullptr;
  // NewStringUTF wants modified UTF-8: keep it to printable ASCII (decoders occasionally emit raw bytes)
  std::string s(out, len);
  for (char& c : s) {
    const auto u = static_cast<unsigned char>(c);
    if (u >= 0x80 || (u < 0x20 && c != '\n')) c = '?';
  }
  return env->NewStringUTF(s.c_str());
}

JNIEXPORT jint JNICALL Java_expo_modules_rtlradio_dsp_NativeDecoders_sensorsDecoders(JNIEnv*, jclass, jlong h) {
  return static_cast<jint>(r433_decoders(r433(h)));
}

}  // extern "C"
