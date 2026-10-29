#pragma once
#include <cstdint>
#include <vector>

struct VocFrame {
  bool imbe;
  int errs;
  uint8_t bits[88];
};
extern std::vector<VocFrame> g_vocFrames;
