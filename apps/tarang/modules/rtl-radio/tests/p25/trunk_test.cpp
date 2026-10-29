// Trunking: the TSBK model and follow decisions on their own, then whole scenarios on simulated air: a control
// channel plus voice channels, the receiver retuning the (simulated) dongle as a real one would.
#include <cstring>
#include <functional>
#include <random>

#include "check.h"
#include "p25.h"
#include "p25gen.h"
#include "p2scene.h"
#include "test_vocoder.h"

using namespace tarang::p25;

namespace {

constexpr int64_t BASE = 851006250;
constexpr int64_t CC = 853262500;
const int CC_CH = 0x1000 | (int)((CC - BASE) / 6250);
constexpr int64_t VOICE_TDMA = 857237500; // outside the dongle's view from the control channel
constexpr int64_t VOICE_FDMA = 852375000; // inside it
inline int tdmaId(int64_t f, int slot) { return 0x2000 | (int)(2 * ((f - BASE) / 6250) + slot); }
inline int fdmaId(int64_t f) { return 0x1000 | (int)((f - BASE) / 6250); }

void feedSystem(Trunk& t, int64_t now) {
  uint8_t b[12];
  for (auto x : {gen::idenUp(1, BASE, 6250), gen::idenUpTdma(2, BASE, 6250), gen::netStatus(scene::WACN, scene::SYSID, CC_CH),
                 gen::rfssStatus(scene::SYSID, 1, 1, CC_CH)}) {
    std::memcpy(b, x.data(), 12);
    t.onTsbk(b, scene::NAC, now);
  }
}

void tsbkTo(Trunk& t, const std::array<uint8_t, 12>& x, int64_t now) {
  uint8_t b[12];
  std::memcpy(b, x.data(), 12);
  t.onTsbk(b, scene::NAC, now);
}

// ---------- simulated air ----------

struct CcEvent {
  double t;
  std::array<uint8_t, 12> tsbk;
};

// Control channel TSDUs back to back; queued TSBKs go out (up to three per TSDU) once their time has come,
// system broadcasts fill the rest.
gen::Dibits ccTimeline(std::vector<CcEvent> ev, double seconds, std::mt19937& rng) {
  std::sort(ev.begin(), ev.end(), [](const CcEvent& a, const CcEvent& b) { return a.t < b.t; });
  gen::Dibits d;
  size_t next = 0;
  int filler = 0;
  while (d.size() < seconds * 4800) {
    const double now = d.size() / 4800.0;
    std::vector<std::array<uint8_t, 12>> blk;
    while (blk.size() < 3 && next < ev.size() && ev[next].t <= now) blk.push_back(ev[next++].tsbk);
    if (blk.empty()) {
      const int n = 1 + rng() % 3;
      for (int i = 0; i < n; i++) {
        switch (filler++ % 4) {
          case 0: blk.push_back(gen::idenUp(1, BASE, 6250)); break;
          case 1: blk.push_back(gen::idenUpTdma(2, BASE, 6250)); break;
          case 2: blk.push_back(gen::netStatus(scene::WACN, scene::SYSID, CC_CH)); break;
          default: blk.push_back(gen::rfssStatus(scene::SYSID, 1, 1, CC_CH)); break;
        }
      }
    }
    const gen::Dibits f = gen::tsdu(scene::NAC, blk);
    d.insert(d.end(), f.begin(), f.end());
  }
  return d;
}

struct Sim {
  gen::Dongle d{9, 0.03f};
  Receiver rx;
  int hwRetunes = 0;
  std::vector<std::pair<double, Mode>> modes; // (time, mode) whenever it changes
  Sim() { d.center = CC - 300000; }
  void run(double seconds, const std::function<void(double)>& each = nullptr) {
    std::vector<uint8_t> buf(2 * 76800);
    while (d.t < seconds * 2.4e6) {
      d.read(buf.data(), 76800);
      const int64_t want = rx.process(buf.data(), 76800, d.center, d.t / 2400);
      const Mode m = rx.trunk().mode();
      if (modes.empty() || modes.back().second != m) modes.push_back({d.t / 2.4e6, m});
      if (each) each(d.t / 2.4e6);
      if (want != d.center) {
        d.center = want;
        hwRetunes++;
        d.read(buf.data(), 24576); // the engine's settle flush
      }
    }
  }
  bool followed() const {
    for (auto& m : modes)
      if (m.second == Mode::VOICE) return true;
    return false;
  }
  double backOnCc() const { // when the receiver last returned to the control channel
    for (size_t i = modes.size(); i-- > 1;)
      if (modes[i].second == Mode::CONTROL && modes[i - 1].second == Mode::VOICE) return modes[i].first;
    return -1;
  }
};

gen::Tx ccTx(gen::Dibits d) {
  gen::Tx tx;
  tx.freq = CC;
  tx.bb = gen::c4fm(d);
  tx.freqErr = 520;
  return tx;
}

gen::Tx p2Tx(const scene::P2Air& air, double start) {
  gen::Tx tx;
  tx.freq = VOICE_TDMA;
  tx.bb = gen::dqpsk(air.dibits, 8);
  tx.start = (int64_t)(start * FS);
  tx.freqErr = 520 * VOICE_TDMA / (double)CC;
  return tx;
}

std::vector<CcEvent> grants(double from, double to, int opts, int ch, int tg, int src) {
  std::vector<CcEvent> e = {{from, gen::grant(opts, ch, tg, src)}};
  for (double t = from + 0.4; t < to; t += 0.4) e.push_back({t, gen::grantUpdate(ch, tg, ch, tg)});
  return e;
}

}  // namespace

