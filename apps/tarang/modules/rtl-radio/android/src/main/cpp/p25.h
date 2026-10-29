// P25 trunked radio receiver for 2.4 MS/s blocks: follows the control channel, and on a voice grant retunes
// (inside the dongle's view when the channel fits, otherwise by asking for a hardware retune) to the call's
// FDMA channel or TDMA slot, decodes the voice and returns to the control channel when the call ends.
// Encrypted calls are never vocoded: frames wait until the call is known to be clear (grant service options or
// the voice channel's algorithm ID) and are dropped if it isn't.
#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "p25demod.h"
#include "p25p1.h"
#include "p25p2.h"
#include "p25trunk.h"
#include "p25voice.h"

namespace tarang {
namespace p25 {

class Receiver : public P1Listener, public P2Listener {
 public:
  Receiver();

  void setControlChannels(const std::vector<int64_t>& hz) { trunk_.setControlChannels(hz); }
  void setFlags(const std::unordered_map<int, int>& flags) { trunk_.setFlags(flags); }
  void setOptions(bool favoritesOnly, int hangMs, bool muted);
  // WACN / system ID / NAC to use for the TDMA scrambler until the control channel announces them (0 = none)
  void setSystem(uint32_t wacn, int sysid, int nac);
  void skip(int64_t nowMs) { trunk_.skipCall(nowMs); }
  void hold(int tg) { trunk_.setHold(tg); }

  // [n] CU8 samples tuned to [hwCenter]. Returns the centre the dongle should be tuned to.
  int64_t process(const uint8_t* iq, int n, int64_t hwCenter, int64_t nowMs);
  // Exactly [frames] stereo 48 kHz frames of call audio (silence when there's none); true if any was audible.
  bool render(float* stereo, int frames);
  std::string state(int64_t nowMs);
  std::string takeEvents() { return trunk_.takeEvents(); }

  // P1Listener
  void onNid(int nac, int duid, int errs) override;
  void onTsbk(int nac, const uint8_t tsbk[12]) override;
  void onHeader(int nac, int algid, int kid, int tgid) override;
  void onLinkControl(int nac, const uint8_t lc[9]) override;
  void onEncryptionSync(int nac, int algid, int kid) override;
  void onTerminator(int nac) override;
  void onImbe(const uint8_t bits[88], int errs) override;
  // P2Listener
  void onP2Slot(int slot, int channel, int duid) override;
  void onMac(int channel, const uint8_t* pdu, int len) override;
  void onAmbe(int channel, const uint8_t bits[49], int errs) override;
  void onP2Ess(int channel, int algid, int kid) override;

  const Trunk& trunk() const { return trunk_; }
  int64_t retunes() const { return retunes_; }

 private:
  struct Frame {
    bool imbe;
    int errs;
    uint8_t bits[88];
  };
  void reconfigure(const Channel& t, int64_t hwCenter);
  int64_t chooseCenter(int64_t f) const;
  void voiceFrame(bool imbe, const uint8_t* bits, int nbits, int errs);
  void vocode(const Frame& f);
  void evaluatePaths();

  Channelizer chan_;
  DiffDetector wide_, rrc_, rrc6_;
  // Both receive paths run all the time: TSBKs are taken from either (each misses different frames at low SNR),
  // voice and the rest from the path with the cleaner frame syncs.
  struct Path : P1Listener {
    Receiver* rx = nullptr;
    int idx = 0;
    void onNid(int nac, int duid, int errs) override;
    void onTsbk(int nac, const uint8_t tsbk[12]) override;
    void onHeader(int nac, int algid, int kid, int tgid) override;
    void onLinkControl(int nac, const uint8_t lc[9]) override;
    void onEncryptionSync(int nac, int algid, int kid) override;
    void onTerminator(int nac) override;
    void onImbe(const uint8_t bits[88], int errs) override;
  };
  Path paths_[2];
  P1Framer p1_[2] = {P1Framer(10, nullptr), P1Framer(10, nullptr)}; // C4FM path, CQPSK path
  int primary_ = 0;
  uint32_t lastFrames_[2] = {0, 0};
  int64_t evalAt_ = 0;
  struct RecentTsbk {
    double pos; // frame sync position, aligned for the path's filter delay
    int block;
    uint8_t b[10];
  };
  RecentTsbk recent_[8] = {};
  int recentIdx_ = 0;
  uint32_t tsbksIn_ = 0;
  P2Framer p2_;
  Trunk trunk_;
  Vocoder voc_;
  std::vector<float> bi_, bq_, sa_, sb_;
  Channel cur_;
  bool curValid_ = false;
  int64_t curHw_ = 0, want_ = 0;
  double fine_ = 0;
  int64_t lastSyncMs_ = -1000000;
  int64_t now_ = 0;
  uint32_t sysWacn_ = 0;
  int sysId_ = -1, sysNac_ = -1;
  int64_t retunes_ = 0;
  // audio: 8 kHz vocoder frames -> x6 polyphase interpolator -> 48 kHz FIFO
  std::vector<Frame> pending_;
  std::vector<float> up_;     // interpolator taps
  float hist_[64] = {0};
  std::vector<float> fifo_;
  size_t fifoHead_ = 0, fifoLen_ = 0;
  bool playing_ = false;
  float agc_ = 1.f;
  int callTg_ = -1;
};

}  // namespace p25
}  // namespace tarang
