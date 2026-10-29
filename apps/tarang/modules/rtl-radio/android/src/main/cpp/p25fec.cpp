#include "p25fec.h"

#include <cstring>
#include <initializer_list>

namespace tarang {
namespace p25 {

namespace {

// ---------- GF(64) ----------

constexpr int NN = 63, A0 = 63; // A0: log of zero

struct Gf {
  uint8_t exp[2 * NN]; // alpha^i, doubled so sums of two logs need no modulo
  uint8_t log[64];
  Gf() {
    int x = 1;
    for (int i = 0; i < NN; i++) {
      exp[i] = exp[i + NN] = (uint8_t)x;
      log[x] = (uint8_t)i;
      x <<= 1;
      if (x & 64) x ^= 0x43; // x^6 + x + 1
    }
    log[0] = A0;
  }
};

const Gf& gf() {
  static const Gf g;
  return g;
}

inline int mod63(int x) {
  while (x >= NN) x -= NN;
  while (x < 0) x += NN;
  return x;
}

// ---------- binary codes ----------

inline uint32_t polyRem(uint32_t v, int vbits, uint32_t g, int deg) { // v mod g over GF(2)
  for (int i = vbits - 1; i >= deg; i--)
    if (v >> i & 1) v ^= g << (i - deg);
  return v;
}

constexpr uint32_t GOLAY_G = 0xC75; // x^11 + x^10 + x^6 + x^5 + x^4 + x^2 + 1

struct GolayTable {
  uint32_t err[2048]; // syndrome -> error pattern (weight <= 3)
  GolayTable() {
    for (uint32_t a = 0; a < 23; a++)
      for (uint32_t b = a; b < 23; b++)
        for (uint32_t c = b; c < 23; c++) {
          // patterns of weight 0..3 (a == b == c means weight 1, etc.)
          uint32_t e = (1u << a) ^ (b != a ? 1u << b : 0) ^ (c != b ? 1u << c : 0);
          if (a == b && b == c) e = 1u << a;
          err[polyRem(e, 23, GOLAY_G, 11)] = e;
        }
    err[0] = 0;
  }
};

const GolayTable& golayTable() {
  static const GolayTable t;
  return t;
}

// Hamming parity columns, one per data bit, most significant data bit first
constexpr uint8_t H15[11] = {0xF, 0xE, 0xD, 0xC, 0xB, 0xA, 0x9, 0x7, 0x6, 0x5, 0x3};
constexpr uint8_t H10[6] = {0xE, 0xD, 0xB, 0x7, 0x3, 0xC};

// ---------- BCH(63,16,23) ----------

struct Bch {
  uint64_t g = 0; // degree 47
  Bch() {
    const Gf& f = gf();
    // generator = LCM of the minimal polynomials of alpha^1 .. alpha^22
    bool used[NN] = {false};
    uint64_t gp = 1;
    for (int i = 1; i <= 22; i++) {
      if (used[i]) continue;
      uint8_t m[8] = {1}; // minimal polynomial over GF(64), low degree first
      int deg = 0;
      for (int j = i; !used[j]; j = j * 2 % NN) {
        used[j] = true;
        // m *= (x + alpha^j)
        for (int k = deg + 1; k > 0; k--) m[k] = m[k - 1] ^ (m[k] ? f.exp[f.log[m[k]] + j] : 0);
        m[0] = m[0] ? f.exp[f.log[m[0]] + j] : 0;
        deg++;
      }
      uint64_t mb = 0; // coefficients are 0/1 for a minimal polynomial
      for (int k = 0; k <= deg; k++)
        if (m[k]) mb |= 1ull << k;
      uint64_t prod = 0;
      for (int k = 0; k <= deg; k++)
        if (mb >> k & 1) prod ^= gp << k;
      gp = prod;
    }
    g = gp;
  }
};

const Bch& bch() {
  static const Bch b;
  return b;
}

// ---------- trellis ----------

// next_words[state][input]: the 4-bit constellation point sent for [input] dibit in [state] (the last input)
constexpr uint8_t TRELLIS[4][4] = {{0x2, 0xC, 0x1, 0xF}, {0xE, 0x0, 0xD, 0x3}, {0x9, 0x7, 0xA, 0x4}, {0x5, 0xB, 0x6, 0x8}};
constexpr float LEVEL[4] = {1, 3, -1, -3}; // dibit 00 -> +1, 01 -> +3, 10 -> -1, 11 -> -3

// codeword c of the 49 occupies dibits pos(c), pos(c) + 1 of the interleaved block
constexpr int TRELLIS_OFF[4] = {0, 26, 50, 74};
inline int trellisPos(int c) { return c == 48 ? 24 : 2 * (c / 4) + TRELLIS_OFF[c % 4]; }

}  // namespace

// ---------- Reed-Solomon ----------

Rs64::Rs64(int nroots) : nroots_(nroots) {
  const Gf& f = gf();
  uint8_t g[29] = {1};
  for (int i = 0; i < nroots; i++) {
    const int root = 1 + i; // FCR 1, PRIM 1
    g[i + 1] = 1;
    for (int j = i; j > 0; j--) g[j] = g[j] ? g[j - 1] ^ f.exp[f.log[g[j]] + root] : g[j - 1];
    g[0] = f.exp[f.log[g[0]] + root];
  }
  for (int i = 0; i <= nroots; i++) gen_[i] = f.log[g[i]];
}

void Rs64::encode(const uint8_t* data, int k, uint8_t* parity) const {
  const Gf& f = gf();
  std::memset(parity, 0, nroots_);
  for (int i = 0; i < k; i++) {
    const int fb = f.log[(data[i] ^ parity[0]) & 63];
    if (fb != A0)
      for (int j = 1; j < nroots_; j++) parity[j] ^= f.exp[mod63(fb + gen_[nroots_ - j])];
    std::memmove(parity, parity + 1, nroots_ - 1);
    parity[nroots_ - 1] = fb != A0 ? f.exp[mod63(fb + gen_[0])] : 0;
  }
}

// Berlekamp-Massey with erasures, Chien search and Forney (after Phil Karn's decode_rs).
int Rs64::decode(uint8_t cw[63], int pad, const int* eras, int neras) const {
  const Gf& f = gf();
  const int nr = nroots_;
  int s[28];
  bool nonzero = false;
  for (int i = 0; i < nr; i++) {
    int v = cw[0] & 63;
    for (int j = 1; j < NN; j++) v = (cw[j] & 63) ^ (v ? f.exp[f.log[v] + 1 + i] : 0);
    s[i] = f.log[v];
    if (v) nonzero = true;
  }
  if (!nonzero) return 0;
  if (neras > nr) return -1;

  int lambda[29] = {1}, b[29], t[29], omega[29], root[28], loc[28], reg[29];
  for (int i = 1; i <= nr; i++) lambda[i] = 0;
  if (neras > 0) {
    lambda[1] = f.exp[mod63(NN - 1 - eras[0])];
    for (int i = 1; i < neras; i++) {
      const int u = mod63(NN - 1 - eras[i]);
      for (int j = i + 1; j > 0; j--) {
        const int tmp = f.log[lambda[j - 1]];
        if (tmp != A0) lambda[j] ^= f.exp[mod63(u + tmp)];
      }
    }
  }
  for (int i = 0; i <= nr; i++) b[i] = f.log[lambda[i]];
  int r = neras, el = neras;
  while (++r <= nr) {
    int discr = 0;
    for (int i = 0; i < r; i++)
      if (lambda[i] != 0 && s[r - i - 1] != A0) discr ^= f.exp[mod63(f.log[lambda[i]] + s[r - i - 1])];
    discr = f.log[discr];
    if (discr == A0) {
      std::memmove(&b[1], b, nr * sizeof(int));
      b[0] = A0;
    } else {
      t[0] = lambda[0];
      for (int i = 0; i < nr; i++) t[i + 1] = b[i] != A0 ? lambda[i + 1] ^ f.exp[mod63(discr + b[i])] : lambda[i + 1];
      if (2 * el <= r + neras - 1) {
        el = r + neras - el;
        for (int i = 0; i <= nr; i++) b[i] = lambda[i] == 0 ? A0 : mod63(f.log[lambda[i]] - discr + NN);
      } else {
        std::memmove(&b[1], b, nr * sizeof(int));
        b[0] = A0;
      }
      std::memcpy(lambda, t, (nr + 1) * sizeof(int));
    }
  }
  int degLambda = 0;
  for (int i = 0; i <= nr; i++) {
    lambda[i] = f.log[lambda[i]];
    if (lambda[i] != A0) degLambda = i;
  }
  if (degLambda == 0) return -1;
  for (int i = 1; i <= nr; i++) reg[i] = lambda[i];
  int count = 0;
  for (int i = 1, k = 0; i <= NN; i++, k = mod63(k + 1)) {
    int q = 1;
    for (int j = degLambda; j > 0; j--)
      if (reg[j] != A0) {
        reg[j] = mod63(reg[j] + j);
        q ^= f.exp[reg[j]];
      }
    if (q != 0) continue;
    root[count] = i;
    loc[count] = k;
    if (++count == degLambda) break;
  }
  if (count != degLambda) return -1;
  const int degOmega = degLambda - 1;
  for (int i = 0; i <= degOmega; i++) {
    int tmp = 0;
    for (int j = i; j >= 0; j--)
      if (s[i - j] != A0 && lambda[j] != A0) tmp ^= f.exp[mod63(s[i - j] + lambda[j])];
    omega[i] = f.log[tmp];
  }
  for (int j = count - 1; j >= 0; j--) {
    int num1 = 0;
    for (int i = degOmega; i >= 0; i--)
      if (omega[i] != A0) num1 ^= f.exp[mod63(omega[i] + i * root[j])];
    const int num2 = f.exp[0]; // alpha^(root * (FCR - 1)) with FCR = 1
    int den = 0;
    for (int i = (degLambda < nr - 1 ? degLambda : nr - 1) & ~1; i >= 0; i -= 2)
      if (lambda[i + 1] != A0) den ^= f.exp[mod63(lambda[i + 1] + i * root[j])];
    if (den == 0) return -1;
    if (num1 != 0) {
      if (loc[j] < pad) return -1; // an "error" in a shortened code's known zeros
      cw[loc[j]] ^= f.exp[mod63(f.log[num1] + f.log[num2] + NN - f.log[den])];
    }
  }
  // more errors than the code can fix sometimes "decode" to a wrong word: check it really is a codeword
  for (int i = 0; i < nr; i++) {
    int v = cw[0] & 63;
    for (int j = 1; j < NN; j++) v = (cw[j] & 63) ^ (v ? f.exp[f.log[v] + 1 + i] : 0);
    if (v) return -1;
  }
  return count;
}

int rsDecode(const Rs64& rs, uint8_t* syms, int n, int k, int punctured) {
  uint8_t cw[63] = {0};
  const int pad = 63 - n - punctured;
  std::memcpy(cw + pad, syms, n);
  int eras[28];
  for (int i = 0; i < punctured; i++) eras[i] = 63 - punctured + i;
  const int rc = rs.decode(cw, pad, eras, punctured);
  if (rc < 0) return -1;
  std::memcpy(syms, cw + pad, n);
  return rc - punctured < 0 ? 0 : rc - punctured;
}

void rsEncode(const Rs64& rs, uint8_t* syms, int n, int k, int punctured) {
  uint8_t parity[28];
  rs.encode(syms, k, parity);
  std::memcpy(syms + k, parity, n - k); // the last [punctured] parity symbols aren't sent
  (void)punctured;
}

const Rs64& rs8() {
  static const Rs64 r(8);
  return r;
}
const Rs64& rs12() {
  static const Rs64 r(12);
  return r;
}
const Rs64& rs16() {
  static const Rs64 r(16);
  return r;
}
const Rs64& rs28() {
  static const Rs64 r(28);
  return r;
}

// ---------- BCH ----------

uint64_t bchEncode(uint32_t data16) {
  const uint64_t g = bch().g;
  uint64_t v = (uint64_t)(data16 & 0xffff) << 47;
  uint64_t r = v;
  for (int i = 62; i >= 47; i--)
    if (r >> i & 1) r ^= g << (i - 47);
  return v | r;
}

int bchDecode(uint64_t& cw) {
  const Gf& f = gf();
  int s[23]; // s[1..22], log form
  bool nonzero = false;
  for (int i = 1; i <= 22; i++) {
    int v = 0;
    for (int j = 0; j < NN; j++)
      if (cw >> j & 1) v ^= f.exp[(i * j) % NN];
    s[i] = f.log[v];
    if (v) nonzero = true;
  }
  if (!nonzero) return 0;
  // Berlekamp-Massey (polynomial form)
  uint8_t c[24] = {1}, bb[24] = {1}, tt[24];
  int L = 0, m = 1;
  uint8_t bd = 1; // last nonzero discrepancy
  for (int n = 0; n < 22; n++) {
    int d = s[n + 1] != A0 ? f.exp[s[n + 1]] : 0;
    for (int i = 1; i <= L; i++)
      if (c[i] && s[n + 1 - i] != A0) d ^= f.exp[f.log[c[i]] + s[n + 1 - i]];
    if (d == 0) {
      m++;
      continue;
    }
    const int coef = mod63(f.log[d] - f.log[bd]); // d / bd
    std::memcpy(tt, c, sizeof c);
    for (int i = 0; i + m < 24; i++)
      if (bb[i]) c[i + m] ^= f.exp[mod63(coef + f.log[bb[i]])];
    if (2 * L <= n) {
      L = n + 1 - L;
      std::memcpy(bb, tt, sizeof bb);
      bd = (uint8_t)d;
      m = 1;
    } else {
      m++;
    }
  }
  if (L > 11) return -1;
  // Chien search: an error at bit position p is a root alpha^-p
  int found = 0;
  uint64_t fix = 0;
  for (int p = 0; p < NN; p++) {
    int q = 0;
    for (int i = 0; i <= L; i++)
      if (c[i]) q ^= f.exp[mod63(f.log[c[i]] - i * p)];
    if (q == 0) {
      fix |= 1ull << p;
      found++;
    }
  }
  if (found != L) return -1;
  cw ^= fix;
  return found;
}

// ---------- Golay / Hamming ----------

uint32_t golay23Encode(uint32_t d12) {
  d12 &= 0xfff;
  return d12 << 11 | polyRem(d12 << 11, 23, GOLAY_G, 11);
}

int golay23Decode(uint32_t cw, uint32_t* d12) {
  cw &= 0x7fffff;
  const uint32_t e = golayTable().err[polyRem(cw, 23, GOLAY_G, 11)];
  cw ^= e;
  *d12 = cw >> 11;
  return __builtin_popcount(e);
}

uint32_t golay24Encode(uint32_t d12) {
  const uint32_t c = golay23Encode(d12);
  return c << 1 | (__builtin_popcount(c) & 1);
}

int golay24Decode(uint32_t cw24, uint32_t* d12) {
  const int e = golay23Decode(cw24 >> 1, d12);
  const uint32_t fixed = golay24Encode(*d12);
  return e + ((fixed ^ cw24) & 1);
}

uint16_t hamming15Encode(uint16_t d) {
  uint16_t p = 0;
  for (int i = 0; i < 11; i++)
    if (d >> (10 - i) & 1) p ^= H15[i];
  return (uint16_t)((d & 0x7ff) << 4 | p);
}

int hamming15Decode(uint16_t cw, uint16_t* d) {
  uint16_t data = (cw >> 4) & 0x7ff;
  const uint8_t syn = (uint8_t)((hamming15Encode(data) ^ cw) & 0xf);
  if (syn == 0) {
    *d = data;
    return 0;
  }
  for (int i = 0; i < 11; i++)
    if (H15[i] == syn) data ^= 1 << (10 - i);
  *d = data;
  return 1;
}

uint16_t hamming10Encode(uint8_t d) {
  uint8_t p = 0;
  for (int i = 0; i < 6; i++)
    if (d >> (5 - i) & 1) p ^= H10[i];
  return (uint16_t)((d & 63) << 4 | p);
}

int hamming10Decode(uint16_t cw, uint8_t* d) {
  uint8_t data = (cw >> 4) & 63;
  const uint8_t syn = (uint8_t)((hamming10Encode(data) ^ cw) & 0xf);
  *d = data;
  if (syn == 0) return 0;
  if (__builtin_popcount(syn) == 1) return 1; // a parity bit
  for (int i = 0; i < 6; i++)
    if (H10[i] == syn) {
      *d = data ^ (1 << (5 - i));
      return 1;
    }
  return -1;
}

// ---------- trellis ----------

void trellisEncode(const uint8_t bytes[12], uint8_t dibits[98]) {
  int state = 0;
  for (int c = 0; c < 49; c++) {
    const int in = c < 48 ? (bytes[c / 4] >> (6 - 2 * (c % 4))) & 3 : 0;
    const uint8_t w = TRELLIS[state][in];
    state = in;
    const int p = trellisPos(c);
    dibits[p] = w >> 2;
    dibits[p + 1] = w & 3;
  }
}

float trellisDecode(const float sym[98], uint8_t bytes[12]) {
  float metric[4] = {0, 1e30f, 1e30f, 1e30f};
  uint8_t from[49][4];
  for (int c = 0; c < 49; c++) {
    const int p = trellisPos(c);
    const float r1 = sym[p], r2 = sym[p + 1];
    float next[4] = {1e30f, 1e30f, 1e30f, 1e30f};
    for (int st = 0; st < 4; st++) {
      if (metric[st] >= 1e29f) continue;
      for (int in = 0; in < 4; in++) {
        const uint8_t w = TRELLIS[st][in];
        const float e1 = r1 - LEVEL[w >> 2], e2 = r2 - LEVEL[w & 3];
        const float m = metric[st] + e1 * e1 + e2 * e2;
        if (m < next[in]) {
          next[in] = m;
          from[c][in] = (uint8_t)st;
        }
      }
    }
    std::memcpy(metric, next, sizeof metric);
  }
  // the flush dibit is 0, so the path ends in state 0; walk back
  int st = 0;
  uint8_t in[49];
  for (int c = 48; c >= 0; c--) {
    in[c] = (uint8_t)st;
    st = from[c][st];
  }
  std::memset(bytes, 0, 12);
  for (int c = 0; c < 48; c++) bytes[c / 4] |= in[c] << (6 - 2 * (c % 4));
  return metric[0];
}

// ---------- CRCs ----------

uint16_t crcCcitt(const uint8_t* b, int n) {
  uint16_t crc = 0;
  for (int i = 0; i < n; i++) {
    crc ^= (uint16_t)(b[i] << 8);
    for (int k = 0; k < 8; k++) crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
  }
  return crc;
}

bool tsbkCrcOk(const uint8_t b[12]) { return (crcCcitt(b, 10) ^ 0xffff) == (b[10] << 8 | b[11]); }

void tsbkCrcSet(uint8_t b[12]) {
  const uint16_t c = crcCcitt(b, 10) ^ 0xffff;
  b[10] = c >> 8;
  b[11] = c & 0xff;
}

uint16_t crc12(const uint8_t* bits, int nbits) {
  uint16_t crc = 0;
  for (int i = 0; i < nbits; i++) {
    const int fb = ((crc >> 11) & 1) ^ (bits[i] & 1);
    crc = (uint16_t)((crc << 1) & 0xfff);
    if (fb) crc ^= 0x897;
  }
  return crc ^ 0xfff;
}

// ---------- Phase 2 ----------

namespace {
constexpr uint64_t ISCH_OFFSET = 0x184229d461ULL;
constexpr uint64_t ISCH_GEN[7] = {0x343d8597ULL, 0x58cbaa4eULL, 0x9da3a171ULL, 0x9048d9b72ULL,
                                  0x20807f7ffULL, 0xc00ded18eULL, 0x100f4b1758ULL};
constexpr uint8_t DUID_CW[16] = {0x00, 0x17, 0x2e, 0x39, 0x4b, 0x5c, 0x65, 0x72,
                                 0x8d, 0x9a, 0xa3, 0xb4, 0xc6, 0xd1, 0xe8, 0xff};
}  // namespace

uint64_t ischEncode(int v) {
  uint64_t c = ISCH_OFFSET;
  for (int k = 0; k < 7; k++)
    if (v >> k & 1) c ^= ISCH_GEN[k];
  return c;
}

int ischDecode(uint64_t cw, int* dist) {
  int best = -1, bestD = 41;
  for (int v = 0; v < 128; v++) {
    const int d = __builtin_popcountll((cw ^ ischEncode(v)) & 0xffffffffffULL);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  if (dist) *dist = bestD;
  return bestD <= 7 ? best : -1;
}

uint8_t duid2Encode(int duid) { return DUID_CW[duid & 15]; }

int duid2Decode(uint8_t cw) {
  int best = -1, bestD = 9, ties = 0;
  for (int d = 0; d < 16; d++) {
    const int dist = __builtin_popcount(cw ^ DUID_CW[d]);
    if (dist < bestD) {
      bestD = dist;
      best = d;
      ties = 0;
    } else if (dist == bestD) {
      ties++;
    }
  }
  return bestD <= 1 && ties == 0 ? best : -1;
}

void p2Scrambler(uint32_t wacn, uint32_t sysid, uint32_t nac, uint8_t out[2160]) {
  const uint64_t seed = (uint64_t)(wacn & 0xfffff) << 24 | (uint64_t)(sysid & 0xfff) << 12 | (nac & 0xfff);
  // initial register: seed (as a 44-bit row vector, MSB = element 0) times the standard's 44x44 matrix, whose row
  // i has ones in columns i, i+4, i+9, i+15, i+20 and i+34
  auto bitAt = [&](int i) -> int { return (int)(seed >> (43 - i) & 1); };
  uint64_t reg = 0;
  for (int j = 0; j < 44; j++) {
    int b = 0;
    for (int off : {0, 4, 9, 15, 20, 34})
      if (j - off >= 0) b ^= bitAt(j - off);
    reg = reg << 1 | b;
  }
  for (int i = 0; i < 4320; i++) {
    const int bit = (int)(reg >> 43 & 1);
    if (i & 1) out[i >> 1] |= (uint8_t)bit;
    else out[i >> 1] = (uint8_t)(bit << 1);
    // six shift registers of 4, 5, 6, 5, 14 and 10 bits, all fed from the first one's top bit
    uint64_t s1 = reg >> 40 & 0xf, s2 = reg >> 35 & 0x1f, s3 = reg >> 29 & 0x3f, s4 = reg >> 24 & 0x1f, s5 = reg >> 10 & 0x3fff,
             s6 = reg & 0x3ff;
    const uint64_t c1 = s1 >> 3 & 1, c2 = s2 >> 4 & 1, c3 = s3 >> 5 & 1, c4 = s4 >> 4 & 1, c5 = s5 >> 13 & 1, c6 = s6 >> 9 & 1;
    s1 = (s1 << 1 & 0xf) | (c1 ^ c2);
    s2 = (s2 << 1 & 0x1f) | (c1 ^ c3);
    s3 = (s3 << 1 & 0x3f) | (c1 ^ c4);
    s4 = (s4 << 1 & 0x1f) | (c1 ^ c5);
    s5 = (s5 << 1 & 0x3fff) | (c1 ^ c6);
    s6 = (s6 << 1 & 0x3ff) | c1;
    reg = s1 << 40 | s2 << 35 | s3 << 29 | s4 << 24 | s5 << 10 | s6;
  }
}

}  // namespace p25
}  // namespace tarang