TEST(trunk_system_model_and_decisions) {
  Trunk t;
  t.setControlChannels({CC});
  feedSystem(t, 1000);
  t.tick(1000, true);
  CHECK(t.mode() == Mode::CONTROL, "mode");
  CHECK(t.wacn() == scene::WACN && t.sysid() == scene::SYSID && t.nac() == scene::NAC, "system");
  CHECK(t.channelFor(CC_CH).freq == CC && !t.channelFor(CC_CH).tdma, "fdma channel");
  const Channel v = t.channelFor(tdmaId(VOICE_TDMA, 1));
  CHECK(v.freq == VOICE_TDMA && v.tdma && v.slot == 1, "tdma channel %lld slot %d", (long long)v.freq, v.slot);

  // a clear grant is followed; the call ends after the hang time
  tsbkTo(t, gen::grant(0x00, tdmaId(VOICE_TDMA, 1), 659, 1234567), 1100);
  t.tick(1100, true);
  CHECK(t.mode() == Mode::VOICE && t.target().freq == VOICE_TDMA && t.target().slot == 1, "follows");
  CHECK(!t.callClear() && !t.callEncrypted(), "not clear until the voice channel says so");
  t.onAlgid(0x80, 1150);
  CHECK(t.callClear(), "clear from the voice channel's algorithm ID");
  for (int k = 0; k < 10; k++) t.onVoiceFrame(1200 + 20 * k);
  t.onCallEnd(1500);
  t.tick(1600, true);
  CHECK(t.mode() == Mode::VOICE, "hang time");
  t.tick(2600, true);
  CHECK(t.mode() == Mode::CONTROL && t.target().freq == CC, "back on the control channel");

  // encrypted (service options P bit): shown, never followed
  tsbkTo(t, gen::grant(0x40, tdmaId(VOICE_TDMA, 0), 815, 222), 3000);
  t.tick(3000, true);
  CHECK(t.mode() == Mode::CONTROL, "encrypted not followed");
  CHECK(t.talkgroups().at(815).enc == 1, "marked encrypted");

  // lockout, then a favorite beating a normal talkgroup in the same batch
  std::unordered_map<int, int> flags = {{559, TG_LOCKOUT}, {1027, TG_FAVORITE}};
  t.setFlags(flags);
  tsbkTo(t, gen::grant(0, tdmaId(VOICE_TDMA, 0), 559, 1), 4000);
  t.tick(4000, true);
  CHECK(t.mode() == Mode::CONTROL, "locked out");
  tsbkTo(t, gen::grant(0, tdmaId(VOICE_TDMA, 0), 659, 1), 4100);
  tsbkTo(t, gen::grant(0, tdmaId(VOICE_TDMA, 1), 1027, 2), 4100);
  t.tick(4100, true);
  CHECK(t.mode() == Mode::VOICE && t.call().tg == 1027, "favorite first (%d)", t.call().tg);

  // skip: the talkgroup stays skipped while its grant updates keep coming, and is followed again later
  t.skipCall(4200);
  CHECK(t.mode() == Mode::CONTROL, "skipped");
  tsbkTo(t, gen::grantUpdate(tdmaId(VOICE_TDMA, 1), 1027, tdmaId(VOICE_TDMA, 1), 1027), 5000);
  t.tick(5000, true);
  CHECK(t.mode() == Mode::CONTROL, "still skipped");
  tsbkTo(t, gen::grant(0, tdmaId(VOICE_TDMA, 1), 1027, 2), 9000);
  t.tick(9000, true);
  CHECK(t.mode() == Mode::VOICE, "followed again after the skipped call ended");
  t.onAlgid(0x84, 9100); // the voice channel says AES
  t.tick(9100, true);
  CHECK(t.mode() == Mode::CONTROL && t.talkgroups().at(1027).enc == 1, "left an encrypted call");
  tsbkTo(t, gen::grant(0, tdmaId(VOICE_TDMA, 1), 1027, 2), 9500);
  t.tick(9500, true);
  CHECK(t.mode() == Mode::CONTROL, "found-encrypted talkgroup not followed again");

  // hold: only that talkgroup
  t.setHold(453);
  tsbkTo(t, gen::grant(0, tdmaId(VOICE_TDMA, 0), 659, 1), 10000);
  t.tick(10000, true);
  CHECK(t.mode() == Mode::CONTROL, "hold ignores others");
  tsbkTo(t, gen::grant(0, tdmaId(VOICE_TDMA, 0), 453, 1), 10100);
  t.tick(10100, true);
  CHECK(t.mode() == Mode::VOICE && t.call().tg == 453, "hold follows its talkgroup");

  // Motorola patch: supergroup 30000 = {1027, 1029}
  tsbkTo(t, gen::tsbk(0x00, 0x90, {0x75, 0x30, 0x04, 0x03, 0x04, 0x05, 0, 0}), 11000);
  const std::string js = t.stateJson(11000);
  CHECK(js.find("{\"sg\":30000,\"tgs\":[1027,1029]}") != std::string::npos, "patch %s", js.c_str());

  // TDMA needs the WACN / system ID (from network status) to descramble: not followed before
  Trunk fresh;
  fresh.setControlChannels({CC});
  tsbkTo(fresh, gen::idenUpTdma(2, BASE, 6250), 100);
  tsbkTo(fresh, gen::grant(0, tdmaId(VOICE_TDMA, 0), 659, 1), 100);
  fresh.tick(100, true);
  CHECK(fresh.mode() != Mode::VOICE, "no scrambler, no follow");
}

