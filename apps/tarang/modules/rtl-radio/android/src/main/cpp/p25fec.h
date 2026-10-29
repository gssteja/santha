// Error-correcting codes of the P25 air interface (TIA-102.BAAA Phase 1 FDMA, TIA-102.BBAC Phase 2 TDMA):
// BCH(63,16,23) for the Phase 1 NID, Golay(23,12) / (24,12), Hamming(15,11) / (10,6), Reed-Solomon codes over
// GF(64) (shortened, and punctured in Phase 2), the rate-1/2 trellis code of TSBKs (soft-decision Viterbi),
// CRC-CCITT and CRC-12, the PN sequence that whitens vocoder frames, the Phase 2 scrambling sequence and the
// Phase 2 ISCH / DUID codes. The encoders are here too: the host tests build their test signals with them.
#pragma once

#include <cstdint>

namespace tarang {
namespace p25 {

// ---------- Reed-Solomon over GF(64) (x^6 + x + 1), roots alpha^1 .. alpha^nroots ----------

class Rs64 {
 public:
  explicit Rs64(int nroots);

  // [data]: k symbols (6 bits each), highest-degree first; writes nroots parity symbols.
  void encode(const uint8_t* data, int k, uint8_t* parity) const;

  // [cw]: a full 63-symbol codeword, highest-degree first. The first [pad] symbols are a shortened code's
  // known zeros; [erasures] are positions (0..62) whose symbols were never sent (punctured parity). Corrects in
  // place; returns the number of symbols corrected (erasures included), or -1 if the word can't be decoded.
  int decode(uint8_t cw[63], int pad, const int* erasures = nullptr, int nerasures = 0) const;

  int nroots() const { return nroots_; }

 private:
  int nroots_;
  uint8_t gen_[29]; // generator polynomial, index (log) form, gen_[nroots] = leading coefficient
};

// The P25 codes as (n, k) after shortening: data first, then parity, symbols highest-degree first.
// Returns symbols corrected or -1; [syms] is corrected in place.
int rsDecode(const Rs64& rs, uint8_t* syms, int n, int k, int punctured = 0);
void rsEncode(const Rs64& rs, uint8_t* syms, int n, int k, int punctured = 0);

const Rs64& rs8();  // RS(24,16,9): Phase 1 encryption sync (LDU2)
const Rs64& rs12(); // RS(24,12,13): Phase 1 link control (LDU1, TDULC)
const Rs64& rs16(); // RS(36,20,17): Phase 1 header (HDU)
const Rs64& rs28(); // RS(63,35,29) shortened / punctured: Phase 2 FACCH, SACCH, ESS

// ---------- binary block codes ----------

// BCH(63,16,23): bit 62 is sent first. Decoding corrects up to 11 errors; returns the count or -1.
uint64_t bchEncode(uint32_t data16);
int bchDecode(uint64_t& cw63);

// Golay(23,12) (generator x^11+x^10+x^6+x^5+x^4+x^2+1), data in the top 12 bits. Returns errors corrected
// (0..3; the code is perfect, so every word decodes to something).
uint32_t golay23Encode(uint32_t d12);
int golay23Decode(uint32_t cw23, uint32_t* d12);
// Extended Golay(24,12): the (23,12) codeword followed by an even-parity bit.
uint32_t golay24Encode(uint32_t d12);
int golay24Decode(uint32_t cw24, uint32_t* d12);

// Hamming(15,11) of IMBE frames; returns 0 or 1 errors corrected.
uint16_t hamming15Encode(uint16_t d11);
int hamming15Decode(uint16_t cw15, uint16_t* d11);
// Hamming(10,6) of link control / encryption sync hexbits; returns errors corrected, or -1 (2 errors seen).
uint16_t hamming10Encode(uint8_t d6);
int hamming10Decode(uint16_t cw10, uint8_t* d6);

// ---------- trellis-coded TSBKs / data blocks ----------

// 12 bytes -> 98 dibits as sent (rate-1/2 trellis code, then the block interleave).
void trellisEncode(const uint8_t bytes[12], uint8_t dibits[98]);
// Soft-decision Viterbi on 98 received symbols (levels -3..+3, in transmission order). Returns the squared
// distance of the best path (0 for a perfect block).
float trellisDecode(const float sym[98], uint8_t bytes[12]);

// ---------- CRCs ----------

uint16_t crcCcitt(const uint8_t* bytes, int n);   // x^16 + x^12 + x^5 + 1, zero start
bool tsbkCrcOk(const uint8_t b[12]);              // TSBK / data header: CRC-CCITT of 10 bytes, inverted
void tsbkCrcSet(uint8_t b[12]);
uint16_t crc12(const uint8_t* bits, int nbits);   // Phase 2 MAC PDUs: x^12+x^11+x^7+x^4+x^2+x+1, inverted

// ---------- vocoder frame whitening ----------

// The linear congruential PN generator of IMBE and AMBE frames: seed 16 * u0, then (173 p + 13849) mod 2^16,
// one bit (the MSB) per step, MSB-first words.
struct Pn {
  uint32_t p;
  explicit Pn(uint32_t u0) : p(16 * u0) {}
  uint32_t bits(int n) {
    uint32_t v = 0;
    for (int i = 0; i < n; i++) {
      p = (173 * p + 13849) & 0xffff;
      v = (v << 1) | (p >> 15);
    }
    return v;
  }
};

// ---------- Phase 2 ----------

constexpr uint64_t P2_SYNC = 0x575D57F7FFULL; // S-ISCH, 20 dibits
// I-ISCH (40,7) codeword for [v] (bits: chn(2) loc(2) fr(1) cnt(2)); decode returns -1 when nothing is within 7 bits.
uint64_t ischEncode(int v);
int ischDecode(uint64_t cw40, int* dist = nullptr);

// Phase 2 DUID: (8,4) code spread over four dibits of each burst.
uint8_t duid2Encode(int duid);
int duid2Decode(uint8_t cw8);

// The superframe scrambling sequence (4320 bits as 2160 dibits) for a system's WACN, system ID and NAC.
void p2Scrambler(uint32_t wacn, uint32_t sysid, uint32_t nac, uint8_t out[2160]);

}  // namespace p25
}  // namespace tarang
