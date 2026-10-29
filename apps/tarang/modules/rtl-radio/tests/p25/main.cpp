#include <chrono>
#include <cstring>
#include <string>

#include "check.h"

int g_fails = 0;
int g_checks = 0;

static std::vector<std::pair<const char*, std::function<void()>>>& tests() {
  static std::vector<std::pair<const char*, std::function<void()>>> t;
  return t;
}

TestReg::TestReg(const char* name, std::function<void()> fn) { tests().push_back({name, fn}); }

int main(int argc, char** argv) {
  const char* only = argc > 1 ? argv[1] : nullptr;
  for (auto& t : tests()) {
    if (only && !strstr(t.first, only)) continue;
    const int before = g_fails;
    const auto t0 = std::chrono::steady_clock::now();
    t.second();
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    printf("%-34s %s  (%.0f ms)\n", t.first, g_fails == before ? "ok" : "FAILED", ms);
  }
  printf("\n%d checks, %d failed\n", g_checks, g_fails);
  return g_fails ? 1 : 0;
}