TEST(trunk_follows_tdma_call_with_retune) {
  std::mt19937 rng(31);
  scene::P2Call call;
  call.tg = 659;
  call.src = 1234567;
  call.slot = 1;
  call.superframes = 10; // 3.6 s of voice
  const scene::P2Air air = scene::p2Air(call, rng);
  const double vStart = 1.0, vEnd = vStart + air.dibits.size() / 6000.0;
  Sim sim;
  sim.d.txs = {ccTx(ccTimeline(grants(0.95, vEnd - 0.5, 0x00, tdmaId(VOICE_TDMA, 1), 659, 1234567), vEnd + 2, rng)), p2Tx(air, vStart)};
  sim.rx.setControlChannels({CC});
  g_vocFrames.clear();
  int audible = 0;
  std::vector<float> audio(2 * 1536);
  sim.run(vEnd + 2, [&](double) {
    if (sim.rx.render(audio.data(), 1536)) audible++;
  });
  CHECK(sim.followed(), "followed the grant");
  CHECK(sim.hwRetunes >= 2, "retuned the dongle there and back (%d)", sim.hwRetunes);
  const size_t got = g_vocFrames.size(), sent = air.ambe.size();
  int exact = 0;
  for (size_t i = 0; i < got && got <= sent; i++) exact += !std::memcmp(g_vocFrames[i].bits, air.ambe[sent - got + i].data(), 49);
  CHECK(got <= sent && got * 100 >= sent * 85, "vocoded %zu of %zu frames", got, sent);
  CHECK(exact >= (int)got * 98 / 100, "%d of %zu exact", exact, got);
  CHECK(audible > 50, "audio blocks %d", audible);
  const double back = sim.backOnCc();
  CHECK(back > vEnd - 0.5 && back < vEnd + 1.6, "back on the control channel at %.2f s (voice ended %.2f s)", back, vEnd);
  const std::string st = sim.rx.state(sim.d.t / 2400);
  CHECK(st.find("\"log\":[{\"tg\":659,\"src\":1234567") != std::string::npos, "call log %s", st.substr(st.find("\"log\""), 160).c_str());
  for (auto& m : sim.modes)
    if (m.second == Mode::VOICE) {
      printf("    on the voice channel %.0f ms after the grant was sent\n", (m.first - 0.95) * 1000);
      break;
    }
}

