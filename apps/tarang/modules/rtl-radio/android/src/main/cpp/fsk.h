// Two-tone FSK demodulator for audio: sliding one-bit correlators against the mark and space tones, and a DPLL
// that recovers the bit clock from the decision transitions. Used for NOAA SAME (520.83 baud) and APRS (1200 baud).
#pragma once

#include <algorithm>
#include <cmath>
#include <vector>

namespace tarang {

class ToneFsk {
 public:
  // spaceGain scales the space tone's energy before comparing (compensates for pre-emphasis / filter tilt).
  void init(double fs, double markHz, double spaceHz, double baud, float spaceGain = 1.f, double pllGain = 0.15) {
    n_ = std::max(2, (int)std::lround(fs / baud));
    ring_.assign(n_ * 4, 0.0);
    idx_ = 0;
    mI_ = mQ_ = sI_ = sQ_ = 0;
    mRe_ = 1, mIm_ = 0, sRe_ = 1, sIm_ = 0;
    mStepRe_ = std::cos(2 * M_PI * markHz / fs), mStepIm_ = std::sin(2 * M_PI * markHz / fs);
    sStepRe_ = std::cos(2 * M_PI * spaceHz / fs), sStepIm_ = std::sin(2 * M_PI * spaceHz / fs);
    inc_ = baud / fs;
    phase_ = 0;
    gain_ = pllGain;
    spaceGain_ = spaceGain;
    prev_ = false;
    since_ = 0;
  }

  // One audio sample in; returns true when a bit was sampled (in *bit: 1 = mark). *quality: |d| / energy at
  // the sample, 0..1, for squelching noise.
  inline bool push(float x, int* bit, float* quality = nullptr) {
    // rotate the two local oscillators (renormalised now and then so they don't drift in amplitude)
    double t = mRe_ * mStepRe_ - mIm_ * mStepIm_;
    mIm_ = mRe_ * mStepIm_ + mIm_ * mStepRe_;
    mRe_ = t;
    t = sRe_ * sStepRe_ - sIm_ * sStepIm_;
    sIm_ = sRe_ * sStepIm_ + sIm_ * sStepRe_;
    sRe_ = t;
    if (++since_ >= 4096) {
      since_ = 0;
      double a = 1 / std::sqrt(mRe_ * mRe_ + mIm_ * mIm_), b = 1 / std::sqrt(sRe_ * sRe_ + sIm_ * sIm_);
      mRe_ *= a, mIm_ *= a, sRe_ *= b, sIm_ *= b;
      // and rebuild the running sums from the ring, so rounding can't accumulate either
      mI_ = mQ_ = sI_ = sQ_ = 0;
      for (int k = 0; k < n_; k++) {
        mI_ += ring_[k * 4], mQ_ += ring_[k * 4 + 1], sI_ += ring_[k * 4 + 2], sQ_ += ring_[k * 4 + 3];
      }
    }
    double* r = &ring_[idx_ * 4];
    const double a = x * mRe_, b = x * mIm_, c = x * sRe_, d = x * sIm_;
    mI_ += a - r[0], mQ_ += b - r[1], sI_ += c - r[2], sQ_ += d - r[3];
    r[0] = a, r[1] = b, r[2] = c, r[3] = d;
    if (++idx_ == n_) idx_ = 0;

    const double em = mI_ * mI_ + mQ_ * mQ_;
    const double es = (sI_ * sI_ + sQ_ * sQ_) * spaceGain_;
    const bool cur = em > es;
    // transitions should land on phase 0: nudge the clock toward them
    if (cur != prev_) {
      if (phase_ < 0.5) phase_ -= gain_ * phase_;
      else phase_ += gain_ * (1 - phase_);
      prev_ = cur;
    }
    const double before = phase_;
    phase_ += inc_;
    if (phase_ >= 1) phase_ -= 1;
    if (before < 0.5 && phase_ >= 0.5) { // mid-bit: the window covers one whole bit
      *bit = cur ? 1 : 0;
      if (quality) *quality = (float)(std::fabs(em - es) / (em + es + 1e-12));
      return true;
    }
    return false;
  }

 private:
  int n_ = 2, idx_ = 0, since_ = 0;
  std::vector<double> ring_; // per sample: mark I, Q, space I, Q products
  double mI_ = 0, mQ_ = 0, sI_ = 0, sQ_ = 0;
  double mRe_ = 1, mIm_ = 0, sRe_ = 1, sIm_ = 0, mStepRe_ = 1, mStepIm_ = 0, sStepRe_ = 1, sStepIm_ = 0;
  double inc_ = 0, phase_ = 0, gain_ = 0.15;
  float spaceGain_ = 1;
  bool prev_ = false;
};

}  // namespace tarang
