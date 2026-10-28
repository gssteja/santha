// ACARS (aircraft datalink, ARINC 618) receiver: AM-MSK at 2400 bit/s on several 25 kHz channels at once,
// straight from 2.4 MS/s IQ. Per channel: mix to baseband, decimate to 12 kHz, AM envelope, a coherent MSK
// demodulator locked to the 1800 Hz subcarrier (the design acarsdec uses), then the character framing
// (SYN SYN SOH mode address ack label block [STX text] ETX/ETB + CRC-16, 7-bit characters with odd parity).
// Each channel runs the demodulator twice, the second on the mirrored spectrum, so either tone convention
// decodes; the CRC decides which one is right.
#pragma once

#include <complex>
#include <cstdint>
#include <string>
#include <vector>

#include "filters.h"

namespace tarang {

class AcarsDecoder {
 public:
  // [centerHz]: the dongle's tuning; [channelsHz]: up to 8 channels, each within 1 MHz of it, on a 12.5 kHz grid.
  AcarsDecoder(int64_t centerHz, const std::vector<int64_t>& channelsHz);

  // [n] interleaved uint8 I/Q samples at 2.4 MS/s.
  void process(const uint8_t* iq, int n);

  // Newline-separated JSON messages since the last call:
  // {"freq":131.55,"mode":"2","reg":"N123AA","ack":"!","label":"H1","block":"5","down":true,"msgno":"M01A",
  //  "flight":"AA1234","text":"...","level":-24.1}
  std::string take();

  uint32_t messages() const { return messages_; }

 private:
  static constexpr int FS1 = 120000, FS2 = 12000, FLEN = FS2 / 1200 + 1;
  enum State { HUNT, SYN2, SOH1, TEXT, CRC1, CRC2 };

  struct Demod {
    bool mirror = false;
    // MSK demodulator
    double phi = 0, clk = 0, df = 0;
    std::complex<float> buf[FLEN];
    int idx = 0;
    unsigned s = 0;
    float levelSum = 0;
    int levelN = 0;
    // framing
    uint8_t bits = 0;
    int nbits = 1;
    State state = HUNT;
    std::vector<uint8_t> block;
    uint16_t crc = 0;
  };

  struct Chan {
    double freqMhz = 0;
    std::vector<float> ncoRe, ncoIm;
    int nco = 0;
    Decimator d1, d2;
    Demod dem[2];
    std::string last; // the last message, so the mirrored demodulator can't report it twice
  };

  void msk(Chan& ch, Demod& c, float x);
  void putBit(Chan& ch, Demod& c, float v);
  void onByte(Chan& ch, Demod& c);
  void emit(Chan& ch, Demod& c);

  std::vector<Chan> chans_;
  std::vector<float> conv_, mixI_, mixQ_, outI_, outQ_, outI2_, outQ2_;
  float lut_[256];
  float h_[2 * FLEN];
  std::string events_;
  uint32_t messages_ = 0;
};

}  // namespace tarang