TEST(trunk_encrypted_grant_never_tuned) {
  std::mt19937 rng(32);
  scene::P2Call call;
  call.tg = 815;
  call.algid = 0x84;
  call.superframes = 6;
  const scene::P2Air air = scene::p2Air(call, rng);
  Sim sim;
  sim.d.txs = {ccTx(ccTimeline(grants(0.95, 3, 0x40, tdmaId(VOICE_TDMA, 1), 815, 99), 4, rng)), p2Tx(air, 1.0)};
  sim.rx.setControlChannels({CC});
  g_vocFrames.clear();
  sim.run(4);
  CHECK(!sim.followed() && g_vocFrames.empty(), "followed %d, vocoded %zu", sim.followed(), g_vocFrames.size());
  CHECK(sim.rx.trunk().talkgroups().count(815) && sim.rx.trunk().talkgroups().at(815).enc == 1, "shown as encrypted");
}

TEST(trunk_encrypted_voice_channel_never_vocoded) {
  // the grant claims clear, the voice channel's MAC_PTT / ESS say AES: not one frame may reach the vocoder
  std::mt19937 rng(33);
  scene::P2Call call;
  call.tg = 30539;
  call.algid = 0x84;
  call.superframes = 8;
  call.leadIdle = 0;
  const scene::P2Air air = scene::p2Air(call, rng);
  Sim sim;
  // grant updates only (no service options): the receiver can't know it's encrypted until the voice channel says
  sim.d.txs = {p2Tx(air, 1.0)};
  sim.d.txs.insert(sim.d.txs.begin(), ccTx(ccTimeline({{0.95, gen::grantUpdate(tdmaId(VOICE_TDMA, 1), 30539, tdmaId(VOICE_TDMA, 1), 30539)},
                                  {1.6, gen::grantUpdate(tdmaId(VOICE_TDMA, 1), 30539, tdmaId(VOICE_TDMA, 1), 30539)}},
                                 5, rng)));
  sim.rx.setControlChannels({CC});
  g_vocFrames.clear();
  sim.run(5);
  CHECK(sim.followed(), "went to look");
  CHECK(g_vocFrames.empty(), "vocoded %zu frames of an encrypted call", g_vocFrames.size());
  CHECK(sim.rx.trunk().talkgroups().at(30539).enc == 1, "marked encrypted");
  const std::string st = sim.rx.state(sim.d.t / 2400);
  CHECK(st.find("\"end\":\"encrypted\"") != std::string::npos, "log says encrypted: %s", st.substr(st.find("\"log\""), 200).c_str());
}

