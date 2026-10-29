// P25 receiver front end. The channelizer takes the dongle's 2.4 MS/s CU8 samples, mixes one channel to
// baseband and decimates to 48 kHz complex (2.4 M -> 240 k -> 48 k). A differential detector then turns that
// into one soft value per 48 kHz sample: the phase change over the last symbol period, in units of pi/4, so the
// four symbols sit at +3, +1, -1, -3. That single measure covers every P25 modulation: C4FM (4-level FM at
// +-600 / +-1800 Hz, i.e. +-pi/4 and +-3pi/4 per 4800 baud symbol), LSM / CQPSK simulcast control channels and
// Phase 2 H-DQPSK (6000 baud) alike. The C4FM path uses a plain channel filter (the differential phase over a
// symbol is then the TIA receiver's FM discriminator + integrate-and-dump); the PSK path uses a root-raised-
// cosine matched filter.
#pragma once

#include <cstdint>
#include <vector>

#include "filters.h"

namespace tarang {
namespace p25 {

constexpr int IQ_FS = 2'400'000;
constexpr int FS = 48'000;

// Dibit <-> symbol level: 01 -> +3, 00 -> +1, 10 -> -1, 11 -> -3.
inline int slice(float v) { return v > 2 ? 1 : v > 0 ? 0 : v > -2 ? 2 : 3; }
constexpr float LEVELS[4] = {1, 3, -1, -3};

class Channelizer {
 public:
  Channelizer();
  // The channel's offset from the hardware centre (Hz). Offsets on the 6.25 kHz raster use an exact mixer table.
  void setOffset(int64_t hz);
  int64_t offset() const { return offset_; }
  // Fine frequency correction (AFC), applied at 48 kHz: the signal is shifted by -hz.
  void setFine(double hz) { fine_ = hz; }
  double fine() const { return fine_; }
  void reset();
  // [n] CU8 samples in; returns the 48 kHz samples written to outI / outQ (about n / 50).
  int process(const uint8_t* iq, int n, float* outI, float* outQ);

 private:
  static constexpr int CHUNK = 76'800; // 32 ms
  int64_t offset_ = 0;
  bool table_ = true;
  std::vector<float> ncoRe_, ncoIm_; // 384-sample period: every 6.25 kHz multiple repeats within it
  int ncoIdx_ = 0;
  double ph_ = 0, phInc_ = 0; // free-running mixer for off-raster offsets
  double fine_ = 0, finePh_ = 0;
  float lut_[256];
  Decimator d1_, d2_;
  std::vector<float> t1i_, t1q_;
};

// Receive filter + differential phase detector for one symbol rate.
class DiffDetector {
 public:
  // [sps]: samples per symbol at 48 kHz (10 for 4800 baud, 8 for 6000); [rrc]: matched filter, else channel filter.
  void init(int sps, bool rrc);
  void reset();
  // [n] samples in; writes n soft values to [out]. Also accumulates the mean instantaneous frequency (for
  // acquiring a signal whose offset is too large for the symbol-level AFC).
  void process(const float* i, const float* q, int n, float* out);
  int sps() const { return sps_; }
  // Mean instantaneous frequency (Hz) since the last call, and the mean signal power.
  double takeMeanHz(double* power = nullptr);
  int delay() const { return delay_; } // filter group delay, samples

 private:
  int sps_ = 10, delay_ = 0;
  Decimator filt_;
  std::vector<float> yi_, yq_; // filtered, with the last sps samples of the previous block in front
  double freqSum_ = 0, powSum_ = 0;
  int freqN_ = 0;
  float lastI_ = 0, lastQ_ = 0;
};

std::vector<float> rrcTaps(int sps, double alpha, int spanSymbols);

}  // namespace p25
}  // namespace tarang
