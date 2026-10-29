// Test signal generator: P25 Phase 1 frames (TSDU, HDU, LDU1/2, TDU, TDULC) and Phase 2 superframes, the
// C4FM / CQPSK / H-DQPSK modulators, and a simulated dongle that mixes transmitters into 2.4 MS/s CU8 samples
// at whatever centre the receiver asks for.
#pragma once

#include <array>
#include <cmath>
#include <complex>
#include <cstring>
#include <functional>
#include <random>
#include <vector>

#include "p25demod.h"
#include "p25fec.h"
#include "p25p1.h"
#include "p25p2.h"

namespace gen {

using namespace tarang::p25;
using cf = std::complex<float>;
using Dibits = std::vector<uint8_t>;

constexpr uint64_t P1_SYNC = 0x5575F5FF77FFULL;

inline void putBits(std::vector<uint8_t>& bits, uint64_t v, int n) {
  for (int i = n - 1; i >= 0; i--) bits.push_back(v >> i & 1);
}

inline Dibits bitsToDibits(const std::vector<uint8_t>& b) {
  Dibits d(b.size() / 2);
  for (size_t i = 0; i < d.size(); i++) d[i] = (uint8_t)(b[2 * i] << 1 | b[2 * i + 1]);
  return d;
}

// ---------- Phase 1 ----------

// Raw frame from status-free dibits (sync and NID included): inserts a status symbol after every 35 dibits.
inline Dibits insertStatus(const Dibits& sf, uint8_t status = 2) {
  Dibits raw;
  for (size_t i = 0; i < sf.size(); i++) {
    raw.push_back(sf[i]);
    if (raw.size() % 36 == 35) raw.push_back(status);
  }
  return raw;
}

inline std::vector<uint8_t> syncNidBits(int nac, int duid) {
  std::vector<uint8_t> b;
  putBits(b, P1_SYNC, 48);
  const uint64_t cw = bchEncode((uint32_t)(nac << 4 | duid));
  putBits(b, cw, 63);
  b.push_back(duid == LDU1 || duid == LDU2 ? 1 : 0);
  return b;
}

inline void tsbkFinish(uint8_t t[12], bool last) {
  if (last) t[0] |= 0x80;
  else t[0] &= 0x7f;
  tsbkCrcSet(t);
}

inline Dibits tsdu(int nac, std::vector<std::array<uint8_t, 12>> tsbks) {
  std::vector<uint8_t> b = syncNidBits(nac, TSDU);
  Dibits sf = bitsToDibits(b);
  for (size_t i = 0; i < tsbks.size(); i++) {
    tsbkFinish(tsbks[i].data(), i + 1 == tsbks.size());
    uint8_t d[98];
    trellisEncode(tsbks[i].data(), d);
    sf.insert(sf.end(), d, d + 98);
  }
  return insertStatus(sf);
}

inline std::array<uint8_t, 12> tsbk(int opcode, int mfid, std::initializer_list<uint8_t> args) {
  std::array<uint8_t, 12> t{};
  t[0] = (uint8_t)opcode;
  t[1] = (uint8_t)mfid;
  int i = 2;
  for (uint8_t a : args) t[i++] = a;
  return t;
}

// TSBK builders (OP25 / TIA-102.AABC field layouts)
inline std::array<uint8_t, 12> idenUp(int iden, int64_t baseHz, int spacingHz, int bwHz = 12500, int64_t txOffHz = -45000000) {
  // iden(4) bw(9) toff(9: sign + 8 x 250 kHz) spacing(10, 125 Hz) base(32, 5 Hz)
  const int bw = bwHz / 125, sp = spacingHz / 125;
  const int toff = (txOffHz >= 0 ? 0x100 : 0) | (int)(std::llabs(txOffHz) / 250000);
  const uint32_t base = (uint32_t)(baseHz / 5);
  const uint64_t v = (uint64_t)iden << 60 | (uint64_t)bw << 51 | (uint64_t)toff << 42 | (uint64_t)sp << 32 | base;
  std::array<uint8_t, 12> t{};
  t[0] = 0x3D;
  for (int i = 0; i < 8; i++) t[2 + i] = (uint8_t)(v >> (56 - 8 * i));
  return t;
}

inline std::array<uint8_t, 12> idenUpTdma(int iden, int64_t baseHz, int spacingHz, int type = 3) {
  const int sp = spacingHz / 125;
  const int toff = 0x2000 | 360; // mobile Tx +45 MHz at 125 kHz units... any value; not used by the receiver
  const uint64_t v = (uint64_t)iden << 60 | (uint64_t)type << 56 | (uint64_t)toff << 42 | (uint64_t)sp << 32 | (uint32_t)(baseHz / 5);
  std::array<uint8_t, 12> t{};
  t[0] = 0x33;
  for (int i = 0; i < 8; i++) t[2 + i] = (uint8_t)(v >> (56 - 8 * i));
  return t;
}

inline std::array<uint8_t, 12> netStatus(uint32_t wacn, int sysid, int ch) {
  // lra(8) wacn(20) sysid(12) ch(16) ssc(8)
  const uint64_t v = (uint64_t)0x01 << 56 | (uint64_t)wacn << 36 | (uint64_t)sysid << 24 | (uint64_t)ch << 8 | 0x70;
  std::array<uint8_t, 12> t{};
  t[0] = 0x3B;
  for (int i = 0; i < 8; i++) t[2 + i] = (uint8_t)(v >> (56 - 8 * i));
  return t;
}

inline std::array<uint8_t, 12> rfssStatus(int sysid, int rfss, int site, int ch) {
  // lra(8) r/a(4) sysid(12) rfss(8) site(8) ch(16) ssc(8)
  const uint64_t v = (uint64_t)0x01 << 56 | (uint64_t)0x1 << 52 | (uint64_t)sysid << 40 | (uint64_t)rfss << 32 | (uint64_t)site << 24 |
                     (uint64_t)ch << 8 | 0x70;
  std::array<uint8_t, 12> t{};
  t[0] = 0x3A;
  for (int i = 0; i < 8; i++) t[2 + i] = (uint8_t)(v >> (56 - 8 * i));
  return t;
}

inline std::array<uint8_t, 12> grant(int opts, int ch, int tg, int src) {
  return tsbk(0x00, 0, {(uint8_t)opts, (uint8_t)(ch >> 8), (uint8_t)ch, (uint8_t)(tg >> 8), (uint8_t)tg, (uint8_t)(src >> 16),
                        (uint8_t)(src >> 8), (uint8_t)src});
}

inline std::array<uint8_t, 12> grantUpdate(int ch1, int tg1, int ch2, int tg2) {
  return tsbk(0x02, 0, {(uint8_t)(ch1 >> 8), (uint8_t)ch1, (uint8_t)(tg1 >> 8), (uint8_t)tg1, (uint8_t)(ch2 >> 8), (uint8_t)ch2,
                        (uint8_t)(tg2 >> 8), (uint8_t)tg2});
}

inline std::array<uint8_t, 12> idle() { return tsbk(0x2C, 0, {0, 0, 0, 0, 0, 0, 0, 0}); } // a filler (unit reg response)

// Link control words (9 bytes) to RS(24,12) -> 24 hexbits
inline void lcHexbits(const uint8_t lc[9], uint8_t hb[24]) {
  for (int i = 0, j = 0; i < 9; i += 3, j += 4) {
    hb[j] = lc[i] >> 2;
    hb[j + 1] = (uint8_t)((lc[i] & 3) << 4 | lc[i + 1] >> 4);
    hb[j + 2] = (uint8_t)((lc[i + 1] & 15) << 2 | lc[i + 2] >> 6);
    hb[j + 3] = lc[i + 2] & 63;
  }
  rsEncode(rs12(), hb, 24, 12);
}

inline Dibits ldu(int nac, int duid, const std::vector<std::array<uint8_t, 88>>& imbe, const uint8_t lcOrEss[12]) {
  std::vector<uint8_t> bits = syncNidBits(nac, duid);
  bits.resize(1680, 0);
  for (int f = 0; f < 9; f++) {
    uint8_t c[144];
    imbeEncode(imbe[f].data(), c);
    for (int i = 0; i < 144; i++) bits[LDU_VOICE_START[f] + imbeInterleave(i)] = c[i];
  }
  uint8_t hb[24];
  if (duid == LDU1) {
    lcHexbits(lcOrEss, hb);
  } else { // ESS: MI(72) algid(8) kid(16) -> 16 hexbits, RS(24,16)
    std::vector<uint8_t> eb;
    for (int i = 0; i < 12; i++) putBits(eb, lcOrEss[i], 8);
    for (int i = 0; i < 16; i++) {
      hb[i] = 0;
      for (int j = 0; j < 6; j++) hb[i] = (uint8_t)(hb[i] << 1 | eb[6 * i + j]);
    }
    rsEncode(rs8(), hb, 24, 16);
  }
  for (int i = 0; i < 24; i++) {
    const uint16_t cw = hamming10Encode(hb[i]);
    for (int j = 0; j < 10; j++) {
      const int k = 10 * i + j;
      bits[LDU_LC_START[k / 40] + k % 40] = cw >> (9 - j) & 1;
    }
  }
  return insertStatus(bitsToDibits(bits));
}

inline Dibits hdu(int nac, int algid, int kid, int tgid) {
  std::vector<uint8_t> bits = syncNidBits(nac, HDU);
  std::vector<uint8_t> hdr;
  for (int i = 0; i < 9; i++) putBits(hdr, 0x11 * i, 8); // MI
  putBits(hdr, 0, 8);                                    // MFID
  putBits(hdr, algid, 8);
  putBits(hdr, kid, 16);
  putBits(hdr, tgid, 16);
  uint8_t hb[36];
  for (int i = 0; i < 20; i++) {
    hb[i] = 0;
    for (int j = 0; j < 6; j++) hb[i] = (uint8_t)(hb[i] << 1 | hdr[6 * i + j]);
  }
  rsEncode(rs16(), hb, 36, 20);
  for (int i = 0; i < 36; i++) putBits(bits, golay24Encode(hb[i]) & 0x3ffff, 18);
  bits.resize(112 + 648 + 10, 0);
  return insertStatus(bitsToDibits(bits));
}

inline Dibits tdu(int nac) {
  std::vector<uint8_t> bits = syncNidBits(nac, TDU);
  bits.resize(140, 0);
  return insertStatus(bitsToDibits(bits));
}

// ---------- Phase 2 ----------

struct P2Burst {
  enum Kind { IDLE_SACCH, FACCH, SACCH, V4, V2 } kind = IDLE_SACCH;
  uint8_t mac[21] = {0};
  std::array<std::array<uint8_t, 49>, 4> ambe{};
  uint8_t ess[16 + 28] = {0}; // ESS-B (16) + ESS-A (28) hexbits of the superframe; bursts take their part
  int essPart = 0;            // 4V: which quarter of ESS-B
};

// One 180-dibit slot.
inline Dibits p2Slot(int slot, const P2Burst& b, const uint8_t mask[2160]) {
  Dibits d(180, 0);
  uint64_t isch;
  if (slot % 4 >= 2) {
    isch = P2_SYNC;
  } else {
    const int loc = slot / 4, chn = slot % 4;
    isch = ischEncode(chn << 5 | loc << 3);
  }
  for (int i = 0; i < 20; i++) d[i] = isch >> (38 - 2 * i) & 3;
  int duid = 12;
  switch (b.kind) {
    case P2Burst::IDLE_SACCH:
    case P2Burst::SACCH: duid = 3; acchEncode(b.mac, false, d.data()); break;
    case P2Burst::FACCH: duid = 9; acchEncode(b.mac, true, d.data()); break;
    case P2Burst::V4:
    case P2Burst::V2: {
      duid = b.kind == P2Burst::V4 ? 0 : 6;
      const int starts[4] = {21, 58, 106, 143};
      for (int f = 0; f < (duid == 0 ? 4 : 2); f++) {
        uint8_t vf[72];
        ambeEncode(b.ambe[f].data(), vf);
        for (int i = 0; i < 36; i++) d[starts[f] + i] = (uint8_t)(vf[2 * i] << 1 | vf[2 * i + 1]);
      }
      if (duid == 0) {
        for (int i = 0; i < 4; i++) {
          const uint8_t h = b.ess[4 * b.essPart + i];
          d[94 + 3 * i] = h >> 4;
          d[95 + 3 * i] = h >> 2 & 3;
          d[96 + 3 * i] = h & 3;
        }
      } else {
        for (int i = 0, j = 94; i < 28; i++) {
          const uint8_t h = b.ess[16 + i];
          d[j] = h >> 4;
          d[j + 1] = h >> 2 & 3;
          d[j + 2] = h & 3;
          j += i == 15 ? 4 : 3;
        }
      }
      break;
    }
  }
  for (int i = 10; i < 180; i++) d[i] ^= mask[slot * 180 + i - 10];
  const uint8_t dc = duid2Encode(duid);
  d[20] = dc >> 6;
  d[57] = dc >> 4 & 3;
  d[142] = dc >> 2 & 3;
  d[179] = dc & 3;
  // the ISCH isn't scrambled
  for (int i = 0; i < 20; i++) d[i] = isch >> (38 - 2 * i) & 3;
  return d;
}

inline void essEncode(int algid, int kid, uint8_t ess[44]) {
  std::vector<uint8_t> eb;
  putBits(eb, algid, 8);
  putBits(eb, kid, 16);
  for (int i = 0; i < 9; i++) putBits(eb, 0x5a, 8);
  for (int i = 0; i < 16; i++) {
    ess[i] = 0;
    for (int j = 0; j < 6; j++) ess[i] = (uint8_t)(ess[i] << 1 | eb[6 * i + j]);
  }
  rsEncode(rs28(), ess, 44, 16);
}

inline void macPtt(uint8_t m[21], int algid, int src, int tg) {
  std::memset(m, 0, 21);
  m[0] = MAC_PTT << 5;
  for (int i = 1; i <= 9; i++) m[i] = (uint8_t)(0x10 + i);
  m[10] = (uint8_t)algid;
  m[11] = 0;
  m[12] = algid == 0x80 ? 0 : 0x42;
  m[13] = (uint8_t)(src >> 16);
  m[14] = (uint8_t)(src >> 8);
  m[15] = (uint8_t)src;
  m[16] = (uint8_t)(tg >> 8);
  m[17] = (uint8_t)tg;
}

inline void macSimple(uint8_t m[21], int op) {
  std::memset(m, 0, 21);
  m[0] = (uint8_t)(op << 5);
}

// ---------- modulators (48 kHz complex baseband) ----------

inline std::vector<float> c4fmPulse(int sps) {
  // frequency pulse: raised cosine (alpha 0.2) times the inverse-sinc shaping filter, built in the frequency
  // domain, so that the FM phase over one symbol (integrate-and-dump) is free of ISI
  const double alpha = 0.2;
  const int span = 8 * sps;
  std::vector<float> p(2 * span + 1);
  const int nf = 4000;
  const double fmax = (1 + alpha) / 2; // in units of the symbol rate
  for (int i = -span; i <= span; i++) {
    const double t = (double)i / sps; // symbols
    double acc = 0;
    for (int k = 0; k < nf; k++) {
      const double f = (k + 0.5) * fmax / nf;
      double h;
      if (f <= (1 - alpha) / 2) h = 1;
      else h = 0.5 * (1 + std::cos(M_PI / alpha * (f - (1 - alpha) / 2)));
      const double x = M_PI * f;
      h *= x / std::sin(x);
      acc += h * std::cos(2 * M_PI * f * t);
    }
    p[i + span] = (float)(acc * 2 * fmax / nf);
  }
  return p;
}

inline std::vector<cf> c4fm(const Dibits& d, int sps = 10) {
  static const std::vector<float> pulse = c4fmPulse(10);
  const int span = (int)(pulse.size() / 2);
  std::vector<float> freq(d.size() * sps + 2 * span, 0.f);
  for (size_t k = 0; k < d.size(); k++) {
    const float s = LEVELS[d[k]];
    for (size_t j = 0; j < pulse.size(); j++) freq[k * sps + j] += s * pulse[j];
  }
  std::vector<cf> out(freq.size());
  double ph = 0;
  for (size_t n = 0; n < freq.size(); n++) {
    ph += 2 * M_PI * 600.0 * freq[n] / FS;
    out[n] = cf((float)std::cos(ph), (float)std::sin(ph));
  }
  return out;
}

inline std::vector<cf> dqpsk(const Dibits& d, int sps) {
  static std::vector<float> h10 = rrcTaps(10, 0.2, 8), h8 = rrcTaps(8, 0.2, 8);
  const std::vector<float>& h = sps == 10 ? h10 : h8;
  std::vector<cf> out(d.size() * sps + h.size(), cf(0, 0));
  double ph = 0;
  float peak = 0;
  for (size_t k = 0; k < d.size(); k++) {
    ph += LEVELS[d[k]] * M_PI / 4;
    const cf a((float)std::cos(ph), (float)std::sin(ph));
    for (size_t j = 0; j < h.size(); j++) out[k * sps + j] += a * h[j];
  }
  double pw = 0;
  for (auto& x : out) pw += std::norm(x);
  const float g = (float)std::sqrt(out.size() / pw); // unit mean power, like the constant-envelope C4FM
  for (auto& x : out) x *= g;
  (void)peak;
  return out;
}

// ---------- the air and the dongle ----------

struct Tx {
  int64_t freq;
  std::vector<cf> bb; // 48 kHz baseband
  int64_t start = 0;  // first sample index (48 kHz) at which it transmits
  float amp = 0.3f;
  double freqErr = 0; // carrier offset, Hz
  int delay2 = 0;     // simulcast: a second copy this many 2.4 MHz samples later...
  float amp2 = 0;     // ...at this relative amplitude
};

class Dongle {
 public:
  explicit Dongle(uint32_t seed = 7, float noise = 0.02f) : rng_(seed), noise_(0, noise) {}
  std::vector<Tx> txs;
  int64_t center = 0;
  int64_t t = 0; // 2.4 MHz sample count

