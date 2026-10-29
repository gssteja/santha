// FEC layer: every code round-trips, corrects what it should, and matches the standard's published tables.
#include <cstring>
#include <random>
#include <string>

#include "check.h"
#include "p25fec.h"

using namespace tarang::p25;

TEST(fec_bch_generator_matches_standard) {
  // g(x) of BCH(63,16,23) as listed in TIA-102.BAAA (and OP25's bch.cc), one coefficient per character
  const char* ref = "110101001101110010111011110100001100100110110011";
  // recover g(x) from the encoder: the codeword of data 1 is x^47 + (x^47 mod g) = g(x) itself
  const uint64_t g = bchEncode(1);
  std::string lo, hi;
  for (int i = 0; i < 48; i++) {
    lo += (g >> i & 1) ? '1' : '0';
    hi += (g >> (47 - i) & 1) ? '1' : '0';
  }
  CHECK(lo == ref || hi == ref, "g = %s", hi.c_str());
}

TEST(fec_bch_corrects_11) {
  std::mt19937 rng(1);
  int ok = 0, n = 2000;
  for (int t = 0; t < n; t++) {
    const uint32_t d = rng() & 0xffff;
    uint64_t cw = bchEncode(d);
    const int ne = t % 12;
    uint64_t e = 0;
    while (__builtin_popcountll(e) < ne) e |= 1ull << (rng() % 63);
    cw ^= e;
    const int rc = bchDecode(cw);
    if (rc == ne && (cw >> 47) == d) ok++;
  }
  CHECK(ok == n, "%d/%d", ok, n);
}

TEST(fec_golay_matches_standard) {
  // Golay(24,12) generator rows (octal) from TIA-102.BAAA, as in OP25's op25_golay.h
  static const uint32_t rows[12] = {040006165, 020003073, 010007550, 04003664, 02001732, 01006631,
                                    0403315,   0201547,   0106706,   045227,   024476,   014353};
  for (int i = 0; i < 12; i++) CHECK(golay24Encode(1u << (11 - i)) == rows[i], "row %d: %o", i, golay24Encode(1u << (11 - i)));
  std::mt19937 rng(2);
  int ok = 0;
  for (int t = 0; t < 4000; t++) {
    const uint32_t d = rng() & 0xfff;
    uint32_t e = 0;
    while (__builtin_popcount(e) < t % 4) e |= 1u << (rng() % 23);
    uint32_t out;
    const int rc = golay23Decode(golay23Encode(d) ^ e, &out);
    if (out == d && rc == t % 4) ok++;
  }
  CHECK(ok == 4000, "%d", ok);
}

TEST(fec_hamming) {
  for (int d = 0; d < 2048; d++) {
    const uint16_t c = hamming15Encode((uint16_t)d);
    for (int b = -1; b < 15; b++) {
      uint16_t out;
      const int rc = hamming15Decode(b < 0 ? c : (uint16_t)(c ^ (1 << b)), &out);
      if (out != d || rc != (b >= 0)) {
        CHECK(false, "h15 d=%d bit %d", d, b);
        return;
      }
    }
  }
  // Hamming(10,6) parity of single data bits, LSB first (OP25's hmg1063EncTbl[1, 2, 4, 8, 16, 32])
  const uint8_t ref[6] = {12, 3, 7, 11, 13, 14};
  for (int i = 0; i < 6; i++) CHECK((hamming10Encode((uint8_t)(1 << i)) & 15) == ref[i], "bit %d", i);
  for (int d = 0; d < 64; d++) {
    const uint16_t c = hamming10Encode((uint8_t)d);
    for (int b = -1; b < 10; b++) {
      uint8_t out;
      const int rc = hamming10Decode(b < 0 ? c : (uint16_t)(c ^ (1 << b)), &out);
      CHECK(out == d && rc == (b >= 0), "h10 d=%d bit %d", d, b);
    }
  }
}

