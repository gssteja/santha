// A Phase 2 voice channel carrying one call: superframes with MAC_PTT on FACCH, 4V / 2V voice bursts with ESS,
// SACCH MAC_ACTIVE, then MAC_END_PTT; the other logical channel idles.
#pragma once

#include <random>
#include <vector>

#include "p25gen.h"

namespace scene {

using namespace tarang::p25;

constexpr uint32_t WACN = 0xBEE00;
constexpr int SYSID = 0x2D0, NAC = 0x2D0;

struct P2Call {
  int tg = 659, src = 1234567, slot = 1, superframes = 6;
  int algid = 0x80;   // MAC_PTT / ESS algorithm (0x80 = clear)
  int leadIdle = 1;   // idle superframes before the call
  int trailIdle = 1;  // and after
};

struct P2Air {
  gen::Dibits dibits;
  std::vector<std::array<uint8_t, 49>> ambe; // the call's frames in order
};

inline P2Air p2Air(const P2Call& c, std::mt19937& rng) {
  uint8_t mask[2160];
  p2Scrambler(WACN, SYSID, NAC, mask);
  uint8_t ess[44];
  gen::essEncode(c.algid, c.algid == 0x80 ? 0 : 0x42, ess);
  P2Air air;
  const int total = c.leadIdle + c.superframes + c.trailIdle;
  for (int sf = 0; sf < total; sf++) {
    const int callSf = sf - c.leadIdle; // superframe index within the call, < 0 / >= superframes outside it
    for (int slot = 0; slot < 12; slot++) {
      gen::P2Burst b;
      const int ch = slotChannel(slot);
      const bool sacch = slot >= 10;
      const int burst = sacch ? -1 : slot / 2; // 0..3 = 4V, 4 = 2V
      if (ch != c.slot || callSf < 0 || callSf >= c.superframes) {
        b.kind = gen::P2Burst::SACCH;
        gen::macSimple(b.mac, MAC_IDLE);
      } else if (sacch) {
        b.kind = gen::P2Burst::SACCH;
        gen::macSimple(b.mac, MAC_ACTIVE);
        const uint8_t gvcu[7] = {0x01, 0x00, (uint8_t)(c.tg >> 8), (uint8_t)c.tg, (uint8_t)(c.src >> 16), (uint8_t)(c.src >> 8), (uint8_t)c.src};
        std::memcpy(b.mac + 1, gvcu, 7);
      } else if (callSf == 0 && burst < 2) {
        b.kind = gen::P2Burst::FACCH;
        gen::macPtt(b.mac, c.algid, c.src, c.tg);
      } else if (callSf == c.superframes - 1 && burst >= 1) {
        b.kind = gen::P2Burst::FACCH;
        gen::macSimple(b.mac, burst <= 2 ? MAC_END_PTT : MAC_IDLE);
        if (burst <= 2) {
          b.mac[13] = (uint8_t)(c.src >> 16);
          b.mac[14] = (uint8_t)(c.src >> 8);
          b.mac[15] = (uint8_t)c.src;
          b.mac[16] = (uint8_t)(c.tg >> 8);
          b.mac[17] = (uint8_t)c.tg;
        }
      } else {
        b.kind = burst < 4 ? gen::P2Burst::V4 : gen::P2Burst::V2;
        b.essPart = burst < 4 ? burst : 0;
        std::memcpy(b.ess, ess, 44);
        for (int f = 0; f < (burst < 4 ? 4 : 2); f++) {
          for (auto& x : b.ambe[f]) x = rng() & 1;
          air.ambe.push_back(b.ambe[f]);
        }
      }
      const gen::Dibits d = gen::p2Slot(slot, b, mask);
      air.dibits.insert(air.dibits.end(), d.begin(), d.end());
    }
  }
  return air;
}

}  // namespace scene