TEST(trunk_fdma_call_inside_the_view) {
  // a Phase 1 call on a channel the dongle already sees: no hardware retune, IMBE frames from LDU1 / LDU2
  std::mt19937 rng(34);
  gen::Dibits v;
  std::vector<std::array<uint8_t, 88>> sent;
  const uint8_t lc[9] = {0x00, 0x00, 0x00, 0x00, 0x01, 0xC5, 0x0A, 0x0B, 0x0C}; // group 453 from 0x0A0B0C
  const uint8_t ess[12] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0x80, 0, 0};
  auto add = [&](const gen::Dibits& x) { v.insert(v.end(), x.begin(), x.end()); };
  add(gen::hdu(scene::NAC, 0x80, 0, 453));
  for (int k = 0; k < 12; k++) {
    std::vector<std::array<uint8_t, 88>> f(9);
    for (auto& a : f)
      for (auto& b : a) b = rng() & 1;
    sent.insert(sent.end(), f.begin(), f.end());
    add(gen::ldu(scene::NAC, k % 2 ? LDU2 : LDU1, f, k % 2 ? ess : lc));
  }
  add(gen::tdu(scene::NAC));
  add(gen::tdu(scene::NAC));
  gen::Tx voice;
  voice.freq = VOICE_FDMA;
  voice.bb = gen::c4fm(v);
  voice.start = (int64_t)(1.0 * FS);
  voice.freqErr = 520;
  const double vEnd = 1.0 + v.size() / 4800.0;
  Sim sim;
  sim.d.txs = {ccTx(ccTimeline(grants(0.95, vEnd - 0.3, 0x00, fdmaId(VOICE_FDMA), 453, 0x0A0B0C), vEnd + 2, rng)), voice};
  sim.rx.setControlChannels({CC});
  g_vocFrames.clear();
  sim.run(vEnd + 2);
  CHECK(sim.followed(), "followed");
  CHECK(sim.hwRetunes == 0, "no hardware retune (%d)", sim.hwRetunes);
  const size_t got = g_vocFrames.size();
  int exact = 0;
  for (size_t i = 0; i < got && got <= sent.size(); i++) exact += !std::memcmp(g_vocFrames[i].bits, sent[sent.size() - got + i].data(), 88);
  CHECK(got <= sent.size() && got * 100 >= sent.size() * 80, "vocoded %zu of %zu", got, sent.size());
  CHECK(exact >= (int)got * 98 / 100, "%d exact of %zu", exact, got);
  const std::string st = sim.rx.state(sim.d.t / 2400);
  CHECK(st.find("\"tg\":453,\"src\":658188") != std::string::npos, "source from the link control: %s", st.substr(st.find("\"log\""), 160).c_str());
}

TEST(trunk_hunts_for_the_control_channel) {
  std::mt19937 rng(35);
  Sim sim;
  sim.d.txs = {ccTx(ccTimeline({}, 6, rng))};
  sim.d.center = 851500000 - 300000;
  sim.rx.setControlChannels({851500000, 852000000, CC});
  double locked = -1;
  sim.run(6, [&](double t) {
    if (locked < 0 && sim.rx.trunk().mode() == Mode::CONTROL && sim.rx.trunk().controlFreq() == CC) locked = t;
  });
  CHECK(locked > 0 && locked < 4.5, "locked onto the third candidate at %.2f s", locked);
}
