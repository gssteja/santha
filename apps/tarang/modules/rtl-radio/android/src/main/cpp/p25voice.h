// Speech synthesis for P25 vocoder frames whose FEC the decoder has already done: IMBE full rate (Phase 1,
// 88 parameter bits) and AMBE+2 half rate (Phase 2, 49 bits). p25voice.cpp implements it with mbelib (vendored
// in mbelib/, ISC licence); the host tests link a stand-in that records the frames instead.
#pragma once

#include <cstdint>

namespace tarang {
namespace p25 {

class Vocoder {
 public:
  Vocoder();
  ~Vocoder();
  void reset();
  // 160 samples at 8 kHz into [out], roughly +-1 full scale. [errs]: bits corrected by the FEC (mbelib repeats
  // or mutes frames that needed too many).
  void imbe(const uint8_t bits[88], int errs, float out[160]);
  void ambe(const uint8_t bits[49], int errs, float out[160]);

 private:
  struct State;
  State* st_;
};

}  // namespace p25
}  // namespace tarang
