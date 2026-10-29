#include "p25demod.h"

#include <cmath>
#include <cstring>

namespace tarang {
namespace p25 {

std::vector<float> rrcTaps(int sps, double alpha, int span) {
  const int n = 2 * span * sps + 1;
  std::vector<float> h(n);
  double sum = 0;
  for (int i = 0; i < n; i++) {
    const double t = (double)(i - span * sps) / sps; // in symbols
    double v;
    if (std::fabs(t) < 1e-9) {
      v = 1 - alpha + 4 * alpha / M_PI;
    } else if (std::fabs(std::fabs(t) - 1 / (4 * alpha)) < 1e-9) {
      v = alpha / std::sqrt(2) * ((1 + 2 / M_PI) * std::sin(M_PI / (4 * alpha)) + (1 - 2 / M_PI) * std::cos(M_PI / (4 * alpha)));
    } else {
      v = (std::sin(M_PI * t * (1 - alpha)) + 4 * alpha * t * std::cos(M_PI * t * (1 + alpha))) /
          (M_PI * t * (1 - 16 * alpha * alpha * t * t));
    }
    h[i] = (float)v;
    sum += v;
  }
  for (auto& x : h) x = (float)(x / sum);
  return h;
}

// ---------- channelizer ----------

Channelizer::Channelizer() {
  for (int i = 0; i < 256; i++) lut_[i] = (i - 127.4f) / 128.f;
  // 2.4 M -> 240 k: flat to 8 kHz, everything that would fold onto +-8 kHz (232 kHz and up) 60 dB down
  d1_.init(lowpass(120000, IQ_FS, 60, 200000), 10, CHUNK, true);
  // 240 k -> 48 k: flat to 8 kHz, 60 dB down from 40 kHz
  d2_.init(lowpass(24000, 240000, 60, 32000), 5, CHUNK / 10 + 2, true);
  t1i_.resize(CHUNK / 10 + 4);
  t1q_.resize(CHUNK / 10 + 4);
  ncoRe_.resize(384);
  ncoIm_.resize(384);
  setOffset(0);
}

void Channelizer::setOffset(int64_t hz) {
  offset_ = hz;
  table_ = hz % 6250 == 0;
  if (table_) {
    for (int k = 0; k < 384; k++) {
      const double p = -2 * M_PI * (double)hz * k / IQ_FS;
      ncoRe_[k] = (float)std::cos(p);
      ncoIm_[k] = (float)std::sin(p);
    }
    ncoIdx_ = 0;
  } else {
    phInc_ = -2 * M_PI * (double)hz / IQ_FS;
  }
}

void Channelizer::reset() {
  d1_.reset();
  d2_.reset();
  ncoIdx_ = 0;
  ph_ = 0;
}

int Channelizer::process(const uint8_t* iq, int n, float* outI, float* outQ) {
  int total = 0;
  while (n > 0) {
    const int m = n < CHUNK ? n : CHUNK;
    float* xi = d1_.inputI();
    float* xq = d1_.inputQ();
    if (table_) {
      int k = ncoIdx_;
      for (int i = 0; i < m; i++) {
        const float a = lut_[iq[2 * i]], b = lut_[iq[2 * i + 1]], cr = ncoRe_[k], ci = ncoIm_[k];
        xi[i] = a * cr - b * ci;
        xq[i] = a * ci + b * cr;
        if (++k == 384) k = 0;
      }
      ncoIdx_ = k;
    } else {
      double p = ph_;
      for (int i = 0; i < m; i++) {
        const float a = lut_[iq[2 * i]], b = lut_[iq[2 * i + 1]];
        const float cr = (float)std::cos(p), ci = (float)std::sin(p);
        xi[i] = a * cr - b * ci;
        xq[i] = a * ci + b * cr;
        p += phInc_;
      }
      ph_ = std::fmod(p, 2 * M_PI);
    }
    const int n1 = d1_.run(m, t1i_.data(), t1q_.data());
    std::memcpy(d2_.inputI(), t1i_.data(), n1 * sizeof(float));
    std::memcpy(d2_.inputQ(), t1q_.data(), n1 * sizeof(float));
    const int n2 = d2_.run(n1, outI + total, outQ + total);
    if (fine_ != 0) {
      const double inc = -2 * M_PI * fine_ / FS;
      double p = finePh_;
      for (int i = total; i < total + n2; i++) {
        const float cr = (float)std::cos(p), ci = (float)std::sin(p), a = outI[i], b = outQ[i];
        outI[i] = a * cr - b * ci;
        outQ[i] = a * ci + b * cr;
        p += inc;
      }
      finePh_ = std::fmod(p, 2 * M_PI);
    }
    total += n2;
    iq += 2 * m;
    n -= m;
  }
  return total;
}

// ---------- differential detector ----------

void DiffDetector::init(int sps, bool rrc) {
  sps_ = sps;
  // the matched filter for 0.2 roll-off; the C4FM path keeps the whole 12.5 kHz channel
  const std::vector<float> taps = rrc ? rrcTaps(sps, 0.2, 6) : lowpass(6000, FS, 50, 3000);
  delay_ = (int)(taps.size() - 1) / 2;
  filt_.init(taps, 1, 4096, true);
  yi_.assign(sps + 4096, 0.f);
  yq_.assign(sps + 4096, 0.f);
  reset();
}

void DiffDetector::reset() {
  filt_.reset();
  std::fill(yi_.begin(), yi_.end(), 0.f);
  std::fill(yq_.begin(), yq_.end(), 0.f);
  freqSum_ = powSum_ = 0;
  freqN_ = 0;
  lastI_ = lastQ_ = 0;
}

void DiffDetector::process(const float* in_i, const float* in_q, int n, float* out) {
  constexpr float K = 4 / (float)M_PI;
  while (n > 0) {
    const int m = n < 4096 ? n : 4096;
    std::memcpy(filt_.inputI(), in_i, m * sizeof(float));
    std::memcpy(filt_.inputQ(), in_q, m * sizeof(float));
    float* yi = yi_.data() + sps_;
    float* yq = yq_.data() + sps_;
    filt_.run(m, yi, yq);
    double fs = 0, ps = 0;
    float li = lastI_, lq = lastQ_;
    for (int k = 0; k < m; k++) {
      const float ai = yi[k], aq = yq[k], bi = yi[k - sps_], bq = yq[k - sps_];
      // y[k] * conj(y[k - sps])
      out[k] = fastAtan2(aq * bi - ai * bq, ai * bi + aq * bq) * K;
      fs += fastAtan2(aq * li - ai * lq, ai * li + aq * lq);
      ps += ai * ai + aq * aq;
      li = ai;
      lq = aq;
    }
    lastI_ = li;
    lastQ_ = lq;
    freqSum_ += fs;
    powSum_ += ps;
    freqN_ += m;
    // keep the last sps filtered samples in front for the next block
    std::memmove(yi_.data(), yi + m - sps_, sps_ * sizeof(float));
    std::memmove(yq_.data(), yq + m - sps_, sps_ * sizeof(float));
    in_i += m;
    in_q += m;
    out += m;
    n -= m;
  }
}

double DiffDetector::takeMeanHz(double* power) {
  const double hz = freqN_ ? freqSum_ / freqN_ * FS / (2 * M_PI) : 0;
  if (power) *power = freqN_ ? powSum_ / freqN_ : 0;
  freqSum_ = powSum_ = 0;
  freqN_ = 0;
  return hz;
}

}  // namespace p25
}  // namespace tarang
