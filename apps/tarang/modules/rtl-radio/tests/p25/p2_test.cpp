// Phase 2: AMBE+2 frame FEC, the TDMA framer on ideal symbols (superframe position, descrambling, voice,
// ESS, FACCH / SACCH MAC PDUs), and an H-DQPSK carrier through the channelizer and detector.
#include <cstring>
#include <random>

#include "check.h"
#include "p25.h"
#include "p25gen.h"
#include "p2scene.h"

using namespace tarang::p25;

namespace {

struct Collector : P2Listener {
  std::vector<std::array<uint8_t, 49>> ambe[2];
  std::vector<std::vector<uint8_t>> macs[2];
  std::vector<int> algids;
  void onMac(int ch, const uint8_t* pdu, int len) override { macs[ch].push_back(std::vector<uint8_t>(pdu, pdu + len)); }
  void onAmbe(int ch, const uint8_t b[49], int) override {
    std::array<uint8_t, 49> a;
    std::memcpy(a.data(), b, 49);
    ambe[ch].push_back(a);
  }
  void onP2Ess(int, int algid, int) override { algids.push_back(algid); }
};

}  // namespace

TEST(p2_ambe_fec_roundtrip) {
  std::mt19937 rng(21);
  int ok = 0;
  for (int t = 0; t < 2000; t++) {
    uint8_t u[49], vf[72], out[49];
    for (auto& b : u) b = rng() & 1;
    ambeEncode(u, vf);
    // up to 3 errors in each Golay word: c0 is spread over vf positions 4k+0 (k < 18) and 4k+1 (k < 6)
    int e0 = rng() % 4, e1 = rng() % 4;
    std::vector<int> pos0, pos1;
    for (int k = 0; k < 18; k++) pos0.push_back(4 * k);
    for (int k = 0; k < 6; k++) pos0.push_back(4 * k + 1);
    for (int k = 6; k < 18; k++) pos1.push_back(4 * k + 1);
    for (int k = 0; k < 11; k++) pos1.push_back(4 * k + 2);
    std::shuffle(pos0.begin(), pos0.end(), rng);
    std::shuffle(pos1.begin(), pos1.end(), rng);
    for (int i = 0; i < e0; i++) vf[pos0[i]] ^= 1;
    for (int i = 0; i < e1; i++) vf[pos1[i]] ^= 1;
    const int errs = ambeDecode(vf, out);
    if (!std::memcmp(out, u, 49) && errs == e0 + e1) ok++;
  }
  CHECK(ok == 2000, "%d/2000", ok);
}

TEST(p2_framer_ideal_symbols) {
  std::mt19937 rng(22);
  scene::P2Call call;
  call.tg = 659;
  call.src = 1234567;
  call.slot = 1;
  call.superframes = 6;
  scene::P2Air air = scene::p2Air(call, rng);
  Collector col;
  P2Framer f(&col);
  f.setScrambler(scene::WACN, scene::SYSID, scene::NAC);
  f.setChannel(1);
  std::vector<float> v;
  for (uint8_t x : air.dibits)
    for (int k = 0; k < 8; k++) v.push_back(LEVELS[x]);
  f.process(v.data(), (int)v.size());
  // the framer needs the first slots to find the superframe position: allow the first superframe to be missed
  const size_t sent = air.ambe.size();
  size_t got = col.ambe[1].size();
  CHECK(got + 18 >= sent && got <= sent, "ambe frames %zu of %zu", got, sent);
  bool same = got > 0;
  for (size_t i = 0; same && i < got; i++) same = col.ambe[1][i] == air.ambe[sent - got + i];
  CHECK(same, "ambe contents");
  CHECK(col.ambe[0].empty(), "nothing decoded for channel 0 (%zu)", col.ambe[0].size());
  int ptt = 0, end = 0, active = 0, idle = 0;
  for (auto& m : col.macs[1]) {
    const int op = m[0] >> 5;
    if (op == MAC_PTT && m[10] == 0x80 && (m[16] << 8 | m[17]) == 659 && (m[13] << 16 | m[14] << 8 | m[15]) == 1234567) ptt++;
    if (op == MAC_END_PTT) end++;
    if (op == MAC_ACTIVE && m[1] == 0x01 && (m[3] << 8 | m[4]) == 659) active++;
  }
  for (auto& m : col.macs[0])
    if ((m[0] >> 5) == MAC_IDLE) idle++;
  CHECK(ptt >= 1, "MAC_PTT %d", ptt);
  CHECK(end >= 1, "MAC_END_PTT %d", end);
  CHECK(active >= 3, "MAC_ACTIVE with the talkgroup %d", active);
  CHECK(idle >= 3, "channel 0 idle %d", idle);
  CHECK(!col.algids.empty() && col.algids.back() == 0x80, "ESS algid (%zu)", col.algids.size());
  CHECK(f.macFails() == 0, "mac failures %u", f.macFails());
}

