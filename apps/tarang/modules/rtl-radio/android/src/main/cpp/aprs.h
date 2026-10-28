// APRS / AX.25 packet decoder for demodulated 48 kHz audio: Bell 202 AFSK (1200 / 2200 Hz, 1200 baud), NRZI,
// HDLC framing with bit unstuffing, the FCS check and AX.25 UI frame addresses. Several slicers with different
// mark/space balances run side by side (transmitters' pre-emphasis varies) and duplicates are dropped.
// The APRS payload itself (positions, Mic-E, weather) is parsed in Kotlin.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "fsk.h"

namespace tarang {

class AprsDecoder {
 public:
  AprsDecoder();

  // [frames] interleaved stereo float frames at 48 kHz (left channel used); [nowMs] a monotonic clock.
  void process(const float* stereo, int frames, int64_t nowMs);

  // Newline-separated JSON packets since the last call: {"src":"N0CALL-9","dst":"APRS","path":["WIDE1-1*"],"info":"!..."}
  std::string take();

  uint32_t frames() const { return frames_; }

  // CRC-16/X.25 over [n] bytes (exposed for the host test's modulator).
  static uint16_t fcs(const uint8_t* p, int n);

 private:
  struct Slicer {
    ToneFsk fsk;
    int lastTone = 0;
    uint8_t hist = 0;
    int ones = 0;
    bool inFrame = false;
    uint8_t byte = 0;
    int nbits = 0;
    std::vector<uint8_t> frame;
  };

  void onBit(Slicer& s, int tone, int64_t nowMs);
  void onFrame(const std::vector<uint8_t>& f, int64_t nowMs);

  std::vector<Slicer> slicers_;
  std::vector<std::pair<uint16_t, int64_t>> recent_; // FCS + time of recently accepted frames
  std::string events_;
  uint32_t frames_ = 0;
};

}  // namespace tarang
