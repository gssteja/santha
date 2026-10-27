// FIR design and decimating filters. Everything is planar float (separate I and Q arrays) so the inner
// dot products are straight loops that clang vectorises to NEON at -O3 -ffast-math.
#pragma once

#include <cmath>
#include <cstring>
#include <vector>

namespace tarang {

// Kaiser-window low-pass design: taps for `attenDb` stop-band rejection over a transition of `transHz`.
inline int kaiserTaps(double attenDb, double transHz, double fs) {
  double dw = 2 * M_PI * transHz / fs;
  int n = (int)std::ceil((attenDb - 8) / (2.285 * dw)) + 1;
  return n | 1;  // odd, so the filter has an integer group delay
}

inline double kaiserBeta(double a) {
  if (a > 50) return 0.1102 * (a - 8.7);
  if (a >= 21) return 0.5842 * std::pow(a - 21, 0.4) + 0.07886 * (a - 21);
  return 0;
}

inline double besselI0(double x) {
  double sum = 1, term = 1, q = x * x / 4;
  for (int k = 1; k < 50; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

// Windowed-sinc low-pass with unity DC gain. cutoffHz is the -6 dB point (middle of the transition).
inline std::vector<float> lowpass(double cutoffHz, double fs, double attenDb, double transHz) {
  int n = kaiserTaps(attenDb, transHz, fs);
  double beta = kaiserBeta(attenDb);
  double fc = cutoffHz / fs;
  std::vector<double> h(n);
  double sum = 0, i0b = besselI0(beta), m = (n - 1) / 2.0;
  for (int i = 0; i < n; i++) {
    double t = i - m;
    double sinc = t == 0 ? 2 * fc : std::sin(2 * M_PI * fc * t) / (M_PI * t);
    double r = t / m;
    double w = besselI0(beta * std::sqrt(std::max(0.0, 1 - r * r))) / i0b;
    h[i] = sinc * w;
    sum += h[i];
  }
  std::vector<float> out(n);
  for (int i = 0; i < n; i++) out[i] = (float)(h[i] / sum);
  return out;
}

// Filters with a decimation factor, keeping the last (taps - 1) inputs as history between blocks.
// Callers write new samples straight into input(n) and then call run(), which avoids an extra copy.
class Decimator {
 public:
  void init(const std::vector<float>& taps, int decim, int maxIn, bool complex) {
    rev_.assign(taps.rbegin(), taps.rend());  // reversed, so each output is dot(rev, window)
    decim_ = decim;
    hist_ = (int)taps.size() - 1;
    complex_ = complex;
    bufI_.assign(hist_ + maxIn, 0.f);
    if (complex) bufQ_.assign(hist_ + maxIn, 0.f);
    phase_ = 0;
  }

  void reset() {
    std::fill(bufI_.begin(), bufI_.end(), 0.f);
    std::fill(bufQ_.begin(), bufQ_.end(), 0.f);
    phase_ = 0;
  }

  float* inputI() { return bufI_.data() + hist_; }
  float* inputQ() { return bufQ_.data() + hist_; }
  int maxOut(int n) const { return n / decim_ + 1; }

  // Filters the n samples written to input*(); returns the number of outputs.
  int run(int n, float* __restrict outI, float* __restrict outQ) {
    const int L = hist_ + 1;
    const float* __restrict h = rev_.data();
    const float* xi = bufI_.data();
    const float* xq = complex_ ? bufQ_.data() : nullptr;
    int count = 0;
    int p = phase_;  // window start, in buffer coordinates
    const int end = n;  // window start must be < n so the window ends inside the new data
    if (complex_) {
      for (; p < end; p += decim_) {
        const float* a = xi + p;
        const float* b = xq + p;
        float si = 0, sq = 0;
        for (int j = 0; j < L; j++) {
          si += h[j] * a[j];
          sq += h[j] * b[j];
        }
        outI[count] = si;
        outQ[count] = sq;
        count++;
      }
    } else {
      for (; p < end; p += decim_) {
        const float* a = xi + p;
        float s = 0;
        for (int j = 0; j < L; j++) s += h[j] * a[j];
        outI[count++] = s;
      }
    }
    phase_ = p - n;
    // keep the newest hist_ samples for the next block
    std::memmove(bufI_.data(), bufI_.data() + n, hist_ * sizeof(float));
    if (complex_) std::memmove(bufQ_.data(), bufQ_.data() + n, hist_ * sizeof(float));
    return count;
  }

 private:
  std::vector<float> rev_, bufI_, bufQ_;
  int decim_ = 1, hist_ = 0, phase_ = 0;
  bool complex_ = true;
};

// atan2 accurate to ~2e-6 rad, without the libm call (used per sample by the FM discriminators).
inline float fastAtan2(float y, float x) {
  float ax = std::fabs(x), ay = std::fabs(y);
  float mx = ax > ay ? ax : ay, mn = ax > ay ? ay : ax;
  if (mx == 0) return 0;
  float a = mn / mx;
  float s = a * a;
  float r = a * (0.99997726f + s * (-0.33262347f + s * (0.19354346f + s * (-0.11643287f + s * (0.05265332f + s * -0.01172120f)))));
  if (ay > ax) r = 1.57079637f - r;
  if (x < 0) r = 3.14159274f - r;
  return y < 0 ? -r : r;
}

}  // namespace tarang
