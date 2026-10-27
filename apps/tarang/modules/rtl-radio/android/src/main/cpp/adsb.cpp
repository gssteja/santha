#include "adsb.h"

#include <cmath>
#include <cstring>
#include <mutex>

namespace tarang {

namespace {

constexpr int PREAMBLE = 19;   // samples from the first preamble pulse to the first data bit (8 us)
constexpr int TRAIL = 326;     // the longest message (preamble + 112 bits) plus slack, carried between blocks
constexpr int64_t EXPIRE_MS = 60'000;
constexpr int64_t CONFIRM_MS = 60'000;
constexpr double CPR_SCALE = 131072.0; // 2^17

uint16_t g_mag[65536];
uint32_t g_crc[256];
std::vector<std::pair<uint32_t, int>> g_syn56, g_syn112; // single-bit error syndromes -> bit index
std::once_flag g_once;

inline int getbit(const uint8_t* m, int bit) { // 1-based, like the Mode S documents
  return (m[(bit - 1) >> 3] >> (7 - ((bit - 1) & 7))) & 1;
}

inline uint32_t getbits(const uint8_t* m, int first, int last) {
  uint32_t v = 0;
  for (int b = first; b <= last; b++) v = (v << 1) | getbit(m, b);
  return v;
}

// CRC-24 syndrome: 0 for a clean squitter, the sender's address for address/parity replies
uint32_t crc(const uint8_t* msg, int bits) {
  const int bytes = bits / 8;
  uint32_t rem = 0;
  for (int i = 0; i < bytes - 3; i++) rem = ((rem << 8) & 0xFFFFFF) ^ g_crc[((rem >> 16) ^ msg[i]) & 0xFF];
  const uint32_t parity = (msg[bytes - 3] << 16) | (msg[bytes - 2] << 8) | msg[bytes - 1];
  return rem ^ parity;
}

void initTables() {
  // |I + jQ| for every byte pair, scaled to 0..65535 (dump1090's conversion)
  for (int q = 0; q < 256; q++) {
    for (int i = 0; i < 256; i++) {
      float fi = (i - 127.4f) / 128.0f, fq = (q - 127.4f) / 128.0f;
      float m = std::sqrt(std::fmin(fi * fi + fq * fq, 1.0f));
      g_mag[i | (q << 8)] = static_cast<uint16_t>(m * 65535.0f + 0.5f);
    }
  }
  for (uint32_t i = 0; i < 256; i++) {
    uint32_t c = i << 16;
    for (int k = 0; k < 8; k++) c = (c & 0x800000) ? (c << 1) ^ 0xFFF409 : c << 1;
    g_crc[i] = c & 0xFFFFFF;
  }
  uint8_t msg[14];
  for (int bits : {56, 112}) {
    auto& table = bits == 56 ? g_syn56 : g_syn112;
    for (int k = 5; k < bits; k++) { // never "repair" the downlink format
      std::memset(msg, 0, sizeof msg);
      msg[k >> 3] = static_cast<uint8_t>(0x80 >> (k & 7));
      table.emplace_back(crc(msg, bits), k);
    }
  }
}

// Correlation of one Manchester bit starting at a 1/5-sample phase within m[0] (dump1090 demod_2400.c):
// > 0 is a 1, < 0 is a 0. Each sums to zero, so the DC level doesn't matter.
inline int slice(const uint16_t* m, int phase) {
  switch (phase) {
    case 0: return 5 * m[0] - 3 * m[1] - 2 * m[2];
    case 1: return 4 * m[0] - m[1] - 3 * m[2];
    case 2: return 3 * m[0] + m[1] - 4 * m[2];
    case 3: return 2 * m[0] + 3 * m[1] - 5 * m[2];
    default: return m[0] + 5 * m[1] - 5 * m[2] - m[3];
  }
}

int msgBits(int df) {
  switch (df) {
    case 0: case 4: case 5: case 11: return 56;
    case 16: case 17: case 18: case 20: case 21: return 112;
    default: return 0;
  }
}

// Gillham (Mode C) altitude in 100 ft units from an ID13-style "hex Gillham" code (dump1090 ModeAToModeC)
int modeAToModeC(unsigned a) {
  if ((a & 0xFFFF8889) != 0 || (a & 0x000000F0) == 0) return INT32_MIN;
  unsigned hundreds = 0, fives = 0;
  if (a & 0x0010) hundreds ^= 0x007; // C1
  if (a & 0x0020) hundreds ^= 0x003; // C2
  if (a & 0x0040) hundreds ^= 0x001; // C4
  if ((hundreds & 5) == 5) hundreds ^= 2;
  if (hundreds > 5) return INT32_MIN;
  if (a & 0x0002) fives ^= 0x0FF; // D2
  if (a & 0x0004) fives ^= 0x07F; // D4
  if (a & 0x1000) fives ^= 0x03F; // A1
  if (a & 0x2000) fives ^= 0x01F; // A2
  if (a & 0x4000) fives ^= 0x00F; // A4
  if (a & 0x0100) fives ^= 0x007; // B1
  if (a & 0x0200) fives ^= 0x003; // B2
  if (a & 0x0400) fives ^= 0x001; // B4
  if (fives & 1) hundreds = 6 - hundreds;
  return static_cast<int>(fives * 5 + hundreds) - 13;
}

// ID13 field -> 0xABCD with one octal squawk digit per nibble
unsigned id13ToHex(unsigned id) {
  unsigned h = 0;
  if (id & 0x1000) h |= 0x0010; // C1
  if (id & 0x0800) h |= 0x1000; // A1
  if (id & 0x0400) h |= 0x0020; // C2
  if (id & 0x0200) h |= 0x2000; // A2
  if (id & 0x0100) h |= 0x0040; // C4
  if (id & 0x0080) h |= 0x4000; // A4
  if (id & 0x0020) h |= 0x0100; // B1
  if (id & 0x0010) h |= 0x0001; // D1
  if (id & 0x0008) h |= 0x0200; // B2
  if (id & 0x0004) h |= 0x0002; // D2
  if (id & 0x0002) h |= 0x0400; // B4
  if (id & 0x0001) h |= 0x0004; // D4
  return h;
}

int decodeAC13(unsigned f) {
  if (f & 0x0040) return INT32_MIN; // metric altitude: not used in practice
  if (f & 0x0010) {                 // Q bit: 25 ft steps
    int n = ((f & 0x1F80) >> 2) | ((f & 0x0020) >> 1) | (f & 0x000F);
    return n * 25 - 1000;
  }
  int n = modeAToModeC(id13ToHex(f));
  return n < -12 || n == INT32_MIN ? INT32_MIN : 100 * n;
}

int decodeAC12(unsigned f) {
  if (f & 0x10) {
    int n = ((f & 0x0FE0) >> 1) | (f & 0x000F);
    return n * 25 - 1000;
  }
  int n = modeAToModeC(id13ToHex(((f & 0x0FC0) << 1) | (f & 0x003F)));
  return n < -12 || n == INT32_MIN ? INT32_MIN : 100 * n;
}

bool callsign(const uint8_t* msg, char out[9]) {
  static const char* CHARS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######";
  char cs[9];
  for (int i = 0; i < 8; i++) {
    char c = CHARS[getbits(msg, 41 + 6 * i, 46 + 6 * i)];
    if (c == '#') return false;
    cs[i] = c;
  }
  int end = 8;
  while (end > 0 && cs[end - 1] == ' ') end--;
  if (end == 0) return false;
  cs[end] = 0;
  std::memcpy(out, cs, 9);
  return true;
}

// ---- CPR position decoding ----

int cprNL(double lat) {
  lat = std::fabs(lat);
  if (lat < 1e-9) return 59;
  if (lat > 87.0) return 1;
  const double a = 1 - std::cos(M_PI / 30.0); // 1 - cos(pi / (2 * NZ)), NZ = 15
  const double b = std::cos(M_PI / 180.0 * lat);
  const double x = 1 - a / (b * b);
  if (x <= -1) return 1;
  return static_cast<int>(std::floor(2 * M_PI / std::acos(x)));
}

inline int cprMod(int a, int b) {
  int r = a % b;
  return r < 0 ? r + b : r;
}

inline double cprModD(double a, double b) {
  double r = std::fmod(a, b);
  return r < 0 ? r + b : r;
}

double wrapLon(double lon) { return lon - 360.0 * std::floor((lon + 180.0) / 360.0); }

// Global decode from an even/odd pair; [useOdd] picks which half's position is returned (the newer one).
bool cprGlobal(const int lat[2], const int lon[2], bool useOdd, bool surface, double refLat, double refLon,
               double& outLat, double& outLon) {
  const double range = surface ? 90.0 : 360.0;
  const double dlat0 = range / 60.0, dlat1 = range / 59.0;
  const double lat0 = lat[0], lat1 = lat[1], lon0 = lon[0], lon1 = lon[1];
  int j = static_cast<int>(std::floor((59 * lat0 - 60 * lat1) / CPR_SCALE + 0.5));
  double rlat0 = dlat0 * (cprMod(j, 60) + lat0 / CPR_SCALE);
  double rlat1 = dlat1 * (cprMod(j, 59) + lat1 / CPR_SCALE);
  if (surface) { // the answer is one of two latitudes 90 degrees apart: take the one near the reference
    if (rlat0 - refLat > 45) rlat0 -= 90;
    if (rlat1 - refLat > 45) rlat1 -= 90;
  } else {
    if (rlat0 >= 270) rlat0 -= 360;
    if (rlat1 >= 270) rlat1 -= 360;
  }
  if (rlat0 < -90 || rlat0 > 90 || rlat1 < -90 || rlat1 > 90) return false;
  if (cprNL(rlat0) != cprNL(rlat1)) return false; // the pair straddles a longitude-zone boundary
  const double rlat = useOdd ? rlat1 : rlat0;
  const int nl = cprNL(rlat);
  const int ni = std::max(nl - (useOdd ? 1 : 0), 1);
  const int m = static_cast<int>(std::floor((lon0 * (nl - 1) - lon1 * nl) / CPR_SCALE + 0.5));
  double rlon = (range / ni) * (cprMod(m, ni) + (useOdd ? lon1 : lon0) / CPR_SCALE);
  if (surface) {
    rlon -= 90.0 * std::floor((rlon - refLon + 45.0) / 90.0); // one of four: the one near the reference
  }
  outLat = rlat;
  outLon = wrapLon(rlon);
  return true;
}

// Local decode against a reference within half a zone (about 180 NM airborne, 45 NM on the surface).
bool cprLocal(double refLat, double refLon, int cprLat, int cprLon, bool odd, bool surface, double& outLat, double& outLon) {
  const double range = surface ? 90.0 : 360.0;
  const double dlat = range / (odd ? 59.0 : 60.0);
  const double fl = cprLat / CPR_SCALE, fo = cprLon / CPR_SCALE;
  const double j = std::floor(refLat / dlat) + std::floor(0.5 + cprModD(refLat, dlat) / dlat - fl);
  const double rlat = dlat * (j + fl);
  if (rlat < -90 || rlat > 90 || std::fabs(rlat - refLat) > dlat / 2) return false;
  const int ni = std::max(cprNL(rlat) - (odd ? 1 : 0), 1);
  const double dlon = range / ni;
  const double m = std::floor(refLon / dlon) + std::floor(0.5 + cprModD(refLon, dlon) / dlon - fo);
  const double rlon = dlon * (m + fo);
  if (std::fabs(wrapLon(rlon - refLon)) > dlon / 2) return false;
  outLat = rlat;
  outLon = wrapLon(rlon);
  return true;
}

double distanceM(double lat1, double lon1, double lat2, double lon2) {
  const double r = M_PI / 180.0;
  const double dlat = (lat2 - lat1) * r, dlon = (lon2 - lon1) * r;
  const double h = std::sin(dlat / 2) * std::sin(dlat / 2) + std::cos(lat1 * r) * std::cos(lat2 * r) * std::sin(dlon / 2) * std::sin(dlon / 2);
  return 2 * 6371000.0 * std::asin(std::sqrt(std::fmin(h, 1.0)));
}

}  // namespace

Adsb::Adsb() {
  std::call_once(g_once, initTables);
  mag_.reserve(TRAIL + 262144);
}

void Adsb::setReceiver(double lat, double lon) {
  rxLat_ = lat;
  rxLon_ = lon;
  hasRx_ = true;
}

uint32_t Adsb::checksum(const uint8_t* msg, int bits) {
  std::call_once(g_once, initTables);
  return crc(msg, bits);
}

bool Adsb::known(uint32_t addr, int64_t nowMs) const {
  auto it = aircraft_.find(addr);
  return it != aircraft_.end() && nowMs - it->second.confirmedMs < CONFIRM_MS;
}

Aircraft& Adsb::get(uint32_t addr, int64_t nowMs) {
  auto it = aircraft_.find(addr);
  if (it != aircraft_.end()) return it->second;
  Aircraft& a = aircraft_[addr];
  a.addr = addr;
  a.seenMs = nowMs;
  return a;
}

// dump1090-style message score: < 0 rejects. Address/parity replies are only believable from aircraft we've
// recently heard with a verifiable CRC; repaired squitters only from aircraft we already know.
int Adsb::score(const uint8_t* msg, int bits, int* fixBit) const {
  *fixBit = -1;
  const int df = msg[0] >> 3;
  if (msgBits(df) != bits) return -2;
  bool zero = true;
  for (int i = 0; i < bits / 8; i++) zero = zero && msg[i] == 0;
  if (zero) return -2;
  const uint32_t syn = crc(msg, bits);
  const int64_t now = lastNow_;
  switch (df) {
    case 0: case 4: case 5: case 16: case 20: case 21:
      return known(syn, now) ? 1000 : -1;
    case 11: {
      if (syn & 0xFFFF80) return -2; // the low 7 bits are the interrogator id, the rest must be clean
      const uint32_t addr = getbits(msg, 9, 32);
      if ((syn & 0x7F) == 0) return known(addr, now) ? 1600 : 750;
      return known(addr, now) ? 1000 : -1;
    }
    case 17: case 18: {
      const uint32_t addr = getbits(msg, 9, 32);
      if (syn == 0) return known(addr, now) ? 1800 : 1400;
      for (auto& [s, k] : g_syn112) {
        if (s != syn) continue;
        uint32_t fixed = addr;
        if (k >= 8 && k < 32) fixed ^= 1u << (31 - k);
        if (!known(fixed, now)) return -1;
        *fixBit = k;
        return 900;
      }
      return -2;
    }
    default:
      return -2;
  }
}

int Adsb::process(const uint8_t* iq, int n, int64_t nowMs) {
  lastNow_ = nowMs;
  const int len = carry_ + n;
  mag_.resize(len);
  uint16_t* m = mag_.data();
  const uint16_t* pairs = reinterpret_cast<const uint16_t*>(iq); // little-endian: I in the low byte
  for (int i = 0; i < n; i++) m[carry_ + i] = g_mag[pairs[i]];

  uint8_t buf1[14], buf2[14];
  int accepted = 0;
  const int end = len - TRAIL;
  int j = 0;
  for (; j < end; j++) {
    const uint16_t* p = m + j;
    // a rising edge into the first pulse and a falling edge out of the last one
    if (!(p[0] < p[1] && p[12] > p[13])) continue;
    int high;
    uint32_t sig, noise;
    if (p[1] > p[2] && p[2] < p[3] && p[3] > p[4] && p[8] < p[9] && p[9] > p[10] && p[10] < p[11]) {
      high = (p[1] + p[3] + p[9] + p[11] + p[12]) / 4; // peaks at 1, 3, 9, 11-12: phase 3
      sig = p[1] + p[3] + p[9];
      noise = p[5] + p[6] + p[7];
    } else if (p[1] > p[2] && p[2] < p[3] && p[3] > p[4] && p[8] < p[9] && p[9] > p[10] && p[11] < p[12]) {
      high = (p[1] + p[3] + p[9] + p[12]) / 4; // 1, 3, 9, 12: phase 4
      sig = p[1] + p[3] + p[9] + p[12];
      noise = p[5] + p[6] + p[7] + p[8];
    } else if (p[1] > p[2] && p[2] < p[3] && p[4] > p[5] && p[8] < p[9] && p[10] > p[11] && p[11] < p[12]) {
      high = (p[1] + p[3] + p[4] + p[9] + p[10] + p[12]) / 4; // 1, 3-4, 9-10, 12: phase 5
      sig = p[1] + p[12];
      noise = p[6] + p[7];
    } else if (p[1] > p[2] && p[3] < p[4] && p[4] > p[5] && p[9] < p[10] && p[10] > p[11] && p[11] < p[12]) {
      high = (p[1] + p[4] + p[10] + p[12]) / 4; // 1, 4, 10, 12: phase 6
      sig = p[1] + p[4] + p[10] + p[12];
      noise = p[5] + p[6] + p[7] + p[8];
    } else if (p[2] > p[3] && p[3] < p[4] && p[4] > p[5] && p[9] < p[10] && p[10] > p[11] && p[11] < p[12]) {
      high = (p[1] + p[2] + p[4] + p[10] + p[12]) / 4; // 1-2, 4, 10, 12: phase 7
      sig = p[4] + p[10] + p[12];
      noise = p[6] + p[7] + p[8];
    } else {
      continue;
    }
    if (sig * 2 < 3 * noise) continue; // about 3.5 dB
    if (p[5] >= high || p[6] >= high || p[7] >= high || p[8] >= high || p[14] >= high || p[15] >= high ||
        p[16] >= high || p[17] >= high || p[18] >= high)
      continue; // the gaps between the preamble pulses must be quiet
    preambles_++;

    uint8_t* msg = buf1;
    uint8_t* best = nullptr;
    int bestScore = -2, bestBits = 0, bestFix = -1;
    for (int tryPhase = 4; tryPhase <= 8; tryPhase++) {
      const uint16_t* d = p + PREAMBLE;
      int bytes = 14;
      int units = tryPhase; // position in 1/5 samples; each bit is 12 units (2.4 samples)
      int i = 0;
      for (; i < bytes; i++) {
        uint8_t b = 0;
        for (int k = 0; k < 8; k++, units += 12) b = static_cast<uint8_t>((b << 1) | (slice(d + units / 5, units % 5) > 0));
        msg[i] = b;
        if (i == 0) {
          const int bits = msgBits(b >> 3);
          if (!bits) break;
          bytes = bits / 8;
        }
      }
      if (i < bytes) continue;
      int fix;
      const int sc = score(msg, bytes * 8, &fix);
      if (sc > bestScore) {
        best = msg;
        bestScore = sc;
        bestBits = bytes * 8;
        bestFix = fix;
        msg = msg == buf1 ? buf2 : buf1; // keep the best, demodulate the next phase into the other buffer
      }
    }
    if (bestScore < 0) continue;
    if (bestFix >= 0) best[bestFix >> 3] ^= static_cast<uint8_t>(0x80 >> (bestFix & 7));

    // signal level over the message
    const int samples = bestBits * 12 / 5;
    uint64_t power = 0;
    const uint16_t* d = p + PREAMBLE;
    for (int s = 0; s < samples; s++) power += static_cast<uint64_t>(d[s]) * d[s];
    const double level = static_cast<double>(power) / samples / (65535.0 * 65535.0);
    const float rssi = static_cast<float>(10 * std::log10(std::fmax(level, 1e-12)));

    if (decode(best, bestBits, nowMs, rssi)) {
      accepted++;
      j += PREAMBLE + samples - 20; // skip the message, minus a little in case the next one overlaps its tail
    }
  }
  // keep the unscanned tail (and anything a decoded message reached into) for the next block
  const int from = std::min(std::max(end, 0), len);
  const int skip = std::max(j - from, 0);
  carry_ = len - from;
  std::memmove(m, m + from, carry_ * sizeof(uint16_t));
  if (skip > 0 && skip < carry_) {
    // the next scan starts past the decoded message: blank the overlap so its pulses can't retrigger
    std::memset(m, 0, skip * sizeof(uint16_t));
  }
  messages_ += accepted;
  return accepted;
}

bool Adsb::decode(const uint8_t* msg, int bits, int64_t nowMs, float rssi) {
  const int df = msg[0] >> 3;
  if (msgBits(df) != bits) return false;
  const uint32_t syn = crc(msg, bits);
  Aircraft* a = nullptr;
  switch (df) {
    case 17:
    case 18: {
      if (syn != 0) return false;
      const int cf = msg[0] & 7;
      if (df == 18 && cf != 0 && cf != 1 && cf != 2 && cf != 5 && cf != 6) return false;
      a = &get(getbits(msg, 9, 32), nowMs);
      a->confirmedMs = nowMs;
      if (df == 18) a->nonIcao = cf == 1 || cf == 5;
      if (df == 17) {
        if (cf == 4) a->onGround = true;
        else if (cf == 5) a->onGround = false;
      }
      decodeExtendedSquitter(*a, msg, nowMs);
      break;
    }
    case 11: {
      if (syn & 0xFFFF80) return false;
      a = &get(getbits(msg, 9, 32), nowMs);
      if ((syn & 0x7F) == 0) a->confirmedMs = nowMs;
      const int ca = msg[0] & 7;
      if (ca == 4) a->onGround = true;
      else if (ca == 5) a->onGround = false;
      break;
    }
    case 0: case 4: case 5: case 16: case 20: case 21: {
      if (!known(syn, nowMs)) return false;
      a = &get(syn, nowMs);
      if (df == 0 || df == 16) {
        a->onGround = getbit(msg, 6);
      } else {
        const int fs = msg[0] & 7;
        if (fs == 1 || fs == 3) a->onGround = true;
        else if (fs == 0 || fs == 2) a->onGround = false;
      }
      if (df == 0 || df == 4 || df == 16 || df == 20) {
        const int alt = decodeAC13(getbits(msg, 20, 32));
        if (alt != INT32_MIN) a->altitude = alt;
      } else {
        a->squawk = static_cast<int>(id13ToHex(getbits(msg, 20, 32)));
      }
      if ((df == 20 || df == 21) && msg[4] == 0x20) callsign(msg, a->callsign); // Comm-B BDS 2,0
      break;
    }
    default:
      return false;
  }
  a->messages++;
  a->seenMs = nowMs;
  a->rssi = a->rssi <= -98 ? rssi : a->rssi * 0.75f + rssi * 0.25f;
  return true;
}

void Adsb::decodeExtendedSquitter(Aircraft& a, const uint8_t* msg, int64_t nowMs) {
  const int tc = static_cast<int>(getbits(msg, 33, 37));
  if (tc >= 1 && tc <= 4) {
    a.category = ((0x0E - tc) << 4) | static_cast<int>(getbits(msg, 38, 40));
    callsign(msg, a.callsign);
  } else if (tc >= 5 && tc <= 8) {
    a.onGround = true;
    const int mov = static_cast<int>(getbits(msg, 38, 44));
    if (mov == 1) a.gs = 0;
    else if (mov >= 2 && mov <= 8) a.gs = 0.125f * (mov - 1);
    else if (mov >= 9 && mov <= 12) a.gs = 1.0f + 0.25f * (mov - 9);
    else if (mov >= 13 && mov <= 38) a.gs = 2.0f + 0.5f * (mov - 13);
    else if (mov >= 39 && mov <= 93) a.gs = 15.0f + (mov - 39);
    else if (mov >= 94 && mov <= 108) a.gs = 70.0f + 2.0f * (mov - 94);
    else if (mov >= 109 && mov <= 123) a.gs = 100.0f + 5.0f * (mov - 109);
    else if (mov == 124) a.gs = 175;
    if (getbit(msg, 45)) a.track = getbits(msg, 46, 52) * 360.0f / 128.0f;
    updatePosition(a, getbit(msg, 54), static_cast<int>(getbits(msg, 55, 71)), static_cast<int>(getbits(msg, 72, 88)), true, nowMs);
  } else if ((tc >= 9 && tc <= 18) || (tc >= 20 && tc <= 22)) {
    a.onGround = false;
    const int alt = decodeAC12(getbits(msg, 41, 52));
    if (alt != INT32_MIN) (tc <= 18 ? a.altitude : a.gnssAltitude) = alt;
    updatePosition(a, getbit(msg, 54), static_cast<int>(getbits(msg, 55, 71)), static_cast<int>(getbits(msg, 72, 88)), false, nowMs);
  } else if (tc == 19) {
    const int st = static_cast<int>(getbits(msg, 38, 40));
    if (st == 1 || st == 2) {
      const int ew = static_cast<int>(getbits(msg, 47, 56)), ns = static_cast<int>(getbits(msg, 58, 67));
      if (ew && ns) {
        const int mult = st == 2 ? 4 : 1;
        const double vew = (ew - 1) * mult * (getbit(msg, 46) ? -1 : 1);
        const double vns = (ns - 1) * mult * (getbit(msg, 57) ? -1 : 1);
        a.gs = static_cast<float>(std::sqrt(vew * vew + vns * vns));
        double t = std::atan2(vew, vns) * 180.0 / M_PI;
        a.track = static_cast<float>(t < 0 ? t + 360 : t);
      }
    } else if (st == 3 || st == 4) {
      if (getbit(msg, 46)) a.heading = getbits(msg, 47, 56) * 360.0f / 1024.0f;
    }
    const int vr = static_cast<int>(getbits(msg, 70, 78));
    if (vr) a.vr = (vr - 1) * 64 * (getbit(msg, 69) ? -1 : 1);
  } else if (tc == 28) {
    if (getbits(msg, 38, 40) == 1) {
      a.emergency = static_cast<int>(getbits(msg, 41, 43));
      const unsigned id = getbits(msg, 44, 56);
      if (id) a.squawk = static_cast<int>(id13ToHex(id));
    }
  }
}

void Adsb::updatePosition(Aircraft& a, bool odd, int lat, int lon, bool surface, int64_t nowMs) {
  const int i = odd ? 1 : 0, o = 1 - i;
  a.cprLat[i] = lat;
  a.cprLon[i] = lon;
  a.cprMs[i] = nowMs;
  a.cprSurface[i] = surface;
  const bool rx = hasRx_;
  const bool recent = a.hasPos && nowMs - a.posMs < 120'000;
  // surface positions are ambiguous without something nearby to pick the right quadrant
  const double refLat = recent ? a.lat : rxLat_, refLon = recent ? a.lon : rxLon_;
  double rlat, rlon;
  bool ok = false;
  if (a.cprMs[o] && a.cprSurface[o] == surface && nowMs - a.cprMs[o] <= (surface ? 25'000 : 10'000) && (!surface || recent || rx)) {
    ok = cprGlobal(a.cprLat, a.cprLon, odd, surface, refLat, refLon, rlat, rlon);
  }
  if (!ok && recent) {
    ok = cprLocal(a.lat, a.lon, lat, lon, odd, surface, rlat, rlon);
  }
  if (!ok && rx) {
    ok = cprLocal(rxLat_, rxLon_, lat, lon, odd, surface, rlat, rlon) &&
         distanceM(rxLat_, rxLon_, rlat, rlon) < (surface ? 80'000 : 250'000); // past this a zone-off answer could slip through
  }
  if (ok) acceptPosition(a, rlat, rlon, nowMs);
}

bool Adsb::acceptPosition(Aircraft& a, double lat, double lon, int64_t nowMs) {
  if (hasRx_ && distanceM(rxLat_, rxLon_, lat, lon) > 500'000) return false; // far past any horizon
  if (a.hasPos && nowMs - a.posMs < 120'000) {
    const double dt = std::max((nowMs - a.posMs) / 1000.0, 0.1);
    const double kt = a.gs > 0 ? a.gs * 1.5 + 100 : 1000;
    if (distanceM(a.lat, a.lon, lat, lon) > kt * 0.5144 * dt + 2000) {
      if (++a.posRejects >= 3) { // probably the old position was the bad one: start over
        a.hasPos = false;
        a.posRejects = 0;
      }
      return false;
    }
  }
  a.lat = lat;
  a.lon = lon;
  a.hasPos = true;
  a.posMs = nowMs;
  a.posRejects = 0;
  return true;
}

int Adsb::snapshot(AircraftRecord* out, int max, int64_t nowMs) {
  int n = 0;
  for (auto it = aircraft_.begin(); it != aircraft_.end();) {
    Aircraft& a = it->second;
    if (nowMs - a.seenMs > EXPIRE_MS) {
      it = aircraft_.erase(it);
      continue;
    }
    ++it;
    if (a.hasPos && nowMs - a.posMs > EXPIRE_MS) a.hasPos = false;
    if (a.messages < 2 || n >= max) continue; // a lone message is as likely noise as an aircraft
    AircraftRecord& r = out[n++];
    std::memset(&r, 0, sizeof r);
    r.addr = static_cast<int32_t>(a.addr);
    r.flags = (a.hasPos ? 1 : 0) | (a.onGround ? 2 : 0) | (a.nonIcao ? 4 : 0) | (a.altitude != INT32_MIN ? 8 : 0) |
              (a.gs >= 0 ? 16 : 0) | (a.track >= 0 ? 32 : 0) | (a.vr != INT32_MIN ? 64 : 0) | (a.squawk >= 0 ? 128 : 0) |
              (a.gnssAltitude != INT32_MIN ? 256 : 0);
    r.lat = a.lat;
    r.lon = a.lon;
    r.altitude = a.altitude;
    r.gnssAltitude = a.gnssAltitude;
    r.gs = a.gs;
    r.track = a.track;
    r.heading = a.heading;
    r.vr = a.vr;
    r.squawk = a.squawk;
    r.emergency = a.emergency;
    r.category = a.category;
    r.rssi = a.rssi;
    r.messages = static_cast<int32_t>(a.messages);
    r.seenAgoMs = static_cast<int32_t>(nowMs - a.seenMs);
    r.posAgoMs = a.hasPos ? static_cast<int32_t>(nowMs - a.posMs) : -1;
    std::memcpy(r.callsign, a.callsign, 8);
  }
  return n;
}

}  // namespace tarang
