// Phase 1: IMBE frame FEC, the framer on ideal symbols (every frame type), and control channels through the
// whole receiver (channelizer, both detectors, AFC) as C4FM, LSM / CQPSK and simulcast.
#include <cstring>
#include <map>
#include <random>

#include "check.h"
#include "p25.h"
#include "p25gen.h"
#include "test_vocoder.h"

using namespace tarang::p25;

namespace {

struct Collector : P1Listener {
  std::vector<std::array<uint8_t, 12>> tsbks;
  std::vector<std::array<uint8_t, 88>> imbe;
  std::vector<int> imbeErrs;
  std::vector<std::array<uint8_t, 9>> lcs;
  std::vector<int> nids, algids, tgids;
  int terms = 0;
  void onNid(int nac, int duid, int) override { nids.push_back(duid); }
  void onTsbk(int, const uint8_t t[12]) override {
    std::array<uint8_t, 12> a;
    std::memcpy(a.data(), t, 12);
    tsbks.push_back(a);
  }
  void onHeader(int, int algid, int, int tgid) override {
    algids.push_back(algid);
    tgids.push_back(tgid);
  }
  void onLinkControl(int, const uint8_t lc[9]) override {
    std::array<uint8_t, 9> a;
    std::memcpy(a.data(), lc, 9);
    lcs.push_back(a);
  }
  void onEncryptionSync(int, int algid, int) override { algids.push_back(algid); }
  void onTerminator(int) override { terms++; }
  void onImbe(const uint8_t b[88], int errs) override {
    std::array<uint8_t, 88> a;
    std::memcpy(a.data(), b, 88);
    imbe.push_back(a);
    imbeErrs.push_back(errs);
  }
};

std::vector<float> staircase(const gen::Dibits& d, int sps) {
  std::vector<float> v;
  for (uint8_t x : d)
    for (int k = 0; k < sps; k++) v.push_back(LEVELS[x]);
  return v;
}

std::array<uint8_t, 88> randomImbe(std::mt19937& rng) {
  std::array<uint8_t, 88> a;
  for (auto& b : a) b = rng() & 1;
  return a;
}

constexpr int NAC = 0x2D0;
constexpr uint32_t WACN = 0xBEE00;
constexpr int SYSID = 0x2D0;
constexpr int64_t BASE = 851006250;
constexpr int64_t CC = 853262500;
const int CC_CH = 0x1000 | (int)((CC - BASE) / 6250);

// a control channel's TSBK stream: system broadcasts plus whatever [extra] adds
std::vector<std::array<uint8_t, 12>> ccTsbks(int n, std::mt19937& rng) {
  std::vector<std::array<uint8_t, 12>> t;
  for (int i = 0; i < n; i++) {
    switch (i % 5) {
      case 0: t.push_back(gen::idenUp(1, BASE, 6250)); break;
      case 1: t.push_back(gen::idenUpTdma(2, BASE, 6250)); break;
      case 2: t.push_back(gen::netStatus(WACN, SYSID, CC_CH)); break;
      case 3: t.push_back(gen::rfssStatus(SYSID, 1, 1, CC_CH)); break;
      default: {
        auto g = gen::idle();
        for (int k = 2; k < 10; k++) g[k] = rng() & 0xff;
        t.push_back(g);
      }
    }
  }
  return t;
}

// TSDUs with 1-3 TSBKs each, as one dibit stream
gen::Dibits ccStream(const std::vector<std::array<uint8_t, 12>>& tsbks, std::mt19937& rng) {
  gen::Dibits d;
  for (size_t i = 0; i < tsbks.size();) {
    const size_t n = std::min<size_t>(1 + rng() % 3, tsbks.size() - i);
    std::vector<std::array<uint8_t, 12>> blk(tsbks.begin() + i, tsbks.begin() + i + n);
    gen::Dibits f = gen::tsdu(NAC, blk);
    d.insert(d.end(), f.begin(), f.end());
    i += n;
  }
  return d;
}

struct RunStats {
  int tsbks = 0;
  std::string state;
};

// Runs a receiver on [txs] until the air goes quiet; returns the decoded TSBK count.
RunStats runCc(std::vector<gen::Tx> txs, float noise, uint32_t seed, Receiver& rx) {
  gen::Dongle d(seed, noise);
  d.txs = std::move(txs);
  d.center = CC - 300000;
  rx.setControlChannels({CC});
  int64_t samples = 0;
  for (auto& tx : d.txs) samples = std::max<int64_t>(samples, (tx.start + (int64_t)tx.bb.size()) * 50);
  std::vector<uint8_t> buf(2 * 76800);
  while (d.t < samples + 76800) {
    d.read(buf.data(), 76800);
    const int64_t want = rx.process(buf.data(), 76800, d.center, d.t / 2400);
    if (want != d.center) {
      d.center = want;
      d.read(buf.data(), 24576); // the engine's settling flush
    }
  }
  RunStats r;
  r.tsbks = (int)rx.trunk().grants(); // placeholder, replaced below
  r.state = rx.state(d.t / 2400);
  const size_t p = r.state.find("\"tsbks\":");
  r.tsbks = p == std::string::npos ? 0 : std::atoi(r.state.c_str() + p + 8);
  return r;
}

}  // namespace

