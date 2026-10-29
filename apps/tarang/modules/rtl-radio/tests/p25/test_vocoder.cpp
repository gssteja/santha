// Stand-in for p25voice.cpp (mbelib isn't run on the host): records every frame handed to the vocoder and
// returns a 1 kHz tone so the audio path has something to carry.
#include <cmath>
#include <cstring>
#include <vector>

#include "p25voice.h"
#include "test_vocoder.h"

std::vector<VocFrame> g_vocFrames;

namespace tarang {
namespace p25 {

struct Vocoder::State {
  double ph = 0;
};

Vocoder::Vocoder() : st_(new State) {}
Vocoder::~Vocoder() { delete st_; }
void Vocoder::reset() { st_->ph = 0; }

static void tone(double& ph, float out[160]) {
  for (int i = 0; i < 160; i++) {
    out[i] = 0.3f * (float)std::sin(ph);
    ph += 2 * M_PI * 1000 / 8000;
  }
}

void Vocoder::imbe(const uint8_t bits[88], int errs, float out[160]) {
  VocFrame f;
  f.imbe = true;
  f.errs = errs;
  std::memcpy(f.bits, bits, 88);
  g_vocFrames.push_back(f);
  tone(st_->ph, out);
}

void Vocoder::ambe(const uint8_t bits[49], int errs, float out[160]) {
  VocFrame f;
  f.imbe = false;
  f.errs = errs;
  std::memset(f.bits, 0, sizeof f.bits);
  std::memcpy(f.bits, bits, 49);
  g_vocFrames.push_back(f);
  tone(st_->ph, out);
}

}  // namespace p25
}  // namespace tarang
