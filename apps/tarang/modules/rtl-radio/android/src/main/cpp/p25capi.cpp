// Plain C API for the trunked P25 receiver (p25.cpp), for hosts other than the JNI bridge (p25jni.cpp): the Mac
// radio panel builds it with p25*.cpp, p25voice.cpp and mbelib/ into a dylib and loads it with ctypes. Not part
// of the Android build. Use a handle from one thread; returned strings stay valid until the next call that
// returns one on the same handle.
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "p25.h"

using tarang::p25::Receiver;

namespace {
struct Handle {
  Receiver rx;
  std::string out;
};
Handle* H(void* h) { return static_cast<Handle*>(h); }
}  // namespace

#define P25_API extern "C" __attribute__((visibility("default")))

P25_API void* p25_create() { return new Handle(); }

P25_API void p25_destroy(void* h) { delete H(h); }

P25_API void p25_set_control_channels(void* h, const int64_t* hz, int n) {
  H(h)->rx.setControlChannels(std::vector<int64_t>(hz, hz + (n > 0 ? n : 0)));
}

// Talkgroup flags: 1 = favorite (followed first), 2 = locked out.
P25_API void p25_set_flags(void* h, const int32_t* ids, const int32_t* flags, int n) {
  std::unordered_map<int, int> m;
  for (int i = 0; i < n; i++) m[ids[i]] = flags[i];
  H(h)->rx.setFlags(m);
}

// muted: stay on the control channel (activity only, no calls followed)
P25_API void p25_set_options(void* h, int favoritesOnly, int hangMs, int muted) {
  H(h)->rx.setOptions(favoritesOnly != 0, hangMs, muted != 0);
}

P25_API void p25_set_system(void* h, uint32_t wacn, int sysid, int nac) { H(h)->rx.setSystem(wacn, sysid, nac); }

P25_API void p25_skip(void* h, int64_t nowMs) { H(h)->rx.skip(nowMs); }

P25_API void p25_hold(void* h, int tg) { H(h)->rx.hold(tg); }

// [n] CU8 samples tuned to [hwCenter]; returns the centre frequency the dongle should be tuned to.
P25_API int64_t p25_process(void* h, const uint8_t* iq, int n, int64_t hwCenter, int64_t nowMs) {
  return H(h)->rx.process(iq, n, hwCenter, nowMs);
}

// Fills [frames] interleaved stereo float frames at 48 kHz; returns 1 if any of it was call audio.
P25_API int p25_render(void* h, float* stereo, int frames) { return H(h)->rx.render(stereo, frames) ? 1 : 0; }

// The receiver's state as JSON (numbers and fixed ASCII strings only).
P25_API const char* p25_state(void* h, int64_t nowMs) {
  H(h)->out = H(h)->rx.state(nowMs);
  return H(h)->out.c_str();
}

// Newline-separated JSON lines for calls that ended since the last call ("" when none).
P25_API const char* p25_take_events(void* h) {
  H(h)->out = H(h)->rx.takeEvents();
  return H(h)->out.c_str();
}