TEST(p1_imbe_fec_roundtrip) {
  std::mt19937 rng(11);
  int ok = 0;
  for (int t = 0; t < 2000; t++) {
    auto u = randomImbe(rng);
    uint8_t c[144], out[88];
    imbeEncode(u.data(), c);
    // errors the FEC can fix: up to 3 per Golay word (c0..c3), 1 per Hamming word (c4..c6), none in c7
    int expect = 0;
    for (int w = 0; w < 4; w++) {
      const int ne = rng() % 4;
      std::vector<int> pos;
      while ((int)pos.size() < ne) {
        const int p = rng() % 23;
        if (std::find(pos.begin(), pos.end(), p) == pos.end()) pos.push_back(p);
      }
      for (int p : pos) c[23 * w + p] ^= 1;
      expect += ne;
    }
    for (int w = 0; w < 3; w++)
      if (rng() & 1) {
        c[92 + 15 * w + rng() % 15] ^= 1;
        expect++;
      }
    const int errs = imbeDecode(c, out);
    if (!std::memcmp(out, u.data(), 88) && errs == expect) ok++;
  }
  CHECK(ok == 2000, "%d/2000", ok);
}

TEST(p1_framer_every_frame_type) {
  std::mt19937 rng(12);
  Collector col;
  P1Framer f(10, &col);
  auto tsbks = ccTsbks(30, rng);
  gen::Dibits s = ccStream(tsbks, rng);
  // a voice call: HDU, LDU1, LDU2, LDU1, LDU2, TDU
  std::vector<std::array<uint8_t, 88>> sent;
  const uint8_t lc[9] = {0x00, 0x00, 0x00, 0x00, 0x02, 0x93, 0x12, 0x34, 0x56}; // group 659 from 0x123456
  uint8_t ess[12] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 0x80, 0x00, 0x00};
  auto add = [&](const gen::Dibits& x) { s.insert(s.end(), x.begin(), x.end()); };
  add(gen::hdu(NAC, 0x80, 0, 659));
  for (int k = 0; k < 4; k++) {
    std::vector<std::array<uint8_t, 88>> v;
    for (int i = 0; i < 9; i++) v.push_back(randomImbe(rng));
    sent.insert(sent.end(), v.begin(), v.end());
    add(gen::ldu(NAC, k % 2 ? LDU2 : LDU1, v, k % 2 ? ess : lc));
  }
  add(gen::tdu(NAC));
  add(gen::Dibits(200, 0));
  auto v = staircase(s, 10);
  f.process(v.data(), (int)v.size());
  CHECK(col.tsbks.size() == tsbks.size(), "tsbks %zu/%zu", col.tsbks.size(), tsbks.size());
  bool same = col.tsbks.size() == tsbks.size();
  for (size_t i = 0; same && i < tsbks.size(); i++) same = !std::memcmp(col.tsbks[i].data() + 1, tsbks[i].data() + 1, 9);
  CHECK(same, "tsbk contents");
  CHECK(col.imbe.size() == sent.size(), "imbe %zu/%zu", col.imbe.size(), sent.size());
  bool vs = col.imbe.size() == sent.size();
  for (size_t i = 0; vs && i < sent.size(); i++) vs = col.imbe[i] == sent[i];
  CHECK(vs, "imbe contents");
  CHECK(col.lcs.size() == 2 && !std::memcmp(col.lcs[0].data(), lc, 9), "link control %zu", col.lcs.size());
  CHECK(col.tgids.size() == 1 && col.tgids[0] == 659, "header talkgroup");
  CHECK(col.algids.size() == 3 && col.algids[0] == 0x80 && col.algids[1] == 0x80, "algids %zu", col.algids.size());
  CHECK(col.terms == 1, "terminator %d", col.terms);
  CHECK(f.nac() == NAC, "learned NAC %03x", f.nac());
}