  // the next [n] samples as CU8
  void read(uint8_t* out, int n) {
    std::vector<cf> acc(n, cf(0, 0));
    for (auto& tx : txs) {
      const double off = (double)(tx.freq - center) + tx.freqErr;
      if (std::fabs(off) > 1100000) continue;
      const double p0 = std::fmod(2 * M_PI * off * (double)t / IQ_FS, 2 * M_PI);
      std::complex<double> ph(std::cos(p0), std::sin(p0));
      const std::complex<double> rot(std::cos(2 * M_PI * off / IQ_FS), std::sin(2 * M_PI * off / IQ_FS));
      for (int i = 0; i < n; i++) {
        const int64_t ti = t + i;
        cf v = sampleTx(tx, ti);
        if (tx.amp2 > 0) v += tx.amp2 * sampleTx(tx, ti - tx.delay2);
        acc[i] += v * cf((float)ph.real(), (float)ph.imag());
        ph *= rot;
      }
    }
    for (int i = 0; i < n; i++) {
      const float re = acc[i].real() + noise_(rng_), im = acc[i].imag() + noise_(rng_);
      out[2 * i] = q(re);
      out[2 * i + 1] = q(im);
    }
    t += n;
  }

 private:
  static uint8_t q(float x) {
    const float v = std::round(127.4f + 127.f * x);
    return (uint8_t)(v < 0 ? 0 : v > 255 ? 255 : v);
  }
  static cf sampleTx(const Tx& tx, int64_t ti) {
    // linear interpolation of the 48 kHz baseband at 2.4 MHz (50x)
    const int64_t k = ti / 50 - tx.start;
    if (k < 0 || k + 1 >= (int64_t)tx.bb.size()) return cf(0, 0);
    const float f = (float)(ti % 50) / 50.f;
    return tx.amp * (tx.bb[k] * (1 - f) + tx.bb[k + 1] * f);
  }
  std::mt19937 rng_;
  std::normal_distribution<float> noise_;
};

}  // namespace gen
