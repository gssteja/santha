#include "p25p1.h"

#include <cmath>
#include <cstring>

#include "p25demod.h"
#include "p25fec.h"

namespace tarang {
namespace p25 {

const int LDU_VOICE_START[9] = {112, 256, 440, 624, 808, 992, 1176, 1360, 1536};
const int LDU_LC_START[6] = {400, 584, 768, 952, 1136, 1320};

namespace {

constexpr uint64_t SYNC = 0x5575F5FF77FFULL;
constexpr float MAX_ERR = 2.0f; // mean squared symbol error (level units) to accept a frame sync

struct SyncPattern {
  float s[24];
  SyncPattern() {
    for (int k = 0; k < 24; k++) s[k] = LEVELS[(SYNC >> (46 - 2 * k)) & 3];
  }
};
const SyncPattern& pattern() {
  static const SyncPattern p;
  return p;
}

// raw frame symbol index of status-free symbol f (a status symbol follows every 35 data symbols)
inline int rawIndex(int f) { return f + f / 35; }
inline bool isStatus(int r) { return r % 36 == 35; }

// symbol count of each frame type (raw, status symbols included); 0 = not read
int frameSymbols(int duid) {
  switch (duid) {
    case HDU: return 396;
    case TDU: return 72;
    case LDU1:
    case LDU2: return 864;
    case TDULC: return 216;
    default: return 0;
  }
}

bool nidParity(int duid) { return duid == LDU1 || duid == LDU2; }

}  // namespace

int imbeInterleave(int i) {
  const int r = i / 24, c = i % 24;
  return 6 * c + 2 * (r / 2) + ((r & 1) ^ (c & 1));
}

static uint32_t bitsTo(const uint8_t* b, int n) {
  uint32_t v = 0;
  for (int i = 0; i < n; i++) v = v << 1 | (b[i] & 1);
  return v;
}

static void toBits(uint32_t v, int n, uint8_t* b) {
  for (int i = 0; i < n; i++) b[i] = v >> (n - 1 - i) & 1;
}

int imbeDecode(const uint8_t c[144], uint8_t out[88]) {
  int errs = 0;
  uint32_t u[8];
  errs += golay23Decode(bitsTo(c, 23), &u[0]);
  Pn pn(u[0]);
  for (int k = 1; k < 4; k++) errs += golay23Decode(bitsTo(c + 23 * k, 23) ^ pn.bits(23), &u[k]);
  for (int k = 4; k < 7; k++) {
    uint16_t d;
    errs += hamming15Decode((uint16_t)(bitsTo(c + 92 + 15 * (k - 4), 15) ^ pn.bits(15)), &d);
    u[k] = d;
  }
  u[7] = bitsTo(c + 137, 7);
  int o = 0;
  for (int k = 0; k < 8; k++) {
    const int n = k < 4 ? 12 : k < 7 ? 11 : 7;
    toBits(u[k], n, out + o);
    o += n;
  }
  return errs;
}

void imbeEncode(const uint8_t in[88], uint8_t c[144]) {
  uint32_t u[8];
  int o = 0;
  for (int k = 0; k < 8; k++) {
    const int n = k < 4 ? 12 : k < 7 ? 11 : 7;
    u[k] = bitsTo(in + o, n);
    o += n;
  }
  toBits(golay23Encode(u[0]), 23, c);
  Pn pn(u[0]);
  for (int k = 1; k < 4; k++) toBits(golay23Encode(u[k]) ^ pn.bits(23), 23, c + 23 * k);
  for (int k = 4; k < 7; k++) toBits(hamming15Encode((uint16_t)u[k]) ^ pn.bits(15), 15, c + 92 + 15 * (k - 4));
  toBits(u[7], 7, c + 137);
}

// ---------- framer ----------

void P1Framer::reset() {
  std::fill(ring_.begin(), ring_.end(), 0.f);
  t_ = 0;
  bestErr_ = 1e9f;
  bestAt_ = -1;
  armed_ = true;
  reading_ = false;
  goodNids_ = 0;
  freqErr_ = 0;
  freqErrN_ = 0;
}

double P1Framer::takeFreqError(int* n) {
  const double e = freqErrN_ ? freqErr_ / freqErrN_ : 0;
  if (n) *n = freqErrN_;
  freqErr_ = 0;
  freqErrN_ = 0;
  return e;
}

float P1Framer::sampleAt(double pos) const {
  const int64_t i = (int64_t)std::floor(pos);
  const float f = (float)(pos - i);
  const float a = ring_[i & (RING - 1)], b = ring_[(i + 1) & (RING - 1)];
  return a + (b - a) * f;
}

void P1Framer::process(const float* in, int n) {
  const SyncPattern& sp = pattern();
  const int span = 23 * sps_;
  for (int k = 0; k < n; k++) {
    ring_[t_ & (RING - 1)] = in[k];
    const int64_t now = t_++;
    if (now >= span) {
      // squared distance from the sync's levels, upright and inverted (the soft values are in level units,
      // so a match has to get the levels right, not just the signs)
      float c = 0, q = 0;
      int64_t idx = now - span;
      for (int j = 0; j < 24; j++, idx += sps_) {
        const float v = ring_[idx & (RING - 1)];
        c += sp.s[j] * v;
        q += v * v;
      }
      const bool inv = c < 0;
      const float e = (q - 2 * std::fabs(c) + 216) / 24; // mean squared error per symbol
      prevE_[0] = prevE_[1];
      prevE_[1] = prevE_[2];
      prevE_[2] = e;
      if (!armed_) {
        armed_ = e > 2 * MAX_ERR; // one detection per sync: re-arm once the window has moved off it
      } else if (e <= MAX_ERR && e < bestErr_) {
        bestErr_ = e;
        bestAt_ = now;
        bestInv_ = inv;
        peakE_[0] = prevE_[1];
        peakE_[1] = e;
        peakE_[2] = e;
      } else if (bestAt_ == now - 1) {
        peakE_[2] = e;
      }
      if (bestAt_ >= 0 && now - bestAt_ >= sps_ / 2) {
        // past the best match by half a symbol: refine it with a parabola through three error values
        const float den = peakE_[0] - 2 * peakE_[1] + peakE_[2];
        double d = den > 0 ? 0.5 * (peakE_[0] - peakE_[2]) / den : 0;
        if (d > 0.5) d = 0.5;
        if (d < -0.5) d = -0.5;
        onSync((double)bestAt_ + d, bestInv_, bestErr_);
        bestAt_ = -1;
        bestErr_ = 1e9f;
        armed_ = false;
      }
    }
    if (reading_) readSymbols();
  }
}

void P1Framer::onSync(double pos, bool inv, float score) {
  syncs_++;
  // frequency error and quality from the sync symbols themselves
  const SyncPattern& sp = pattern();
  double err = 0, sq = 0;
  for (int j = 0; j < 24; j++) {
    float v = sampleAt(pos - (23 - j) * sps_);
    if (inv) v = -v;
    const float e = v - sp.s[j];
    err += e;
    sq += e * e;
  }
  freqErr_ += err / 24 * (FS / (double)sps_) / 8; // pi/4 per symbol period = baud / 8 Hz
  freqErrN_++;
  quality_ = 0.8f * quality_ + 0.2f * (float)(sq / 24);
  reading_ = true;
  inverted_ = inv;
  frameStart_ = pos;
  symPos_ = pos + sps_;
  sym_ = 24;
  want_ = 57;
  duid_ = -1;
  blocksDone_ = 0;
  (void)score;
}

void P1Framer::readSymbols() {
  while (reading_ && symPos_ + 1 < (double)(t_ - 1)) {
    if (t_ - (int64_t)symPos_ >= RING - 2) { // fell too far behind (can't happen with sane input)
      reading_ = false;
      return;
    }
    float v = sampleAt(symPos_);
    sv_[sym_++] = inverted_ ? -v : v;
    symPos_ += sps_;
    if (sym_ < want_) continue;
    if (duid_ < 0) {
      finishNid();
    } else if (duid_ == TSDU) {
      if (!tryBlock(blocksDone_)) reading_ = false;
    } else {
      finishFrame();
      reading_ = false;
    }
  }
}

void P1Framer::finishNid() {
  // 33 symbols (24..56), the status symbol at 35 dropped -> 64 bits, first sent = bit 63
  uint64_t nid = 0;
  uint8_t hard[64];
  int b = 0;
  for (int r = 24; r < 57; r++) {
    if (isStatus(r)) continue;
    const int d = slice(sv_[r]);
    hard[b++] = d >> 1;
    hard[b++] = d & 1;
    nid = nid << 2 | d;
  }
  uint64_t cw = nid >> 1;
  int errs = bchDecode(cw);
  int nac = -1, duid = -1;
  if (errs >= 0 && (errs <= 6 || (nac_ >= 0 && (int)(cw >> 51) == nac_))) {
    nac = (int)(cw >> 51);
    duid = (int)(cw >> 47) & 15;
  } else if (nac_ >= 0) {
    // the NAC is known: pick the DUID whose codeword is nearest (distance >= 23 between any two)
    int best = -1, bestD = 99, second = 99;
    for (int d = 0; d < 16; d++) {
      const uint64_t c = bchEncode((uint32_t)(nac_ << 4 | d)) << 1 | (nidParity(d) ? 1 : 0);
      int dist = 0;
      for (int i = 0; i < 64; i++) dist += hard[i] != (int)(c >> (63 - i) & 1);
      if (dist < bestD) {
        second = bestD;
        bestD = dist;
        best = d;
      } else if (dist < second) {
        second = dist;
      }
    }
    if (bestD <= 15 && second - bestD >= 6) {
      nac = nac_;
      duid = best;
      errs = bestD;
    }
  }
  const bool known = duid == HDU || duid == TDU || duid == LDU1 || duid == TSDU || duid == LDU2 || duid == PDU || duid == TDULC;
  if (!known || (nac_ >= 0 && nac != nac_)) {
    nidFails_++;
    reading_ = false;
    return;
  }
  if (nac_ < 0) { // learn the NAC from two agreeing NIDs
    if (nac == frameNac_) goodNids_++;
    else goodNids_ = 1;
    if (goodNids_ >= 2) nac_ = nac;
  }
  frameNac_ = nac;
  frames_++;
  duid_ = duid;
  if (l_) l_->onNid(nac, duid, errs);
  if (duid == TSDU) {
    want_ = rawIndex(56 + 98 - 1) + 1; // the first block
  } else if (frameSymbols(duid) > 0) {
    want_ = frameSymbols(duid);
  } else {
    reading_ = false; // PDUs aren't decoded
  }
}

bool P1Framer::tryBlock(int b) {
  float s[98];
  for (int i = 0; i < 98; i++) s[i] = sv_[rawIndex(56 + 98 * b + i)];
  uint8_t bytes[12];
  trellisDecode(s, bytes);
  blocksDone_ = b + 1;
  bool last = b == 2;
  if (tsbkCrcOk(bytes)) {
    tsbks_++;
    if (l_) l_->onTsbk(frameNac_, bytes);
    last = last || (bytes[0] & 0x80);
  } else {
    tsbkFails_++;
  }
  if (last) return false;
  want_ = rawIndex(56 + 98 * (b + 2) - 1) + 1;
  return true;
}

void P1Framer::finishFrame() {
  // status-free hard dibits from symbol 24 on; d[f] for status-free index f
  uint8_t d[840];
  int nf = 0;
  for (int r = 24; r < want_ && 24 + nf < 840; r++)
    if (!isStatus(r)) d[24 + nf++] = (uint8_t)slice(sv_[r]);
  auto bit = [&](int sfBit) -> uint8_t { return (d[sfBit >> 1] >> (1 - (sfBit & 1))) & 1; };
  const int nac = frameNac_;
  switch (duid_) {
    case HDU: {
      uint8_t hb[36];
      for (int i = 0; i < 36; i++) {
        uint32_t cw = 0;
        for (int j = 0; j < 18; j++) cw = cw << 1 | bit(112 + 18 * i + j);
        uint32_t data;
        golay24Decode(cw, &data);
        hb[i] = data & 63;
      }
      if (rsDecode(rs16(), hb, 36, 20) < 0) return;
      const int algid = (hb[13] & 15) << 4 | hb[14] >> 2;
      const int kid = (hb[14] & 3) << 14 | hb[15] << 8 | hb[16] << 2 | hb[17] >> 4;
      const int tgid = (hb[17] & 15) << 12 | hb[18] << 6 | hb[19];
      if (l_) l_->onHeader(nac, algid, kid, tgid);
      return;
    }
    case LDU1:
    case LDU2: {
      for (int f = 0; f < 9; f++) {
        uint8_t c[144], u[88];
        for (int i = 0; i < 144; i++) c[i] = bit(LDU_VOICE_START[f] + imbeInterleave(i));
        const int errs = imbeDecode(c, u);
        if (l_) l_->onImbe(u, errs);
      }
      uint8_t hb[24];
      for (int i = 0; i < 24; i++) {
        uint16_t cw = 0;
        for (int j = 0; j < 10; j++) {
          const int k = 10 * i + j; // 240 bits spread over six 40-bit fields
          cw = (uint16_t)(cw << 1 | bit(LDU_LC_START[k / 40] + k % 40));
        }
        uint8_t h;
        hamming10Decode(cw, &h);
        hb[i] = h;
      }
      if (duid_ == LDU1) {
        if (rsDecode(rs12(), hb, 24, 12) < 0) return;
        uint8_t lc[9];
        for (int i = 0, j = 0; i < 9; i += 3, j += 4) {
          lc[i] = (uint8_t)(hb[j] << 2 | hb[j + 1] >> 4);
          lc[i + 1] = (uint8_t)((hb[j + 1] & 15) << 4 | hb[j + 2] >> 2);
          lc[i + 2] = (uint8_t)((hb[j + 2] & 3) << 6 | hb[j + 3]);
        }
        if (l_) l_->onLinkControl(nac, lc);
      } else {
        if (rsDecode(rs8(), hb, 24, 16) < 0) return;
        const int algid = hb[12] << 2 | hb[13] >> 4;
        const int kid = (hb[13] & 15) << 12 | hb[14] << 6 | hb[15];
        if (l_) l_->onEncryptionSync(nac, algid, kid);
      }
      return;
    }
    case TDULC: {
      uint8_t hb[24];
      for (int i = 0; i < 12; i++) {
        uint32_t cw = 0;
        for (int j = 0; j < 24; j++) cw = cw << 1 | bit(112 + 24 * i + j);
        uint32_t data;
        golay24Decode(cw, &data);
        hb[2 * i] = data >> 6;
        hb[2 * i + 1] = data & 63;
      }
      if (rsDecode(rs12(), hb, 24, 12) >= 0) {
        uint8_t lc[9];
        for (int i = 0, j = 0; i < 9; i += 3, j += 4) {
          lc[i] = (uint8_t)(hb[j] << 2 | hb[j + 1] >> 4);
          lc[i + 1] = (uint8_t)((hb[j + 1] & 15) << 4 | hb[j + 2] >> 2);
          lc[i + 2] = (uint8_t)((hb[j + 2] & 3) << 6 | hb[j + 3]);
        }
        if (l_) l_->onLinkControl(nac, lc);
      }
      if (l_) l_->onTerminator(nac);
      return;
    }
    case TDU:
      if (l_) l_->onTerminator(nac);
      return;
  }
}

}  // namespace p25
}  // namespace tarang