TEST(p1_cc_c4fm_through_receiver) {
  std::mt19937 rng(13);
  auto tsbks = ccTsbks(400, rng);
  gen::Tx tx;
  tx.freq = CC;
  tx.bb = gen::c4fm(ccStream(tsbks, rng));
  tx.freqErr = 650; // dongle ~0.8 ppm off at 853 MHz
  Receiver rx;
  auto r = runCc({tx}, 0.03f, 1, rx);
  CHECK(r.tsbks >= (int)tsbks.size() * 97 / 100, "decoded %d of %zu TSBKs", r.tsbks, tsbks.size());
  CHECK(rx.trunk().wacn() == WACN && rx.trunk().sysid() == SYSID && rx.trunk().nac() == NAC, "system %05x %03x %03x",
        rx.trunk().wacn(), rx.trunk().sysid(), rx.trunk().nac());
  CHECK(rx.trunk().channelFor(CC_CH).freq == CC, "iden: %lld", (long long)rx.trunk().channelFor(CC_CH).freq);
  CHECK(r.state.find("\"path\":\"c4fm\"") != std::string::npos, "path %s", r.state.c_str() + r.state.find("\"rx\""));
  const size_t p = r.state.find("\"afc\":");
  CHECK(std::abs(std::atof(r.state.c_str() + p + 6) - 650) < 60, "afc %s", r.state.c_str() + p);
}

TEST(p1_cc_cqpsk) {
  std::mt19937 rng(14);
  auto tsbks = ccTsbks(400, rng);
  gen::Tx tx;
  tx.freq = CC;
  tx.bb = gen::dqpsk(ccStream(tsbks, rng), 10);
  tx.freqErr = -420;
  Receiver rx;
  auto r = runCc({tx}, 0.04f, 2, rx);
  CHECK(r.tsbks >= (int)tsbks.size() * 97 / 100, "decoded %d of %zu TSBKs", r.tsbks, tsbks.size());
}

TEST(p1_cc_simulcast_two_paths) {
  // two transmitters of an LSM simulcast, the second 0.3 symbol late at 70 % strength
  std::mt19937 rng(15);
  auto tsbks = ccTsbks(300, rng);
  gen::Tx tx;
  tx.freq = CC;
  tx.bb = gen::dqpsk(ccStream(tsbks, rng), 10);
  tx.amp2 = 0.7f;
  tx.delay2 = 150; // 2.4 MHz samples: 62.5 us
  Receiver rx;
  auto r = runCc({tx}, 0.03f, 3, rx);
  CHECK(r.tsbks >= (int)tsbks.size() * 80 / 100, "decoded %d of %zu TSBKs", r.tsbks, tsbks.size());
}

// Decode rate against SNR in the 12.5 kHz channel, for both modulations: prints a table, and checks the rates
// at 14 dB, where a P25 control channel is solidly usable.
TEST(p1_cc_sensitivity) {
  for (int mod = 0; mod < 2; mod++) {
    for (double snr : {8.0, 10.0, 12.0, 14.0, 17.0}) {
      std::mt19937 rng(16);
      auto tsbks = ccTsbks(200, rng);
      gen::Tx tx;
      tx.freq = CC;
      tx.bb = mod == 0 ? gen::c4fm(ccStream(tsbks, rng)) : gen::dqpsk(ccStream(tsbks, rng), 10);
      tx.amp = 0.05f;
      tx.freqErr = 300;
      // signal power amp^2 against complex noise 2 sigma^2 spread over 2.4 MHz, measured in 12.5 kHz
      const float sigma = (float)std::sqrt(tx.amp * tx.amp / std::pow(10, snr / 10) * 2.4e6 / 12500 / 2);
      Receiver rx;
      auto r = runCc({tx}, sigma, 4, rx);
      const size_t p = r.state.find("\"path\":\"") + 8;
      printf("    %s %4.1f dB: %3d/%zu TSBKs (%s path)\n", mod ? "CQPSK" : "C4FM ", snr, r.tsbks, tsbks.size(),
             r.state.substr(p, r.state.find('"', p) - p).c_str());
      if (snr == 14.0) CHECK(r.tsbks >= (int)tsbks.size() * 90 / 100, "%s at 14 dB: %d", mod ? "CQPSK" : "C4FM", r.tsbks);
    }
  }
}
