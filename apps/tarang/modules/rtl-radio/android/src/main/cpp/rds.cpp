#include "rds.h"

#include <algorithm>
#include <cmath>

namespace tarang {

namespace {

constexpr uint32_t POLY = 0x5B9;  // x^10 + x^8 + x^7 + x^5 + x^4 + x^3 + 1
// offset words: A, B, C, C', D
constexpr uint32_t OFFSETS[5] = {0x0FC, 0x198, 0x168, 0x350, 0x1B4};
constexpr int BLOCK_INDEX[5] = {0, 1, 2, 2, 3};

uint32_t remainder26(uint32_t x) {
  for (int i = 25; i >= 10; i--) {
    if (x & (1u << i)) x ^= POLY << (i - 10);
  }
  return x & 0x3FF;
}

int offsetOf(uint32_t rem) {
  for (int k = 0; k < 5; k++)
    if (OFFSETS[k] == rem) return k;
  return -1;
}

// syndrome -> error pattern for every burst of up to 2 adjacent bit errors (corrected reliably)
struct Corrections {
  int32_t table[1024];
  Corrections() {
    std::fill(std::begin(table), std::end(table), -1);
    for (int length = 1; length <= 2; length++) {
      uint32_t burst = (1u << length) - 1;
      for (int shift = 0; shift <= 26 - length; shift++) {
        uint32_t e = burst << shift;
        uint32_t s = remainder26(e);
        if (table[s] < 0) table[s] = (int32_t)e;
      }
    }
  }
};

const Corrections& corrections() {
  static Corrections c;
  return c;
}

// the corrected block if it is valid for `offset` (possibly after fixing a short error burst), else -1
int64_t correctBlock(uint32_t block, int offset) {
  uint32_t syndrome = remainder26(block) ^ OFFSETS[offset];
  if (syndrome == 0) return block;
  int32_t e = corrections().table[syndrome];
  return e < 0 ? -1 : (int64_t)(block ^ (uint32_t)e);
}

char rdsChar(int c) { return (c >= 32 && c < 127) ? (char)c : ' '; }

std::string collapseSpaces(const std::string& s) {
  std::string out;
  bool space = false;
  for (char ch : s) {
    if (ch == ' ') {
      space = !out.empty();
    } else {
      if (space) out += ' ';
      out += ch;
      space = false;
    }
  }
  return out;
}

}  // namespace

RdsDecoder::RdsDecoder() {
  for (int k = 0; k < 80; k++) {  // 57 kHz at 240 kHz repeats every 80 samples
    double a = -2 * M_PI * 57000.0 * k / MPX_FS;
    ncoCos_[k] = (float)std::cos(a);
    ncoSin_[k] = (float)std::sin(a);
  }
  // keep 0-2.4 kHz, reject what would alias back in from 21.6 kHz and up
  dec1_.init(lowpass(12000, MPX_FS, 60, 19200), DEC, MAX_IN, true);
  // reject the L-R stereo sidebands, which land 4 kHz away after the mix
  chan_.init(lowpass(3200, FS, 55, 1600), 1, MAX_IN / DEC + 2, true);
  tmpI_.resize(MAX_IN / DEC + 2);
  tmpQ_.resize(MAX_IN / DEC + 2);
  outI_.resize(MAX_IN / DEC + 2);
  outQ_.resize(MAX_IN / DEC + 2);
  reset();
}

void RdsDecoder::reset() {
  dec1_.reset();
  chan_.reset();
  nco_ = 0;
  phase_ = freq_ = 0;
  power_ = 1e-6f;
  std::fill(std::begin(raw_), std::end(raw_), 0.f);
  std::fill(std::begin(mf_), std::end(mf_), 0.f);
  std::fill(std::begin(energy_), std::end(energy_), 0.f);
  std::fill(std::begin(acc_), std::end(acc_), 0.f);
  n_ = -1;
  accCount_ = 0;
  tPhase_ = -1;
  nextBit_ = INT64_MIN;
  prevBit_ = 0;
  reg_ = 0;
  nbits_ = 0;
  synced_ = false;
  count_ = blockIdx_ = bad_ = 0;
  lastHitBits_ = -1;
  std::fill(std::begin(group_), std::end(group_), -1);
  pi_ = pty_ = -1;
  std::fill(std::begin(psSegs_), std::end(psSegs_), -1);
  psCandidate_.clear();
  ps_.clear();
  rtLen_.fill(0);
  rtAb_ = -1;
  rt_.clear();
  groupsOk_ = 0;
}

void RdsDecoder::process(const float* mpx, int n) {
  // Costas loop gains: ~20 Hz loop bandwidth at 24 kHz, damping 0.707
  constexpr float ALPHA = 0.0074f, BETA = 2.7e-5f;
  while (n > 0) {
    int m = std::min(n, MAX_IN);
    float* xi = dec1_.inputI();
    float* xq = dec1_.inputQ();
    int k = nco_;
    for (int i = 0; i < m; i++) {
      xi[i] = mpx[i] * ncoCos_[k];
      xq[i] = mpx[i] * ncoSin_[k];
      if (++k == 80) k = 0;
    }
    nco_ = k;
    int c1 = dec1_.run(m, tmpI_.data(), tmpQ_.data());
    std::memcpy(chan_.inputI(), tmpI_.data(), c1 * sizeof(float));
    std::memcpy(chan_.inputQ(), tmpQ_.data(), c1 * sizeof(float));
    int c2 = chan_.run(c1, outI_.data(), outQ_.data());

    for (int i = 0; i < c2; i++) {
      float c = std::cos(phase_), s = std::sin(phase_);
      float zi = outI_[i] * c + outQ_[i] * s;
      float zq = outQ_[i] * c - outI_[i] * s;
      power_ += 0.001f * (zi * zi + zq * zq - power_);
      // BPSK phase error, normalised by the average power so the loop gain doesn't depend on signal level
      float e = zi * zq / (power_ + 1e-12f);
      e = std::max(-1.f, std::min(1.f, e));
      freq_ += BETA * e;
      phase_ += freq_ + ALPHA * e;
      if (phase_ > (float)M_PI) phase_ -= 2 * (float)M_PI;
      else if (phase_ < -(float)M_PI) phase_ += 2 * (float)M_PI;
      sample(zi);
    }
    mpx += m;
    n -= m;
  }
}

// ---------- signal -> bits ----------
void RdsDecoder::sample(float r) {
  n_++;
  raw_[n_ % (2 * HALF)] = r;
  if (n_ < 2 * HALF - 1) return;
  const int64_t s = n_ - (2 * HALF - 1);  // start of the matched-filter window
  float a = 0, b = 0;
  for (int k = 0; k < HALF; k++) a += raw_[(s + k) % (2 * HALF)];
  for (int k = HALF; k < 2 * HALF; k++) b += raw_[(s + k) % (2 * HALF)];
  const float mf = a - b;
  mf_[s & 63] = mf;

  // bit timing: the phase (within one bit) where the matched filter has the most energy
  double off = (double)s - T * std::floor((double)s / T);
  int bin = (int)std::lround(off / T * PHASES) % PHASES;
  acc_[bin] += mf * mf;
  if (++accCount_ >= TIMING_BLOCK) {
    int best = 0;
    for (int p = 0; p < PHASES; p++) {
      energy_[p] = 0.8f * energy_[p] + 0.2f * acc_[p];
      acc_[p] = 0;
      if (energy_[p] > energy_[best]) best = p;
    }
    accCount_ = 0;
    double bestOff = best * (T / PHASES);
    if (tPhase_ < 0) {
      tPhase_ = bestOff;
    } else {  // move towards the best phase the shortest way round, so bits are never skipped or repeated
      double d = bestOff - tPhase_ + T / 2;
      d = d - T * std::floor(d / T) - T / 2;
      tPhase_ += 0.3 * d;
    }
  }
  if (tPhase_ < 0) return;
  if (nextBit_ == INT64_MIN) nextBit_ = (int64_t)std::ceil((s - tPhase_) / T) + 1;
  while (true) {
    int64_t pos = std::llround(tPhase_ + nextBit_ * T);
    if (pos > s) break;
    if (pos > s - 64) {
      int bv = mf_[pos & 63] > 0 ? 1 : 0;
      bit(bv ^ prevBit_);  // differential decoding
      prevBit_ = bv;
    }
    nextBit_++;
  }
}

// ---------- bits -> blocks -> groups ----------
void RdsDecoder::bit(int b) {
  reg_ = ((reg_ << 1) | (uint32_t)b) & 0x3FFFFFF;
  nbits_++;
  if (!synced_) {
    int name = offsetOf(remainder26(reg_));
    if (name < 0) return;
    int idx = BLOCK_INDEX[name];
    if (lastHitBits_ >= 0) {
      int64_t dist = nbits_ - lastHitBits_;
      if (dist % 26 == 0 && dist <= 26 * 6 && (lastHitIdx_ + dist / 26) % 4 == idx) {
        synced_ = true;
        count_ = bad_ = 0;
        blockIdx_ = idx;
        std::fill(std::begin(group_), std::end(group_), -1);
        group_[idx] = (int)(reg_ >> 10);
        return;
      }
    }
    lastHitBits_ = nbits_;
    lastHitIdx_ = idx;
    return;
  }

  if (++count_ < 26) return;
  count_ = 0;
  int expect = (blockIdx_ + 1) % 4;
  int64_t fixed = -1;
  if (expect == 2) {
    fixed = correctBlock(reg_, 2);
    if (fixed < 0) fixed = correctBlock(reg_, 3);
  } else {
    fixed = correctBlock(reg_, expect == 3 ? 4 : expect);
  }
  if (fixed >= 0) {
    group_[expect] = (int)(fixed >> 10);
    bad_ = std::max(0, bad_ - 1);
  } else {
    group_[expect] = -1;
    if (++bad_ > 10) {
      synced_ = false;
      lastHitBits_ = -1;
    }
  }
  blockIdx_ = expect;
  if (expect == 3) {
    group(group_);
    std::fill(std::begin(group_), std::end(group_), -1);
  }
}

void RdsDecoder::group(const int g[4]) {
  int a = g[0], b = g[1], c = g[2], d = g[3];
  if (b < 0) return;
  if (a >= 0) pi_ = a;
  int gtype = b >> 12, version = (b >> 11) & 1;
  pty_ = (b >> 5) & 0x1F;
  groupsOk_++;
  if (gtype == 0 && d >= 0) psSegment(b & 0x3, d);
  else if (gtype == 2) rtSegment((b >> 4) & 1, b & 0xF, version, c, d);
}

// Station name: 4 segments of 2 characters, kept as they arrive. A name is shown once all 4 are present and
// the same name has been assembled twice in a row, which keeps stations that scroll text through it readable.
void RdsDecoder::psSegment(int seg, int d) {
  psSegs_[seg] = d;
  for (int v : psSegs_)
    if (v < 0) return;
  std::string name;
  for (int w : psSegs_) {
    name += rdsChar(w >> 8);
    name += rdsChar(w & 0xFF);
  }
  if (name == psCandidate_) ps_ = collapseSpaces(name);
  psCandidate_ = name;
}

// Radio text ("now playing"): up to 16 segments, kept as they arrive; shown once complete.
void RdsDecoder::rtSegment(int ab, int seg, int version, int c, int d) {
  std::array<int, 4> chars{};
  int len;
  if (version == 0) {
    if (c < 0 || d < 0) return;
    chars = {c >> 8, c & 0xFF, d >> 8, d & 0xFF};
    len = 4;
  } else {
    if (d < 0) return;
    chars = {d >> 8, d & 0xFF, 0, 0};
    len = 2;
  }
  if (ab != rtAb_) {  // the station flagged a new text
    rtLen_.fill(0);
    rtAb_ = ab;
  }
  rtSegs_[seg] = chars;
  rtLen_[seg] = len;
  std::string text;
  for (int i = 0; i < 16; i++) {
    if (rtLen_[i] == 0) return;  // still missing a segment
    bool end = false;
    for (int k = 0; k < rtLen_[i]; k++) {
      if (rtSegs_[i][k] == 0x0D) {
        end = true;
        break;
      }
      text += rdsChar(rtSegs_[i][k]);
    }
    if (end) break;
  }
  std::string cleaned = collapseSpaces(text);
  if (!cleaned.empty()) rt_ = cleaned;
}

}  // namespace tarang
