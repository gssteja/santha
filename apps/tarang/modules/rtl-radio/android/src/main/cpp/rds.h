// RDS / RBDS decoder: station name (PS), radio text, programme type and PI code.
//
// Input is the FM-demodulated multiplex at 240 kHz. RDS is a 1187.5 bit/s differentially coded biphase
// BPSK stream on a 57 kHz subcarrier, grouped into 26-bit blocks with a 10-bit checkword whose offset
// word identifies the block (A, B, C/C', D). Ported from the Mac radio panel's rds.py, made streaming
// (sample by sample) and with a Costas loop for the carrier so cheap sticks' clock drift is tracked.
#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <unordered_map>

#include "filters.h"

namespace tarang {

class RdsDecoder {
 public:
  RdsDecoder();
  void reset();
  // mpx: n samples at 240 kHz
  void process(const float* mpx, int n);

  bool hasInfo() const { return pi_ >= 0 || !ps_.empty(); }
  int pi() const { return pi_; }
  int pty() const { return pty_; }
  const std::string& ps() const { return ps_; }
  const std::string& rt() const { return rt_; }
  bool synced() const { return synced_; }
  int groups() const { return groupsOk_; }

 private:
  static constexpr int MPX_FS = 240000;
  static constexpr int DEC = 10;
  static constexpr int FS = MPX_FS / DEC;  // 24 kHz
  static constexpr double T = FS / 1187.5;  // ~20.21 samples per bit
  static constexpr int HALF = 10;           // round(T / 2): biphase matched filter half-length
  static constexpr int PHASES = 24;         // timing search resolution within one bit
  static constexpr int TIMING_BLOCK = 1536; // samples between bit-timing updates (64 ms)
  static constexpr int MAX_IN = 16384;

  void sample(float r);
  void bit(int b);
  void group(const int g[4]);
  void psSegment(int seg, int d);
  void rtSegment(int ab, int seg, int version, int c, int d);

  // front end
  float ncoCos_[80], ncoSin_[80];
  int nco_ = 0;
  Decimator dec1_, chan_;
  std::vector<float> tmpI_, tmpQ_, outI_, outQ_;
  // Costas loop
  float phase_ = 0, freq_ = 0, power_ = 1e-6f;
  // matched filter + timing
  float raw_[2 * HALF] = {0};
  int64_t n_ = 0;  // absolute index of the newest raw sample
  float mf_[64] = {0};
  float energy_[PHASES] = {0}, acc_[PHASES] = {0};
  int accCount_ = 0;
  double tPhase_ = -1;  // bit timing in samples; < 0 until the first estimate
  int64_t nextBit_ = INT64_MIN;
  int prevBit_ = 0;
  // block sync
  uint32_t reg_ = 0;
  int64_t nbits_ = 0;
  bool synced_ = false;
  int count_ = 0, blockIdx_ = 0, bad_ = 0;
  int64_t lastHitBits_ = -1;
  int lastHitIdx_ = 0;
  int group_[4];
  // decoded
  int pi_ = -1, pty_ = -1;
  int psSegs_[4];
  std::string psCandidate_, ps_;
  std::array<std::array<int, 4>, 16> rtSegs_;
  std::array<int, 16> rtLen_;
  int rtAb_ = -1;
  std::string rt_;
  int groupsOk_ = 0;
};

}  // namespace tarang
