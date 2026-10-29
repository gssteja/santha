// P25 Phase 1 (FDMA, TIA-102.BAAA) framing and decoding on the differential detector's soft values: frame sync
// search, NID (BCH, or a soft maximum-likelihood DUID once the NAC is known), TSDUs (up to three trellis-coded
// TSBKs), voice header, LDU1 / LDU2 (nine IMBE frames each, link control, encryption sync) and terminators.
// Symbol timing comes from each frame's sync (sub-sample peak), which is plenty: even 10 ppm of clock error
// moves a 180 ms LDU by under 1/100 of a symbol.
#pragma once

#include <cstdint>
#include <vector>

namespace tarang {
namespace p25 {

enum P1Duid { HDU = 0x0, TDU = 0x3, LDU1 = 0x5, TSDU = 0x7, LDU2 = 0xA, PDU = 0xC, TDULC = 0xF };

// Link control word (9 bytes) fields for LCO 0, group voice channel user.
struct LinkControl {
  int lco = -1, mfid = 0, opts = 0, group = -1, source = -1;
};

class P1Listener {
 public:
  virtual ~P1Listener() = default;
  virtual void onNid(int nac, int duid, int bchErrors) {}
  virtual void onTsbk(int nac, const uint8_t tsbk[12]) {}
  // voice: header (encryption, talkgroup), link control, encryption sync, terminators
  virtual void onHeader(int nac, int algid, int kid, int tgid) {}
  virtual void onLinkControl(int nac, const uint8_t lc[9]) {}
  virtual void onEncryptionSync(int nac, int algid, int kid) {}
  virtual void onTerminator(int nac) {}
  // one IMBE frame: 88 parameter bits (u0..u7, MSB first, one per byte); errs = bits corrected by the FEC
  virtual void onImbe(const uint8_t bits[88], int errs) {}
};

class P1Framer {
 public:
  P1Framer(int sps, P1Listener* l) : sps_(sps), l_(l) {}
  void reset();
  void setListener(P1Listener* l) { l_ = l; }
  // Soft values from the differential detector, one per 48 kHz sample.
  void process(const float* in, int n);
  // The NAC to expect (enables soft NID decoding); -1 learns it from the first good NID.
  void setNac(int nac) { nac_ = nac; }
  int nac() const { return nac_; }
  // mean squared symbol error of the last frames' sync (in level units), and the last sync's frequency error (Hz)
  float quality() const { return quality_; }
  double takeFreqError(int* n);
  uint32_t frames() const { return frames_; }
  uint32_t syncs() const { return syncs_; }
  uint32_t nidFails() const { return nidFails_; }
  uint32_t tsbks() const { return tsbks_; }
  uint32_t tsbkFails() const { return tsbkFails_; }
  bool inverted() const { return inverted_; }
  // the current frame's sync position (48 kHz samples since reset) and TSDU block being delivered
  double frameStart() const { return frameStart_; }
  int block() const { return blocksDone_ - 1; }

 private:
  static constexpr int RING = 16384; // samples; the longest frame (LDU) is 864 symbols = 8640 samples
  void onSync(double pos, bool inverted, float score);
  void readSymbols();
  void finishNid();
  void finishFrame();
  bool tryBlock(int b); // TSDU block b complete: decode it
  float sampleAt(double pos) const;

  int sps_;
  P1Listener* l_;
  std::vector<float> ring_ = std::vector<float>(RING, 0.f);
  int64_t t_ = 0; // absolute index of the next sample
  // sync search: distance from the sync levels over the last 24 symbols, best match picked over one symbol
  bool armed_ = true;
  float bestErr_ = 1e9f;
  int64_t bestAt_ = -1;
  bool bestInv_ = false;
  float prevE_[3] = {0, 0, 0}; // match error at t-2, t-1, t (for the parabola)
  float peakE_[3] = {0, 0, 0};
  // the frame being read
  bool reading_ = false;
  bool inverted_ = false;
  double symPos_ = 0;  // sample position of the next symbol
  double frameStart_ = 0;
  int sym_ = 0;        // frame symbol index of the next symbol (0 = first sync symbol)
  int want_ = 0;       // symbols to read in total
  int duid_ = -1;
  int frameNac_ = -1;
  int blocksDone_ = 0;
  std::vector<float> sv_ = std::vector<float>(1000); // soft symbols of the frame, status symbols included
  int nac_ = -1;
  int goodNids_ = 0;
  float quality_ = 0;
  double freqErr_ = 0;
  int freqErrN_ = 0;
  uint32_t frames_ = 0, syncs_ = 0, nidFails_ = 0, tsbks_ = 0, tsbkFails_ = 0;
};

// The IMBE frame (de)interleave and FEC, exposed for the tests.
// [bits144]: the frame's 144 bits after deinterleave (c0..c7); out: 88 bits u0..u7. Returns bits corrected.
int imbeDecode(const uint8_t bits144[144], uint8_t out88[88]);
void imbeEncode(const uint8_t in88[88], uint8_t bits144[144]);
// position (0..143) of frame bit i within the frame's 72 dibits as sent
int imbeInterleave(int i);

// Frame layout helpers shared with the tests (status-free bit offsets within an LDU).
extern const int LDU_VOICE_START[9];
extern const int LDU_LC_START[6];

}  // namespace p25
}  // namespace tarang
