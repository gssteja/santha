#include "dsp.h"

#include <algorithm>
#include <cmath>

namespace tarang {

// ---------- FFT (iterative radix-2, precomputed twiddles) ----------

Fft::Fft(int n) : n_(n), log2n_(0), rev_(n), twr_(n / 2), twi_(n / 2) {
  while ((1 << log2n_) < n) log2n_++;
  for (int i = 0; i < n; i++) {
    int r = 0;
    for (int b = 0; b < log2n_; b++)
      if (i & (1 << b)) r |= 1 << (log2n_ - 1 - b);
    rev_[i] = r;
  }
  for (int k = 0; k < n / 2; k++) {
    twr_[k] = (float)std::cos(-2 * M_PI * k / n);
    twi_[k] = (float)std::sin(-2 * M_PI * k / n);
  }
}

void Fft::run(float* re, float* im, bool inverse) const {
  for (int i = 0; i < n_; i++) {
    int j = rev_[i];
    if (j > i) {
      std::swap(re[i], re[j]);
      std::swap(im[i], im[j]);
    }
  }
  const float sign = inverse ? -1.f : 1.f;
  for (int size = 2; size <= n_; size <<= 1) {
    int half = size >> 1, step = n_ / size;
    for (int start = 0; start < n_; start += size) {
      float* ar = re + start;
      float* ai = im + start;
      float* br = ar + half;
      float* bi = ai + half;
      for (int k = 0; k < half; k++) {
        float wr = twr_[k * step], wi = sign * twi_[k * step];
        float tr = br[k] * wr - bi[k] * wi;
        float ti = br[k] * wi + bi[k] * wr;
        br[k] = ar[k] - tr;
        bi[k] = ai[k] - ti;
        ar[k] += tr;
        ai[k] += ti;
      }
    }
  }
}

// ---------- noise reduction ----------

NoiseReducer::NoiseReducer() : fft_(N), win_(N), re_(N), im_(N), smooth_(BINS), noise_(BINS), gain_(BINS) {
  for (int i = 0; i < N; i++) win_[i] = (float)std::sqrt(0.5 - 0.5 * std::cos(2 * M_PI * i / N));  // periodic
  reset();
}

void NoiseReducer::reset() {
  in_.clear();
  out_.assign(N, 0.f);  // fixed latency, so every call returns as many samples as it gets
  ola_.assign(N, 0.f);
  std::fill(gain_.begin(), gain_.end(), 1.f);
  primed_ = false;
}

void NoiseReducer::process(float* x, int n) {
  in_.insert(in_.end(), x, x + n);
  size_t used = 0;
  while (in_.size() - used >= (size_t)N) {
    const float* f = in_.data() + used;
    for (int i = 0; i < N; i++) {
      re_[i] = f[i] * win_[i];
      im_[i] = 0;
    }
    fft_.run(re_.data(), im_.data());
    for (int k = 0; k < BINS; k++) {
      float p = re_[k] * re_[k] + im_[k] * im_[k] + 1e-12f;
      if (!primed_) smooth_[k] = noise_[k] = p;
      smooth_[k] = 0.8f * smooth_[k] + 0.2f * p;
      noise_[k] = std::min(noise_[k] * 1.004f, smooth_[k]);  // rises ~2x per 0.9 s, drops instantly
      float g = std::max(1 - 2.f * noise_[k] / p, 0.12f);   // subtract twice the noise, keep a floor
      gain_[k] = 0.5f * gain_[k] + 0.5f * g;                  // smoothing avoids "musical noise"
    }
    primed_ = true;
    for (int k = 0; k < BINS; k++) {
      re_[k] *= gain_[k];
      im_[k] *= gain_[k];
      if (k > 0 && k < N / 2) {
        re_[N - k] *= gain_[k];
        im_[N - k] *= gain_[k];
      }
    }
    fft_.run(re_.data(), im_.data(), true);
    const float scale = 1.f / N;
    for (int i = 0; i < N; i++) ola_[i] += re_[i] * scale * win_[i];
    out_.insert(out_.end(), ola_.begin(), ola_.begin() + H);
    std::memmove(ola_.data(), ola_.data() + H, (N - H) * sizeof(float));
    std::fill(ola_.begin() + (N - H), ola_.end(), 0.f);
    used += H;
  }
  in_.erase(in_.begin(), in_.begin() + used);
  int m = std::min<int>(n, (int)out_.size());
  std::memcpy(x, out_.data(), m * sizeof(float));
  out_.erase(out_.begin(), out_.begin() + m);
}

// ---------- Channel ----------

Channel::Channel() {
  ncoCos_.resize(MAX_BLOCK);
  ncoSin_.resize(MAX_BLOCK);
  for (int k = 0; k < 240; k++) {  // 19 kHz at 240 kHz repeats every 240 samples (and 38 kHz every 120)
    double a = 2 * M_PI * 19000.0 * k / MID_FS;
    cos19_[k] = (float)std::cos(a);
    sin19_[k] = (float)std::sin(a);
    cos38_[k] = (float)std::cos(2 * a);
    sin38_[k] = (float)std::sin(2 * a);
  }
  // 2.4 MHz -> 480 kHz: keep +-100 kHz, reject everything that would alias into +-120 kHz (from 360 kHz up)
  stA_.init(lowpass(230000, FS, 70, 260000), 5, MAX_BLOCK, true);
  // 480 kHz -> 240 kHz: keep +-100 kHz, reject from 140 kHz
  stB_.init(lowpass(120000, 480000, 65, 40000), 2, MAX_BLOCK / 5 + 2, true);
  // MPX -> audio: pass 15 kHz, reject the 19 kHz pilot
  auto audioTaps = lowpass(17000, MID_FS, 60, 4000);
  lprAudio_.init(audioTaps, 5, MAX_BLOCK / 10 + 2, false);
  lmrAudio_.init(audioTaps, 5, MAX_BLOCK / 10 + 2, false);
  // 240 kHz -> 48 kHz for the narrow modes: keep +-12 kHz, reject from 36 kHz
  stC_.init(lowpass(24000, MID_FS, 65, 24000), 5, MAX_BLOCK / 10 + 2, true);
  // NFM audio: 4 kHz low-pass
  nfmAudio_.init(lowpass(4000, AUDIO_FS, 50, 1500), 1, MAX_BLOCK / 50 + 2, false);

  midI_.resize(MAX_BLOCK / 10 + 2);
  midQ_.resize(MAX_BLOCK / 10 + 2);
  outI_.resize(MAX_BLOCK / 50 + 2);
  outQ_.resize(MAX_BLOCK / 50 + 2);
  tmp_.resize(MAX_BLOCK / 50 + 2);
  tmp2_.resize(MAX_BLOCK / 50 + 2);
  deemA_ = (float)std::exp(-1.0 / (AUDIO_FS * 75e-6));  // US 75 us de-emphasis
  setOffset((int)(200000LL * MAX_BLOCK / FS));
  configure(WFM, 200000);
}

void Channel::configure(int mode, int bw) {
  mode_ = mode;
  bw_ = bw;
  const bool ssb = mode == USB || mode == LSB || mode == CW;
  if (mode != WFM) {
    // channel filter: -6 dB at bw/2 (SSB/CW pick their sideband later, so they only need 5 kHz), capped to
    // what the 48 kHz stage carries
    double cutoff = ssb ? 5000.0 : std::min(bw / 2.0, 12000.0);
    double trans = std::max(2000.0, cutoff / 2);
    chan_.init(lowpass(cutoff, AUDIO_FS, 60, trans), 1, MAX_BLOCK / 50 + 2, true);
  }
  if (mode == USB || mode == LSB) {
    ssb_.init(lowpass(bw / 2.0, AUDIO_FS, 60, std::max(bw / 4.0, 300.0)), 1, MAX_BLOCK / 50 + 2, true);
  } else if (mode == CW) {
    ssb_.init(lowpass(std::max(bw / 2.0, 100.0), AUDIO_FS, 60, std::max(bw / 2.0, 300.0)), 1, MAX_BLOCK / 50 + 2, true);
  }
  stA_.reset();
  stB_.reset();
  lprAudio_.reset();
  lmrAudio_.reset();
  stC_.reset();
  nfmAudio_.reset();
  nco_ = 0;
  prevI_ = prevQ_ = 0;
  deemL_ = deemR_ = 0;
  dcX_ = dcY_ = 0;
  agc_ = 0.05f;
  gain_ = 4.f;
  shiftPhase_ = bfoPhase_ = 0;
  pilotIdx_ = 0;
  pilotI_ = pilotQ_ = 0;
  stereoActive_ = false;
  nr_.reset();
  rds_.reset();
}

void Channel::setOffset(int cycles) {
  if (cycles == ncoCycles_) return;
  ncoCycles_ = cycles;
  for (int i = 0; i < MAX_BLOCK; i++) {
    double a = -2 * M_PI * (double)cycles * i / MAX_BLOCK;
    ncoCos_[i] = (float)std::cos(a);
    ncoSin_[i] = (float)std::sin(a);
  }
}

void Channel::resetStation() {
  pilotIdx_ = 0;
  pilotI_ = pilotQ_ = 0;
  stereoActive_ = false;
  lmrAudio_.reset();
  agc_ = 0.05f;
  rds_.reset();
}

void Channel::setNoiseReduction(bool on) {
  if (on && !nrOn_) nr_.reset();
  nrOn_ = on;
}

// Block AGC towards 0.2 rms. Returns the new target gain; the caller ramps from the previous one across the
// block so the gain never steps. fastAttack (SSB/CW): jumps down on speech peaks, recovers slowly in pauses.
float Channel::agcGain(const float* x, int count, bool fastAttack) {
  double sq = 0;
  for (int i = 0; i < count; i++) sq += (double)x[i] * x[i];
  float level = count ? (float)std::sqrt(sq / count) : 0.f;
  agc_ = fastAttack ? std::max(level, 0.92f * agc_ + 0.08f * level) : 0.7f * agc_ + 0.3f * level;
  return std::min(0.2f / std::max(agc_, 1e-6f), 2000.f);
}

int Channel::demodulate(const float* ci, const float* cq, int n, float* audio) {
  // mix the channel down to 0 Hz, straight into the first decimator; the table holds one block, so this is
  // at most two straight runs that vectorise
  {
    float* __restrict xi = stA_.inputI();
    float* __restrict xq = stA_.inputQ();
    int k = nco_, i = 0;
    while (i < n) {
      int run = std::min(n - i, MAX_BLOCK - k);
      const float* __restrict c = ncoCos_.data() + k;
      const float* __restrict s = ncoSin_.data() + k;
      for (int j = 0; j < run; j++) {
        xi[i + j] = ci[i + j] * c[j] - cq[i + j] * s[j];
        xq[i + j] = ci[i + j] * s[j] + cq[i + j] * c[j];
      }
      i += run;
      k += run;
      if (k == MAX_BLOCK) k = 0;
    }
    nco_ = k;
  }
  int n480 = stA_.run(n, stB_.inputI(), stB_.inputQ());

  if (mode_ == WFM) {
    int n240 = stB_.run(n480, midI_.data(), midQ_.data());
    return demodWfm(n240, audio);
  }

  int n240 = stB_.run(n480, stC_.inputI(), stC_.inputQ());
  int n48 = stC_.run(n240, chan_.inputI(), chan_.inputQ());
  int count = chan_.run(n48, outI_.data(), outQ_.data());
  float* mono = tmp2_.data();

  if (mode_ == NFM) {
    const float k = AUDIO_FS / (2 * (float)M_PI * 5000);  // +-5 kHz deviation is +-1
    float* d = nfmAudio_.inputI();
    float pi = prevI_, pq = prevQ_;
    for (int i = 0; i < count; i++) {
      float yi = outI_[i], yq = outQ_[i];
      d[i] = fastAtan2(yq * pi - yi * pq, yi * pi + yq * pq) * k;
      pi = yi;
      pq = yq;
    }
    prevI_ = pi;
    prevQ_ = pq;
    count = nfmAudio_.run(count, tmp_.data(), nullptr);
    float x1 = dcX_, y1 = dcY_;
    for (int i = 0; i < count; i++) {
      float y = tmp_[i] - x1 + 0.999f * y1;  // DC block (tuning offset)
      x1 = tmp_[i];
      y1 = y;
      mono[i] = y * 0.5f;
    }
    dcX_ = x1;
    dcY_ = y1;
  } else if (mode_ == AM) {
    // envelope, DC block, then an AGC whose gain ramps across the block instead of stepping
    float x1 = dcX_, y1 = dcY_;
    for (int i = 0; i < count; i++) {
      float e = std::sqrt(outI_[i] * outI_[i] + outQ_[i] * outQ_[i]);
      float y = e - x1 + 0.995f * y1;
      x1 = e;
      y1 = y;
      tmp_[i] = y;
    }
    dcX_ = x1;
    dcY_ = y1;
    float target = agcGain(tmp_.data(), count, false);
    float g = gain_, step = count ? (target - g) / count : 0;
    for (int i = 0; i < count; i++) {
      g += step;
      mono[i] = tmp_[i] * g;
    }
    gain_ = target;
  } else {
    // USB/LSB (Weaver): shift the sideband's centre to 0 Hz, low-pass to bw/2, shift back and keep the real
    // part. CW: low-pass around the carrier, then beat it against a 750 Hz BFO.
    const bool cw = mode_ == CW;
    const double mid = 150 + bw_ / 2.0;
    const double dShift = (mode_ == USB ? -1 : 1) * 2 * M_PI * mid / AUDIO_FS;
    const double dBfo = 2 * M_PI * 750.0 / AUDIO_FS;
    float* zi = ssb_.inputI();
    float* zq = ssb_.inputQ();
    double ph = shiftPhase_;
    if (cw) {
      std::memcpy(zi, outI_.data(), count * sizeof(float));
      std::memcpy(zq, outQ_.data(), count * sizeof(float));
    } else {
      for (int i = 0; i < count; i++) {
        float c = (float)std::cos(ph), s = (float)std::sin(ph);
        zi[i] = outI_[i] * c - outQ_[i] * s;
        zq[i] = outI_[i] * s + outQ_[i] * c;
        ph += dShift;
      }
    }
    int m = ssb_.run(count, outI_.data(), outQ_.data());
    // the back oscillator runs continuously too; its fixed phase offset to the forward one doesn't matter
    double back = bfoPhase_;
    const double dBack = cw ? dBfo : -dShift;
    for (int i = 0; i < m; i++) {
      float c = (float)std::cos(back), s = (float)std::sin(back);
      tmp_[i] = outI_[i] * c - outQ_[i] * s;  // Re(z * e^{j back})
      back += dBack;
    }
    bfoPhase_ = std::fmod(back, 2 * M_PI);
    shiftPhase_ = std::fmod(ph, 2 * M_PI);
    count = m;
    float target = agcGain(tmp_.data(), count, true);
    float g = gain_, step = count ? (target - g) / count : 0;
    for (int i = 0; i < count; i++) {
      g += step;
      mono[i] = tmp_[i] * g;
    }
    gain_ = target;
  }

  if (nrOn_) nr_.process(mono, count);
  for (int i = 0; i < count; i++) {
    float v = std::max(-1.f, std::min(1.f, mono[i]));
    audio[2 * i] = v;
    audio[2 * i + 1] = v;
  }
  return count;
}

int Channel::demodWfm(int n240, float* audio) {
  // polar discriminator, scaled so +-75 kHz deviation is +-1
  const float k = MID_FS / (2 * (float)M_PI * 75000);
  float* mpx = lprAudio_.inputI();
  float pi = prevI_, pq = prevQ_;
  for (int i = 0; i < n240; i++) {
    float yi = midI_[i], yq = midQ_[i];
    mpx[i] = fastAtan2(yq * pi - yi * pq, yi * pi + yq * pq) * k;
    pi = yi;
    pq = yq;
  }
  prevI_ = pi;
  prevQ_ = pq;
  rds_.process(mpx, n240);

  // pilot: the block mean of mpx * e^{-j w19 n} is a narrow low-pass around 19 kHz
  int idx0 = pilotIdx_;
  float pr = 0, pim = 0;
  {
    int idx = idx0;
    for (int i = 0; i < n240; i++) {
      pr += mpx[i] * cos19_[idx];
      pim -= mpx[i] * sin19_[idx];
      if (++idx == 240) idx = 0;
    }
    pilotIdx_ = idx;
  }
  if (n240 > 0) {
    pilotI_ = 0.7f * pilotI_ + 0.3f * pr / n240;
    pilotQ_ = 0.7f * pilotQ_ + 0.3f * pim / n240;
  }
  // the pilot is ~9% of full deviation (|p| ~ 0.045); below ~0.015 there is no usable stereo
  bool active = stereo_ && std::sqrt(pilotI_ * pilotI_ + pilotQ_ * pilotQ_) > 0.015f;
  if (active != stereoActive_) lmrAudio_.reset();
  stereoActive_ = active;

  int count;
  if (active) {
    // subcarrier = -sin(2 (w19 n + theta)), theta = pilot phase; L-R = LPF(2 * mpx * subcarrier)
    float th = std::atan2(pilotQ_, pilotI_);
    float c2 = std::cos(2 * th), s2 = std::sin(2 * th);
    float* lmr = lmrAudio_.inputI();
    int idx = idx0;
    for (int i = 0; i < n240; i++) {
      float sub = -(sin38_[idx] * c2 + cos38_[idx] * s2);
      lmr[i] = 2 * mpx[i] * sub;
      if (++idx == 240) idx = 0;
    }
    count = lprAudio_.run(n240, tmp_.data(), nullptr);
    lmrAudio_.run(n240, tmp2_.data(), nullptr);
  } else {
    count = lprAudio_.run(n240, tmp_.data(), nullptr);
    std::fill(tmp2_.begin(), tmp2_.begin() + count, 0.f);
  }

  float dl = deemL_, dr = deemR_;
  const float a = deemA_;
  for (int i = 0; i < count; i++) {
    float l = tmp_[i] + tmp2_[i], r = tmp_[i] - tmp2_[i];
    dl = (1 - a) * l + a * dl;
    dr = (1 - a) * r + a * dr;
    audio[2 * i] = std::max(-1.f, std::min(1.f, dl * 0.8f));
    audio[2 * i + 1] = std::max(-1.f, std::min(1.f, dr * 0.8f));
  }
  deemL_ = dl;
  deemR_ = dr;
  return count;
}

// ---------- Dsp ----------

Dsp::Dsp() : fft_(FFT_N) {
  for (int i = 0; i < 256; i++) lut_[i] = (i - 127.4f) / 128.f;
  convI_.resize(MAX_BLOCK);
  convQ_.resize(MAX_BLOCK);
  window_.resize(FFT_N);
  for (int i = 0; i < FFT_N; i++) window_[i] = (float)(0.5 - 0.5 * std::cos(2 * M_PI * i / (FFT_N - 1)));
  fre_.resize(FFT_N);
  fim_.resize(FFT_N);
  acc_.resize(FFT_N);
}

int Dsp::process(const uint8_t* iq, int n, float* psd, int psdFrames, float* audioA, float* audioB) {
  n = std::min(n, MAX_BLOCK);
  const int frames = psd ? std::min(psdFrames, n / FFT_N) : 0;
  const int convN = (audioA || audioB) ? n : frames * FFT_N;
  float* __restrict ci = convI_.data();
  float* __restrict cq = convQ_.data();
  for (int i = 0; i < convN; i++) {
    ci[i] = lut_[iq[2 * i]];
    cq[i] = lut_[iq[2 * i + 1]];
  }
  if (frames > 0) spectrum(frames, psd);
  int fa = audioA ? a.demodulate(ci, cq, n, audioA) : 0;
  int fb = audioB ? b.demodulate(ci, cq, n, audioB) : 0;
  return fa | (fb << 16);
}

void Dsp::mix(float* audioA, const float* audioB, int frames, float ga, float gb) {
  for (int i = 0; i < 2 * frames; i++) audioA[i] = std::max(-1.f, std::min(1.f, audioA[i] * ga + audioB[i] * gb));
}

void Dsp::spectrum(int frames, float* out) {
  std::fill(acc_.begin(), acc_.end(), 0.f);
  const float* w = window_.data();
  for (int f = 0; f < frames; f++) {
    const float* xi = convI_.data() + f * FFT_N;
    const float* xq = convQ_.data() + f * FFT_N;
    for (int i = 0; i < FFT_N; i++) {
      fre_[i] = xi[i] * w[i];
      fim_[i] = xq[i] * w[i];
    }
    fft_.run(fre_.data(), fim_.data());
    for (int i = 0; i < FFT_N; i++) acc_[i] += fre_[i] * fre_[i] + fim_[i] * fim_[i];
  }
  const float scale = 1.f / (float)frames;
  const int half = FFT_N / 2;
  for (int i = 0; i < FFT_N; i++) out[i] = acc_[(i + half) % FFT_N] * scale;  // fftshift
}

}  // namespace tarang
