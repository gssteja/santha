// NOAA Weather Radio SAME (Specific Area Message Encoding) decoder for demodulated 48 kHz audio: the AFSK
// headers (2083.3 / 1562.5 Hz at 520.83 baud, each sent three times) that start every alert
// ("ZCZC-WXR-TOR-037119+0045-3011925-KGSP/NWS-"), the end-of-message bursts ("NNNN"), and the 1050 Hz
// attention tone.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "filters.h"
#include "fsk.h"

namespace tarang {

class SameDecoder {
 public:
  SameDecoder();

  // [frames] interleaved stereo float frames at 48 kHz (the left channel is used); [nowMs] a monotonic clock.
  void process(const float* stereo, int frames, int64_t nowMs);

  // Newline-separated JSON events since the last call:
  //   {"kind":"header","text":"ZCZC-...","bursts":3}   {"kind":"eom"}   {"kind":"tone","on":true}
  std::string take();

 private:
  void onBit(int bit, int64_t nowMs);
  void endMessage(int64_t nowMs);
  void flushBursts(int64_t nowMs);

  static constexpr int FS = 12000;
  Decimator dec_;
  std::vector<float> mono_, out_;
  ToneFsk fsk_;

  // byte framing
  uint8_t sr_ = 0;
  int bitsLeft_ = 0;  // > 0 while collecting a message, bits until the next byte
  int preamble_ = 0;  // consecutive 0xAB bytes seen
  bool collecting_ = false;
  std::string msg_;

  // the three repeats of one header, combined by majority vote
  std::vector<std::string> bursts_;
  int64_t lastBurstMs_ = 0;
  std::string lastSent_;
  int64_t lastSentMs_ = -1000000;
  int64_t lastEomMs_ = -1000000;

  // 1050 Hz attention tone: tone energy vs total, over ~0.2 s windows
  double toneRe_ = 1, toneIm_ = 0, toneStepRe_ = 1, toneStepIm_ = 0, toneI_ = 0, toneQ_ = 0, total_ = 0;
  int toneN_ = 0, toneRun_ = 0;
  bool toneOn_ = false;

  std::string events_;
};

}  // namespace tarang
