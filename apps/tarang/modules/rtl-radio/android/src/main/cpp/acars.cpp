#include "acars.h"

#include <cmath>
#include <cstdio>

namespace tarang {

namespace {
constexpr uint8_t SOH = 0x01, STX = 0x02, ETX = 0x03, ETB = 0x17, SYN = 0x16, NAK = 0x15;
constexpr int MAX_BLOCK = 240;
constexpr int BLOCK = 153600;
constexpr double PLL_GAIN = 38e-4, PLL_DAMP = 0.52;

uint16_t crcByte(uint16_t crc, uint8_t c) { // CRC-16/KERMIT (CCITT, reflected, zero start)
  crc ^= c;
  for (int k = 0; k < 8; k++) crc = (crc & 1) ? (crc >> 1) ^ 0x8408 : crc >> 1;
  return crc;
}

bool oddParity(uint8_t c) { return __builtin_popcount(c) & 1; }

void json(std::string& out, const char* key, const std::string& v, bool comma = true) {
  if (comma) out += ',';
  out += '"';
  out += key;
  out += "\":\"";
  char buf[8];
  for (char ch : v) {
    const auto u = static_cast<unsigned char>(ch);
    if (ch == '"' || ch == '\\') {
      out += '\\';
      out += ch;
    } else if (u < 0x20 || u >= 0x7f) {
      std::snprintf(buf, sizeof buf, "\\u%04x", u);
      out += buf;
    } else {
      out += ch;
    }
  }
  out += '"';
}
}  // namespace

AcarsDecoder::AcarsDecoder(int64_t centerHz, const std::vector<int64_t>& channelsHz) {
  for (int i = 0; i < 256; i++) lut_[i] = (i - 127.4f) / 128.f;
  for (int i = 0; i < 2 * FLEN; i++) h_[i] = std::cos(2 * M_PI * 600.0 / FS2 * ((i % FLEN) - (FLEN - 1) / 2.0));
  const auto taps1 = lowpass(12000, 2400000, 60, 90000);
  const auto taps2 = lowpass(4500, FS1, 60, 2500);
  for (int64_t f : channelsHz) {
    Chan c;
    c.freqMhz = f / 1e6;
    // 12.5 kHz grid offsets repeat every 192 samples at 2.4 MS/s, so a short table covers the mixer
    const double off = static_cast<double>(f - centerHz);
    c.ncoRe.resize(192);
    c.ncoIm.resize(192);
    for (int k = 0; k < 192; k++) {
      const double p = -2 * M_PI * off * k / 2400000.0;
      c.ncoRe[k] = static_cast<float>(std::cos(p));
      c.ncoIm[k] = static_cast<float>(std::sin(p));
    }
    c.d1.init(taps1, 20, BLOCK, true);
    c.d2.init(taps2, 10, BLOCK / 20 + 2, true);
    c.dem[1].mirror = true;
    chans_.push_back(std::move(c));
  }
  conv_.resize(2 * BLOCK);
  outI_.resize(BLOCK / 20 + 4);
  outQ_.resize(BLOCK / 20 + 4);
  outI2_.resize(BLOCK / 200 + 4);
  outQ2_.resize(BLOCK / 200 + 4);
}

void AcarsDecoder::process(const uint8_t* iq, int n) {
  while (n > 0) {
    const int m = std::min(n, BLOCK);
    for (int i = 0; i < 2 * m; i++) conv_[i] = lut_[iq[i]];
    for (auto& c : chans_) {
      float* xi = c.d1.inputI();
      float* xq = c.d1.inputQ();
      int k = c.nco;
      for (int i = 0; i < m; i++) {
        const float a = conv_[2 * i], b = conv_[2 * i + 1], cr = c.ncoRe[k], ci = c.ncoIm[k];
        xi[i] = a * cr - b * ci;
        xq[i] = a * ci + b * cr;
        if (++k == 192) k = 0;
      }
      c.nco = k;
      const int n1 = c.d1.run(m, outI_.data(), outQ_.data());
      std::copy(outI_.begin(), outI_.begin() + n1, c.d2.inputI());
      std::copy(outQ_.begin(), outQ_.begin() + n1, c.d2.inputQ());
      const int n2 = c.d2.run(n1, outI2_.data(), outQ2_.data());
      for (int i = 0; i < n2; i++) {
        const float e = std::sqrt(outI2_[i] * outI2_[i] + outQ2_[i] * outQ2_[i]);
        msk(c, c.dem[0], e);
        msk(c, c.dem[1], e);
      }
    }
    iq += 2 * m;
    n -= m;
  }
}

// Coherent MSK: a VCO at the 1800 Hz subcarrier (corrected by the PLL), a matched filter two bits long, and
// bits taken alternately from the in-phase and quadrature arms with the sign alternating every second bit.
void AcarsDecoder::msk(Chan& ch, Demod& c, float x) {
  const double inc = 2 * M_PI * 1800.0 / FS2 + c.df;
  c.phi += inc;
  if (c.phi >= 2 * M_PI) c.phi -= 2 * M_PI;
  const float sn = static_cast<float>(std::sin(c.phi));
  c.buf[c.idx] = x * std::complex<float>(static_cast<float>(std::cos(c.phi)), c.mirror ? sn : -sn);
  c.idx = (c.idx + 1) % FLEN;
  c.clk += inc;
  if (c.clk < 3 * M_PI / 2 - inc / 2) return;
  c.clk -= 3 * M_PI / 2;
  std::complex<float> v = 0;
  for (int j = 0, o = FLEN - c.idx; j < FLEN; j++, o++) v += h_[o] * c.buf[j];
  const float lvl = std::abs(v);
  v /= lvl + 1e-8f;
  c.levelSum += lvl;
  c.levelN++;
  float vo, dphi;
  if (c.s & 1) {
    vo = v.imag();
    dphi = vo >= 0 ? -v.real() : v.real();
  } else {
    vo = v.real();
    dphi = vo >= 0 ? v.imag() : -v.imag();
  }
  putBit(ch, c, (c.s & 2) ? -vo : vo);
  c.s++;
  // on the mirrored spectrum the phase error comes out negated: keep the loop's feedback negative
  c.df = PLL_DAMP * c.df + (1 - PLL_DAMP) * PLL_GAIN * (c.mirror ? -dphi : dphi);
}

void AcarsDecoder::putBit(Chan& ch, Demod& c, float v) {
  c.bits = static_cast<uint8_t>((c.bits >> 1) | (v > 0 ? 0x80 : 0)); // least significant bit first
  if (--c.nbits <= 0) onByte(ch, c);
}

void AcarsDecoder::onByte(Chan& ch, Demod& c) {
  const uint8_t b = c.bits;
  switch (c.state) {
    case HUNT:
      if (b == SYN || b == static_cast<uint8_t>(~SYN)) {
        if (b != SYN) c.s ^= 2; // locked upside down: flip every bit from here on
        c.state = SYN2;
        c.nbits = 8;
      } else {
        c.nbits = 1; // slide one bit and look again
      }
      return;
    case SYN2:
      c.state = b == SYN ? SOH1 : HUNT;
      c.nbits = c.state == HUNT ? 1 : 8;
      return;
    case SOH1:
      if (b == SOH) {
        c.state = TEXT;
        c.block.clear();
        c.crc = 0;
        c.nbits = 8;
        c.levelSum = 0;
        c.levelN = 0;
      } else {
        c.state = HUNT;
        c.nbits = 1;
      }
      return;
    case TEXT:
      c.crc = crcByte(c.crc, b);
      c.block.push_back(b);
      c.nbits = 8;
      if ((b & 0x7f) == ETX || (b & 0x7f) == ETB) c.state = CRC1;
      else if (static_cast<int>(c.block.size()) > MAX_BLOCK) {
        c.state = HUNT;
        c.nbits = 1;
      }
      return;
    case CRC1:
      c.crc = crcByte(c.crc, b);
      c.state = CRC2;
      c.nbits = 8;
      return;
    case CRC2:
      c.crc = crcByte(c.crc, b);
      if (c.crc == 0) emit(ch, c);
      c.state = HUNT;
      c.nbits = 1;
      return;
  }
}

void AcarsDecoder::emit(Chan& ch, Demod& c) {
  const auto& b = c.block;
  if (b.size() < 13) return;
  for (uint8_t x : b) if (!oddParity(x)) return; // the CRC passed, but be strict
  std::string s;
  for (uint8_t x : b) s += static_cast<char>(x & 0x7f);
  if (s == ch.last) return;
  ch.last = s;
  const char mode = s[0];
  std::string reg = s.substr(1, 7);
  while (!reg.empty() && (reg[0] == '.' || reg[0] == ' ')) reg.erase(0, 1);
  const char ack = s[8];
  const std::string label = s.substr(9, 2);
  const char blk = s[11];
  std::string text;
  if (s[12] == STX) text = s.substr(13, s.size() - 14); // up to the ETX/ETB
  const bool down = blk >= '0' && blk <= '9';
  std::string msgno, flight;
  if (down && text.size() >= 10) {
    msgno = text.substr(0, 4);
    flight = text.substr(4, 6);
    while (!flight.empty() && flight.back() == ' ') flight.pop_back();
    text = text.substr(10);
  }
  char head[64];
  std::snprintf(head, sizeof head, "{\"freq\":%.3f", ch.freqMhz);
  events_ += head;
  json(events_, "mode", std::string(1, mode));
  json(events_, "reg", reg);
  json(events_, "ack", ack == NAK ? "" : std::string(1, ack));
  json(events_, "label", label);
  json(events_, "block", std::string(1, blk));
  events_ += down ? ",\"down\":true" : ",\"down\":false";
  json(events_, "msgno", msgno);
  json(events_, "flight", flight);
  json(events_, "text", text);
  const float level = c.levelN ? c.levelSum / c.levelN : 0;
  std::snprintf(head, sizeof head, ",\"level\":%.1f}\n", 20 * std::log10(level + 1e-9f));
  events_ += head;
  messages_++;
}

std::string AcarsDecoder::take() {
  std::string out;
  out.swap(events_);
  return out;
}

}  // namespace tarang