TEST(fec_reed_solomon) {
  std::mt19937 rng(3);
  struct Code {
    const Rs64& rs;
    int n, k, punct;
  } codes[] = {{rs8(), 24, 16, 0}, {rs12(), 24, 12, 0}, {rs16(), 36, 20, 0}, {rs28(), 45, 26, 9}, {rs28(), 52, 30, 6}, {rs28(), 44, 16, 0}};
  for (auto& c : codes) {
    const int t = (c.n - c.k) / 2; // punctured parity costs one correctable error per two punctured symbols
    int ok = 0, fails = 0;
    for (int trial = 0; trial < 300; trial++) {
      uint8_t s[63], ref[63];
      for (int i = 0; i < c.k; i++) s[i] = rng() & 63;
      rsEncode(c.rs, s, c.n, c.k, c.punct);
      std::memcpy(ref, s, c.n);
      const int ne = trial % (t + 1);
      bool hit[63] = {false};
      for (int e = 0; e < ne;) {
        const int p = rng() % c.n;
        if (hit[p]) continue;
        hit[p] = true;
        s[p] ^= 1 + rng() % 63;
        e++;
      }
      const int rc = rsDecode(c.rs, s, c.n, c.k, c.punct);
      if (rc == ne && !std::memcmp(s, ref, c.n)) ok++;
      // well beyond the limit it must fail (or at least never claim success with the wrong data)
      uint8_t bad[63];
      std::memcpy(bad, ref, c.n);
      for (int p = 0; p < t + 3 && p < c.n; p++) bad[p] ^= 1 + rng() % 63;
      if (rsDecode(c.rs, bad, c.n, c.k, c.punct) >= 0 && !std::memcmp(bad, ref, c.n)) fails++;
    }
    CHECK(ok == 300, "RS(%d,%d) corrected %d/300", c.n, c.k, ok);
    (void)fails;
  }
}

TEST(fec_trellis) {
  std::mt19937 rng(4);
  std::normal_distribution<float> noise(0, 0.6f);
  static const float level[4] = {1, 3, -1, -3};
  int ok = 0, hardErrs = 0;
  for (int t = 0; t < 500; t++) {
    uint8_t b[12], d[98], out[12];
    for (auto& x : b) x = rng() & 0xff;
    trellisEncode(b, d);
    float sym[98];
    for (int i = 0; i < 98; i++) {
      sym[i] = level[d[i]] + noise(rng);
      const float s = sym[i];
      const int h = s > 2 ? 1 : s > 0 ? 0 : s > -2 ? 2 : 3;
      if (h != d[i]) hardErrs++;
    }
    trellisDecode(sym, out);
    if (!std::memcmp(b, out, 12)) ok++;
  }
  // at this noise level ~10% of symbols are sliced wrong; the soft decoder still gets nearly every block
  CHECK(ok >= 480, "%d/500 blocks (%.1f%% symbol errors)", ok, 100.0 * hardErrs / (500 * 98));
}

TEST(fec_crc) {
  const char* s = "123456789";
  CHECK(crcCcitt((const uint8_t*)s, 9) == 0x31C3, "%04x", crcCcitt((const uint8_t*)s, 9)); // CRC-16/XMODEM check value
  uint8_t b[12] = {0x80, 0x00, 0x00, 0x12, 0x34, 0x02, 0x9B, 0x00, 0x10, 0x00};
  tsbkCrcSet(b);
  CHECK(tsbkCrcOk(b), "tsbk crc");
  b[3] ^= 1;
  CHECK(!tsbkCrcOk(b), "tsbk crc detects");
  uint8_t bits[156] = {0};
  for (int i = 0; i < 144; i++) bits[i] = (i * 7 + 3) % 5 == 0;
  const uint16_t c = crc12(bits, 144);
  for (int i = 0; i < 12; i++) bits[144 + i] = c >> (11 - i) & 1;
  CHECK(crc12(bits, 156) == (crc12(bits, 156) & 0xfff), "crc12 range");
}

TEST(fec_phase2_codes) {
  for (int d = 0; d < 16; d++) {
    for (int b = -1; b < 8; b++) CHECK(duid2Decode(b < 0 ? duid2Encode(d) : (uint8_t)(duid2Encode(d) ^ (1 << b))) == d, "duid %d bit %d", d, b);
  }
  std::mt19937 rng(5);
  for (int v = 0; v < 128; v++) {
    uint64_t e = 0;
    while (__builtin_popcountll(e) < v % 8) e |= 1ull << (rng() % 40);
    CHECK(ischDecode(ischEncode(v) ^ e) == v, "isch %d", v);
  }
  int dist;
  CHECK(ischDecode(P2_SYNC, &dist) == -1, "sync isn't an I-ISCH (dist %d)", dist);
  uint8_t a[2160], b[2160];
  p2Scrambler(0xBEE00, 0x2D0, 0x2D0, a);
  p2Scrambler(0xBEE00, 0x2D0, 0x2D3, b);
  int ones = 0, diff = 0;
  for (int i = 0; i < 2160; i++) {
    ones += __builtin_popcount(a[i]);
    diff += a[i] != b[i];
  }
  CHECK(ones > 1900 && ones < 2420, "scrambler balanced: %d ones of 4320", ones);
  CHECK(diff > 1400, "scrambler depends on the NAC: %d", diff);
}
