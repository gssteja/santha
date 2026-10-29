// P25 Phase 2 (TDMA, TIA-102.BBAC) outbound voice channel decoding on 6000 baud H-DQPSK soft values. The
// channel carries two logical channels in a 360 ms superframe of twelve 30 ms timeslots (180 dibits each): a
// 20-dibit ISCH (S-ISCH sync in slots 2, 3, 6, 7, 10, 11; I-ISCH giving the slot's place in the others), then
// the burst. Bursts are 4V / 2V voice (four or two AMBE+2 half-rate frames), FACCH and SACCH (MAC PDUs,
// Reed-Solomon protected), most of them scrambled with a sequence seeded by the system's WACN, system ID and NAC.
#pragma once

#include <cstdint>
#include <vector>

namespace tarang {
namespace p25 {

// MAC PDU opcodes (top three bits of the first byte)
enum MacOpcode { MAC_SIGNAL = 0, MAC_PTT = 1, MAC_END_PTT = 2, MAC_IDLE = 3, MAC_ACTIVE = 4, MAC_HANGTIME = 6 };

class P2Listener {
 public:
  virtual ~P2Listener() = default;
  virtual void onP2Slot(int slot, int channel, int duid) {}
  // a MAC PDU that passed its CRC (FACCH: 18 bytes, SACCH: 21 bytes) on logical channel [channel] (0 / 1)
  virtual void onMac(int channel, const uint8_t* pdu, int len) {}
  // one AMBE+2 frame: 49 parameter bits (u0 12, u1 12, u2 11, u3 14; MSB first, one per byte)
  virtual void onAmbe(int channel, const uint8_t bits[49], int errs) {}
  // encryption sync from the voice bursts (ESS-B over four 4V bursts + ESS-A in the 2V burst)
  virtual void onP2Ess(int channel, int algid, int kid) {}
};

class P2Framer {
 public:
  explicit P2Framer(P2Listener* l) : l_(l) {}
  void reset();
  void setScrambler(uint32_t wacn, uint32_t sysid, uint32_t nac);
  bool hasScrambler() const { return scrambleSet_; }
  // which logical channel's voice to decode (0 or 1); MAC PDUs of both are reported
  void setChannel(int ch) { channel_ = ch; }
  void process(const float* in, int n);
  bool locked() const { return locked_; }
  int slotIndex() const { return slotIdx_; }
  double takeFreqError(int* n);
  float quality() const { return quality_; }
  uint32_t syncs() const { return syncs_; }
  uint32_t macs() const { return macs_; }
  uint32_t macFails() const { return macFails_; }
  uint32_t voiceFrames() const { return voice_; }

 private:
  static constexpr int SPS = 8, RING = 8192, PKT = 180;
  void onSync(double pos, float score);
  void readSymbols();
  void handlePacket();
  void acch(const uint8_t* d, bool fast, int channel);
  float sampleAt(double pos) const;

  P2Listener* l_;
  std::vector<float> ring_ = std::vector<float>(RING, 0.f);
  int64_t t_ = 0;
  bool armed_ = true;
  float bestErr_ = 1e9f;
  int64_t bestAt_ = -1;
  float prevE_[3] = {0, 0, 0}, peakE_[3] = {0, 0, 0};
  bool locked_ = false;
  double pktStart_ = 0; // sample position of the current packet's first dibit
  int pktSym_ = 0;
  int slotIdx_ = -1;    // superframe slot of the current packet, -1 until an I-ISCH told us
  int sinceSync_ = 0;   // packets since the last S-ISCH
  int badIsch_ = 0;     // consecutive slots without a valid ISCH
  float soft_[PKT];
  uint8_t mask_[2160];
  bool scrambleSet_ = false;
  int channel_ = 0;
  uint8_t essB_[2][16];
  int essBursts_[2] = {0, 0};
  double freqErr_ = 0;
  int freqErrN_ = 0;
  float quality_ = 0;
  uint32_t syncs_ = 0, macs_ = 0, macFails_ = 0, voice_ = 0;
};

// AMBE+2 frame FEC (72 bits as sent -> 49 bits), exposed for the tests. Returns bits corrected.
int ambeDecode(const uint8_t bits72[72], uint8_t out49[49]);
void ambeEncode(const uint8_t in49[49], uint8_t bits72[72]);

// Logical channel (0 / 1) carried in superframe slot [slot]: the two SACCH slots at the end are swapped.
inline int slotChannel(int slot) {
  static const int ch[12] = {0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0};
  return ch[slot % 12];
}

// Length in bytes of a MAC message by opcode (0 = unknown), per TIA-102.BBAD.
int macMessageLength(const uint8_t* msg, int remaining);

// Test helpers: build the FACCH / SACCH dibits of a burst (before scrambling) from a MAC PDU.
void acchEncode(const uint8_t* pdu, bool fast, uint8_t dibits180[180]);

}  // namespace p25
}  // namespace tarang