TEST(p2_hdqpsk_through_channelizer) {
  std::mt19937 rng(23);
  scene::P2Call call;
  call.tg = 659;
  call.src = 7654321;
  call.slot = 0;
  call.superframes = 8;
  scene::P2Air air = scene::p2Air(call, rng);
  gen::Tx tx;
  tx.freq = 857237500;
  tx.bb = gen::dqpsk(air.dibits, 8);
  tx.amp = 0.25f;
  gen::Dongle d(5, 0.08f);
  d.txs = {tx};
  d.center = tx.freq - 400000;
  Channelizer ch;
  ch.setOffset(tx.freq - d.center);
  DiffDetector det;
  det.init(8, true);
  Collector col;
  P2Framer f(&col);
  f.setScrambler(scene::WACN, scene::SYSID, scene::NAC);
  f.setChannel(0);
  std::vector<uint8_t> buf(2 * 76800);
  std::vector<float> bi(4096), bq(4096), sv(4096);
  while (d.t < (int64_t)tx.bb.size() * 50 + 76800) {
    d.read(buf.data(), 76800);
    const int m = ch.process(buf.data(), 76800, bi.data(), bq.data());
    det.process(bi.data(), bq.data(), m, sv.data());
    f.process(sv.data(), m);
  }
  const size_t sent = air.ambe.size(), got = col.ambe[0].size();
  int match = 0;
  for (size_t i = 0; i < got && got <= sent; i++) match += col.ambe[0][i] == air.ambe[sent - got + i];
  CHECK(got <= sent && got + 18 >= sent && match >= (int)got * 98 / 100, "ambe %zu of %zu, %d exact", got, sent, match);
  CHECK(f.macFails() <= 1, "mac failures %u of %u", f.macFails(), f.macs() + f.macFails());
}

TEST(p2_noise_after_the_call_decodes_nothing) {
  // the framer keeps running after the carrier drops; plain noise must never come out as voice or MAC PDUs
  std::mt19937 rng(24);
  scene::P2Call call;
  call.slot = 0;
  call.superframes = 2;
  scene::P2Air air = scene::p2Air(call, rng);
  Collector col;
  P2Framer f(&col);
  f.setScrambler(scene::WACN, scene::SYSID, scene::NAC);
  f.setChannel(0);
  std::vector<float> v;
  for (uint8_t x : air.dibits)
    for (int k = 0; k < 8; k++) v.push_back(LEVELS[x]);
  std::uniform_real_distribution<float> u(-4, 4);
  for (int i = 0; i < 48000 * 20; i++) v.push_back(u(rng)); // 20 s of noise
  f.process(v.data(), (int)v.size());
  CHECK(col.ambe[0].size() == air.ambe.size() || col.ambe[0].size() + 18 >= air.ambe.size(), "call frames %zu", col.ambe[0].size());
  CHECK(col.ambe[0].size() <= air.ambe.size() && col.ambe[1].empty(), "voice from noise: %zu + %zu", col.ambe[0].size() - air.ambe.size(),
        col.ambe[1].size());
}
