// Tiny test harness: CHECK() counts failures and prints them; each test file registers its tests.
#pragma once

#include <cstdio>
#include <functional>
#include <vector>

extern int g_fails;
extern int g_checks;
#define CHECK(c, ...)                         \
  do {                                        \
    g_checks++;                               \
    if (!(c)) {                               \
      g_fails++;                              \
      printf("  FAIL %s:%d %s: ", __FILE__, __LINE__, #c); \
      printf(__VA_ARGS__);                    \
      printf("\n");                           \
    }                                         \
  } while (0)

struct TestReg {
  TestReg(const char* name, std::function<void()> fn);
};
#define TEST(name)                         \
  static void name();                      \
  static TestReg reg_##name(#name, name);  \
  static void name()
