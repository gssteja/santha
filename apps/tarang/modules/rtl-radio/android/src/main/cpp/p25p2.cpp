#include "p25p2.h"

#include <cmath>
#include <cstring>

#include "p25demod.h"
#include "p25fec.h"

namespace tarang {
namespace p25 {

namespace {

constexpr float MAX_ERR = 2.0f; // mean squared symbol error (level units) to accept an S-ISCH

struct SyncPattern {
  float s[20];
  SyncPattern() {
    for (int k = 0; k < 20; k++) s[k] = LEVELS[(P2_SYNC >> (38 - 2 * k)) & 3];
  }
};
const SyncPattern& pattern() {
  static const SyncPattern p;
  return p;
}

// MAC message lengths by opcode (b1b2 << 6 | mco), TIA-102.BBAD (as tabulated in OP25's p25p2_tdma.cc)
constexpr uint8_t MAC_LEN[256] = {
     0,  7,  8,  7,  0, 16,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0, 14, 15,  0,  0, 15,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     5,  7,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     9,  7,  9,  0,  9,  8,  9,  0, 10, 10,  9,  0, 10,  0,  0,  0,
     0,  0,  0,  0,  9,  7,  0,  0, 10,  0,  7,  0, 10,  8, 14,  7,
     9,  9,  0,  0,  9,  0,  0,  9, 10,  0,  7, 10, 10,  7,  0,  9,
     9, 29,  9,  9,  9,  9, 10, 13,  9,  9,  9, 11,  9,  9,  0,  0,
     8,  0,  0,  7, 11,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    16,  0,  0, 11, 13, 11, 11, 11, 10,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    11,  0,  0,  8, 15, 12, 15, 32, 12, 12,  0, 27, 14, 29, 29, 32,
     0,  0,  0,  0,  0,  0,  9,  0, 14, 29, 11, 27, 14,  0, 40, 11,
    28,  0,  0, 14, 17, 14,  0,  0, 16,  8, 11,  0, 13, 19,  0,  0,
     0,  0, 16, 14,  0,  0, 12,  0, 22,  0, 11, 13, 11,  0, 15,  0,
};

// FACCH / SACCH payload dibit ranges within the 180-dibit packet
struct Range {
  int from, n;
};
constexpr Range FACCH[4] = {{21, 36}, {58, 31}, {110, 32}, {143, 36}}; // 135 dibits = 45 hexbits
constexpr Range SACCH[3] = {{21, 36}, {58, 84}, {143, 36}};            // 156 dibits = 52 hexbits

inline bool isSyncSlot(int s) { return (s % 4) >= 2; }

}  // namespace

int macMessageLength(const uint8_t* m, int remaining) {
  const int b1b2 = m[0] >> 6, op = m[0];
  int len = 0;
  switch (op) {
    case 0x00: return remaining; // null information: the rest of the PDU
    case 0x08: len = remaining > 1 ? m[1] & 0x3f : 0; break;
    case 0x11: len = remaining > 1 ? ((m[1] & 3) + 1) * 2 + 2 : 0; break;
    case 0x12: len = remaining > 1 ? ((m[1] & 3) + 1) * 3 + 2 : 0; break;
    default:
      if (b1b2 == 2 && remaining > 2) len = m[2] & 0x3f; // manufacturer messages carry their length
      if (len == 0) len = MAC_LEN[op];
  }
  return len;
}

// ---------- AMBE frame FEC ----------

int ambeDecode(const uint8_t vf[72], uint8_t out[49]) {
  uint8_t c[72];
  for (int k = 0; k < 18; k++)
    for (int j = 0; j < 4; j++) c[18 * j + k] = vf[4 * k + j];
  auto word = [&](int from, int n) {
    uint32_t v = 0;
    for (int i = 0; i < n; i++) v = v << 1 | c[from + i];
    return v;
  };
  uint32_t u0, u1;
  int errs = golay24Decode(word(0, 24), &u0);
  Pn pn(u0);
  errs += golay23Decode(word(24, 23) ^ pn.bits(23), &u1);
  const uint32_t u2 = word(47, 11), u3 = word(58, 14);
  for (int i = 0; i < 12; i++) out[i] = u0 >> (11 - i) & 1;
  for (int i = 0; i < 12; i++) out[12 + i] = u1 >> (11 - i) & 1;
  for (int i = 0; i < 11; i++) out[24 + i] = u2 >> (10 - i) & 1;
  for (int i = 0; i < 14; i++) out[35 + i] = u3 >> (13 - i) & 1;
  return errs;
}

void ambeEncode(const uint8_t in[49], uint8_t vf[72]) {
  auto word = [&](int from, int n) {
    uint32_t v = 0;
    for (int i = 0; i < n; i++) v = v << 1 | in[from + i];
    return v;
  };
  const uint32_t u0 = word(0, 12), u1 = word(12, 12), u2 = word(24, 11), u3 = word(35, 14);
  Pn pn(u0);
  const uint32_t c0 = golay24Encode(u0), c1 = golay23Encode(u1) ^ pn.bits(23);
  uint8_t c[72];
  for (int i = 0; i < 24; i++) c[i] = c0 >> (23 - i) & 1;
  for (int i = 0; i < 23; i++) c[24 + i] = c1 >> (22 - i) & 1;
  for (int i = 0; i < 11; i++) c[47 + i] = u2 >> (10 - i) & 1;
  for (int i = 0; i < 14; i++) c[58 + i] = u3 >> (13 - i) & 1;
  for (int k = 0; k < 18; k++)
    for (int j = 0; j < 4; j++) vf[4 * k + j] = c[18 * j + k];
}

// ---------- FACCH / SACCH ----------

void acchEncode(const uint8_t* pdu, bool fast, uint8_t d[180]) {
  const int dataBits = fast ? 144 : 168, n = fast ? 45 : 52, k = fast ? 26 : 30;
  uint8_t bits[312] = {0};
  for (int i = 0; i < dataBits; i++) bits[i] = pdu[i / 8] >> (7 - i % 8) & 1;
  const uint16_t crc = crc12(bits, dataBits);
  for (int i = 0; i < 12; i++) bits[dataBits + i] = crc >> (11 - i) & 1;
  uint8_t hb[63];
  for (int i = 0; i < k; i++) {
    hb[i] = 0;
    for (int j = 0; j < 6; j++) hb[i] = (uint8_t)(hb[i] << 1 | bits[6 * i + j]);
  }
  rsEncode(rs28(), hb, n, k, fast ? 9 : 6);
  int b = 0;
  const Range* r = fast ? FACCH : SACCH;
  const int nr = fast ? 4 : 3;
  for (int i = 0; i < nr; i++)
    for (int j = 0; j < r[i].n; j++, b += 2) {
      const int bit0 = hb[b / 6] >> (5 - b % 6) & 1, bit1 = hb[(b + 1) / 6] >> (5 - (b + 1) % 6) & 1;
      d[r[i].from + j] = (uint8_t)(bit0 << 1 | bit1);
    }
}

void P2Framer::acch(const uint8_t* d, bool fast, int channel) {
  const int dataBits = fast ? 144 : 168, n = fast ? 45 : 52, k = fast ? 26 : 30;
  uint8_t hb[52] = {0};
  int b = 0;
  const Range* r = fast ? FACCH : SACCH;
  const int nr = fast ? 4 : 3;
  for (int i = 0; i < nr; i++)
    for (int j = 0; j < r[i].n; j++, b += 2) {
      const int dib = d[r[i].from + j];
      hb[b / 6] = (uint8_t)(hb[b / 6] << 1 | dib >> 1);
      hb[(b + 1) / 6] = (uint8_t)(hb[(b + 1) / 6] << 1 | (dib & 1));
    }
  for (auto& h : hb) h &= 63;
  if (rsDecode(rs28(), hb, n, k, fast ? 9 : 6) < 0) {
    macFails_++;
    return;
  }
  uint8_t bits[180];
  for (int i = 0; i < dataBits + 12; i++) bits[i] = hb[i / 6] >> (5 - i % 6) & 1;
  uint16_t crc = 0;
  for (int i = 0; i < 12; i++) crc = (uint16_t)(crc << 1 | bits[dataBits + i]);
  if (crc != crc12(bits, dataBits)) {
    macFails_++;
    return;
  }
  uint8_t pdu[21] = {0};
  for (int i = 0; i < dataBits; i++) pdu[i / 8] |= (uint8_t)(bits[i] << (7 - i % 8));
  macs_++;
  if (l_) l_->onMac(channel, pdu, dataBits / 8);
}

// ---------- framer ----------

void P2Framer::reset() {
  std::fill(ring_.begin(), ring_.end(), 0.f);
  t_ = 0;
  armed_ = true;
  bestErr_ = 1e9f;
  bestAt_ = -1;
  locked_ = false;
  slotIdx_ = -1;
  essBursts_[0] = essBursts_[1] = 0;
  freqErr_ = 0;
  freqErrN_ = 0;
}

void P2Framer::setScrambler(uint32_t wacn, uint32_t sysid, uint32_t nac) {
  p2Scrambler(wacn, sysid, nac, mask_);
  scrambleSet_ = true;
}

double P2Framer::takeFreqError(int* n) {
  const double e = freqErrN_ ? freqErr_ / freqErrN_ : 0;
  if (n) *n = freqErrN_;
  freqErr_ = 0;
  freqErrN_ = 0;
  return e;
}

float P2Framer::sampleAt(double pos) const {
  const int64_t i = (int64_t)std::floor(pos);
  const float f = (float)(pos - i);
  const float a = ring_[i & (RING - 1)], b = ring_[(i + 1) & (RING - 1)];
  return a + (b - a) * f;
}

void P2Framer::process(const float* in, int n) {
  const SyncPattern& sp = pattern();
  const int span = 19 * SPS;
  for (int k = 0; k < n; k++) {
    ring_[t_ & (RING - 1)] = in[k];
    const int64_t now = t_++;
    if (now >= span) {
      float c = 0, q = 0;
      int64_t idx = now - span;
      for (int j = 0; j < 20; j++, idx += SPS) {
        const float v = ring_[idx & (RING - 1)];
        c += sp.s[j] * v;
        q += v * v;
      }
      const float e = (q - 2 * c + 180) / 20; // mean squared error per symbol against the S-ISCH levels
      prevE_[0] = prevE_[1];
      prevE_[1] = prevE_[2];
      prevE_[2] = e;
      if (!armed_) {
        armed_ = e > 2 * MAX_ERR;
      } else if (e <= MAX_ERR && e < bestErr_) {
        bestErr_ = e;
        bestAt_ = now;
        peakE_[0] = prevE_[1];
        peakE_[1] = e;
        peakE_[2] = e;
      } else if (bestAt_ == now - 1) {
        peakE_[2] = e;
      }
      if (bestAt_ >= 0 && now - bestAt_ >= SPS / 2) {
        const float den = peakE_[0] - 2 * peakE_[1] + peakE_[2];
        double d = den > 0 ? 0.5 * (peakE_[0] - peakE_[2]) / den : 0;
        if (d > 0.5) d = 0.5;
        if (d < -0.5) d = -0.5;
        onSync((double)bestAt_ + d, bestErr_);
        bestAt_ = -1;
        bestErr_ = 1e9f;
        armed_ = false;
      }
    }
    if (locked_) readSymbols();
  }
}

void P2Framer::onSync(double pos, float score) {
  syncs_++;
  const SyncPattern& sp = pattern();
  double err = 0, sq = 0;
  for (int j = 0; j < 20; j++) {
    const float e = sampleAt(pos - (19 - j) * SPS) - sp.s[j];
    err += e;
    sq += e * e;
  }
  freqErr_ += err / 20 * (FS / (double)SPS) / 8;
  freqErrN_++;
  quality_ = 0.8f * quality_ + 0.2f * (float)(sq / 20);
  const double start = pos - 19 * SPS;
  sinceSync_ = 0;
  if (locked_) {
    const double per = PKT * SPS;
    const double k = std::round((start - pktStart_) / per);
    const double resid = start - (pktStart_ + k * per);
    if (std::fabs(resid) < 2 * SPS) {
      pktStart_ += resid; // small timing correction; the packet count stays
      return;
    }
  }
  // (re)acquire: this packet starts at the sync; its symbols are still in the ring
  locked_ = true;
  pktStart_ = start;
  pktSym_ = 0;
  slotIdx_ = -1;
  badIsch_ = 0;
  (void)score;
}

void P2Framer::readSymbols() {
  while (locked_) {
    const double pos = pktStart_ + pktSym_ * SPS;
    if (pos + 1 >= (double)(t_ - 1)) return;
    if (t_ - (int64_t)pos >= RING - 2) {
      locked_ = false;
      return;
    }
    soft_[pktSym_++] = sampleAt(pos);
    if (pktSym_ < PKT) continue;
    handlePacket();
    pktStart_ += PKT * SPS;
    pktSym_ = 0;
    if (++sinceSync_ > 8) locked_ = false; // no S-ISCH for four superframe slots' worth: carrier gone
  }
}

void P2Framer::handlePacket() {
  uint8_t dib[PKT];
  for (int i = 0; i < PKT; i++) dib[i] = (uint8_t)slice(soft_[i]);
  uint64_t isch = 0;
  for (int i = 0; i < 20; i++) isch = isch << 2 | dib[i];
  if (slotIdx_ >= 0) slotIdx_ = (slotIdx_ + 1) % 12;
  // Every slot starts with an ISCH; a slot whose ISCH isn't one is noise (the carrier has gone, or the timing
  // has): its content is never decoded, and two in a row drop the lock.
  const bool sync = __builtin_popcountll(isch ^ P2_SYNC) <= 4;
  bool valid = sync;
  if (!sync) {
    int dist;
    const int v = ischDecode(isch, &dist);
    const int chn = v >> 5, loc = v >> 3 & 3;
    if (v >= 0 && dist <= 5 && loc <= 2 && chn <= 1) {
      const int s = 4 * loc + chn;
      if (slotIdx_ < 0 || s == slotIdx_ || dist <= 3) {
        slotIdx_ = s;
        valid = true;
      }
    }
  } else if (slotIdx_ >= 0 && !isSyncSlot(slotIdx_)) {
    slotIdx_ = -1; // the count went wrong somewhere
  }
  if (!valid) {
    if (++badIsch_ >= 2) locked_ = false;
    return;
  }
  badIsch_ = 0;
  if (slotIdx_ < 0) return;
  const int duid = duid2Decode((uint8_t)(dib[20] << 6 | dib[57] << 4 | dib[142] << 2 | dib[179]));
  const int ch = slotChannel(slotIdx_);
  if (l_) l_->onP2Slot(slotIdx_, ch, duid);
  if (duid < 0) return;
  const bool scrambled = duid == 0 || duid == 6 || duid == 3 || duid == 9;
  if (scrambled && !scrambleSet_) return;
  uint8_t x[PKT];
  std::memcpy(x, dib, PKT);
  if (scrambled)
    for (int i = 10; i < PKT; i++) x[i] ^= mask_[slotIdx_ * PKT + i - 10];
  switch (duid) {
    case 0:   // 4V
    case 6: { // 2V
      if (ch != channel_) return;
      const int starts[4] = {21, 58, 106, 143};
      const int nv = duid == 0 ? 4 : 2;
      for (int f = 0; f < nv; f++) {
        uint8_t vf[72], u[49];
        for (int i = 0; i < 36; i++) {
          vf[2 * i] = x[starts[f] + i] >> 1;
          vf[2 * i + 1] = x[starts[f] + i] & 1;
        }
        const int errs = ambeDecode(vf, u);
        voice_++;
        if (l_) l_->onAmbe(ch, u, errs);
      }
      if (duid == 0) {
        const int b = essBursts_[ch] % 4;
        for (int i = 0; i < 4; i++) essB_[ch][4 * b + i] = (uint8_t)(x[94 + 3 * i] << 4 | x[95 + 3 * i] << 2 | x[96 + 3 * i]);
        essBursts_[ch]++;
      } else {
        if (essBursts_[ch] >= 4) {
          uint8_t cw[44];
          std::memcpy(cw, essB_[ch], 16);
          for (int i = 0, j = 94; i < 28; i++) {
            cw[16 + i] = (uint8_t)(x[j] << 4 | x[j + 1] << 2 | x[j + 2]);
            j += i == 15 ? 4 : 3; // skip the dibit holding the third DUID
          }
          if (rsDecode(rs28(), cw, 44, 16, 0) >= 0 && l_) {
            const int algid = cw[0] << 2 | cw[1] >> 4;
            const int kid = (cw[1] & 15) << 12 | cw[2] << 6 | cw[3];
            l_->onP2Ess(ch, algid, kid);
          }
        }
        essBursts_[ch] = 0;
      }
      return;
    }
    case 3:
    case 12: acch(x, false, ch); return;
    case 9:
    case 15: acch(x, true, ch); return;
  }
}

}  // namespace p25
}  // namespace tarang
