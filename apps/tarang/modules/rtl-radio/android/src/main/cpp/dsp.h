// Signal processing for the radio: spectrum and AM / NFM / WFM / USB / LSB / CW demodulation of 2.4 MS/s
// dongle samples, for up to two channels (A and B) inside the same 2.4 MHz view.
//
// Per channel (all planar float):
//   mix the channel (anywhere in the view, on a 15.625 Hz grid) down to 0 Hz -> /5 to 480 kHz -> /2 to 240 kHz
//   WFM: polar discriminator -> MPX (also feeds RDS and the stereo decoder) -> 15 kHz low-pass /5 to 48 kHz
//        for L+R and L-R -> 75 us de-emphasis
//   others: /5 to 48 kHz -> channel filter, then
//     NFM: discriminator -> 4 kHz low-pass          AM: envelope -> DC block -> AGC
//     USB/LSB: Weaver (centre the sideband, low-pass, shift back) -> AGC   CW: narrow filter -> 750 Hz BFO -> AGC
//     then optional noise reduction
// Audio comes out as interleaved stereo float at 48 kHz.
#pragma once

#include <cstdint>
#include <vector>

#include "filters.h"
#include "rds.h"

namespace tarang {

enum Mode { AM = 0, NFM = 1, WFM = 2, USB = 3, LSB = 4, CW = 5 };

class Fft {
 public:
  explicit Fft(int n);
  // in-place transform of (re, im) given in natural order; inverse = conjugate twiddles, unscaled
  void run(float* re, float* im, bool inverse = false) const;

 private:
  int n_, log2n_;
  std::vector<int> rev_;
  std::vector<float> twr_, twi_;
};

// Spectral noise reduction for voice, as in the Mac panel (and SDR++): learns the hiss spectrum during quiet
// moments by minimum tracking and subtracts it frame by frame. 512-sample frames, 50% overlap, sqrt-Hann.
class NoiseReducer {
 public:
  NoiseReducer();
  void reset();
  // in-place; adds a fixed latency of N samples
  void process(float* x, int n);

 private:
  static constexpr int N = 512, H = 256, BINS = N / 2 + 1;
  Fft fft_;
  std::vector<float> win_, in_, out_, ola_, re_, im_, smooth_, noise_, gain_;
  bool primed_ = false;
};

constexpr int FS = 2400000;
constexpr int MID_FS = 240000;
constexpr int AUDIO_FS = 48000;
constexpr int FFT_N = 2048;
constexpr int MAX_BLOCK = 153600;  // 64 ms

// One demodulator: its own mixer offset, filter chain and decoders.
class Channel {
 public:
  Channel();
  // full reset (new mode/bandwidth, or the hardware was retuned so the filter history is stale)
  void configure(int mode, int bw);
  // listen `cycles` / MAX_BLOCK x FS Hz from the hardware centre (a whole number of cycles per 64 ms block,
  // i.e. a 15.625 Hz grid, so the mixer stays phase-continuous across blocks)
  void setOffset(int cycles);
  // new station inside the same view: forget RDS and the stereo pilot, keep the filter states
  void resetStation();
  void setStereo(bool on) { stereo_ = on; }
  void setNoiseReduction(bool on);
  // FM broadcast de-emphasis time constant: 75 us in the Americas and South Korea, 50 us elsewhere
  void setDeemphasis(double tauUs);
  bool stereoActive() const { return stereoActive_; }
  const RdsDecoder* rds() const { return mode_ == WFM ? &rds_ : nullptr; }

  // demodulates n converted samples; returns the number of stereo frames written to audio
  int demodulate(const float* ci, const float* cq, int n, float* audio);

 private:
  int demodWfm(int n240, float* audio);
  float agcGain(const float* x, int count, bool fastAttack);

  int mode_ = WFM, bw_ = 200000;
  std::vector<float> ncoCos_, ncoSin_;
  int ncoCycles_ = -1, nco_ = 0;

  Decimator stA_, stB_;              // 2.4 MHz -> 480 kHz -> 240 kHz
  Decimator lprAudio_, lmrAudio_;    // MPX 240 kHz -> 48 kHz, L+R and L-R (same filter, so they line up)
  Decimator stC_, chan_, nfmAudio_;  // 240 kHz -> 48 kHz, channel filter, NFM audio filter
  Decimator ssb_;                    // sideband / CW filter at 48 kHz
  std::vector<float> midI_, midQ_, outI_, outQ_, tmp_, tmp2_;
  float prevI_ = 0, prevQ_ = 0;
  float deemA_ = 0, deemL_ = 0, deemR_ = 0;
  float dcX_ = 0, dcY_ = 0;
  float agc_ = 0.05f, gain_ = 4.f;
  double shiftPhase_ = 0, bfoPhase_ = 0;

  // stereo: 19 kHz pilot phase estimated per block (it is locked to the station clock, so it barely moves)
  float cos19_[240], sin19_[240], cos38_[240], sin38_[240];
  int pilotIdx_ = 0;
  float pilotI_ = 0, pilotQ_ = 0;
  bool stereo_ = true, stereoActive_ = false;

  bool nrOn_ = false;
  NoiseReducer nr_;
  RdsDecoder rds_;
};

class Dsp {
 public:
  Dsp();
  Channel a, b;

  // iq: n complex samples (interleaved uint8). Writes the averaged power spectrum of the first psdFrames x
  // FFT_N samples (linear, centred on the hardware frequency) when psd is set, and demodulates channel A
  // and/or B when their audio buffers are set. Returns framesA | framesB << 16.
  int process(const uint8_t* iq, int n, float* psd, int psdFrames, float* audioA, float* audioB);

  void setDeemphasis(double tauUs) { a.setDeemphasis(tauUs); b.setDeemphasis(tauUs); }

  // audioA = clip(audioA * ga + audioB * gb), frames stereo frames
  static void mix(float* audioA, const float* audioB, int frames, float ga, float gb);

 private:
  void spectrum(int frames, float* out);

  float lut_[256];
  std::vector<float> convI_, convQ_;
  Fft fft_;
  std::vector<float> window_, fre_, fim_, acc_;
};

}  // namespace tarang
