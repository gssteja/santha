// Runs the P25 receiver on a recording (rtl_sdr CU8 at 2.4 MS/s) and reports what it decoded: the system it
// found on the control channel, grants, calls followed (on channels inside the recording's 2.4 MHz) and the
// vocoder frames' FEC error rate, which is near zero when deinterleaving and descrambling are right.
//   rtl_sdr -f 853200000 -s 2400000 -g 40 -n 144000000 cc.cu8
//   ./decode_file.sh cc.cu8 853200000 853262500 [more control channels]
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "p25.h"
#include "test_vocoder.h"

using namespace tarang::p25;

int main(int argc, char** argv) {
  if (argc < 4) {
    fprintf(stderr, "usage: %s file.cu8 centerHz controlChannelHz...\n", argv[0]);
    return 2;
  }
  FILE* f = fopen(argv[1], "rb");
  if (!f) {
    perror(argv[1]);
    return 1;
  }
  const int64_t center = atoll(argv[2]);
  std::vector<int64_t> ccs;
  for (int i = 3; i < argc; i++) ccs.push_back(atoll(argv[i]));
  Receiver rx;
  rx.setControlChannels(ccs);
  constexpr int N = 76800;
  std::vector<uint8_t> buf(2 * N);
  std::vector<float> audio(2 * (N / 50));
  int64_t samples = 0, lastPrint = -1;
  size_t lastFrames = 0;
  while (fread(buf.data(), 2, N, f) == (size_t)N) {
    samples += N;
    const int64_t now = samples / 2400;
    const int64_t want = rx.process(buf.data(), N, center, now);
    rx.render(audio.data(), N / 50);
    if (want != center && now / 1000 != lastPrint) printf("  (%lld ms: the receiver wants %.4f MHz, outside the recording)\n", (long long)now, want / 1e6);
    if (now / 1000 != lastPrint) {
      lastPrint = now / 1000;
      const std::string st = rx.state(now);
      const size_t r = st.find("\"rx\"");
      printf("%3lld s  mode %-8s vocoder frames %zu (+%zu)  %s\n", (long long)lastPrint,
             st.substr(st.find("\"mode\":") + 8, st.find('"', st.find("\"mode\":") + 8) - st.find("\"mode\":") - 8).c_str(), g_vocFrames.size(),
             g_vocFrames.size() - lastFrames, st.substr(r, 160).c_str());
      lastFrames = g_vocFrames.size();
    }
  }
  fclose(f);
  const Trunk& t = rx.trunk();
  printf("\nsystem: WACN %05X, system %03X, NAC %03X, %u grants\n", t.wacn(), t.sysid(), t.nac(), t.grants());
  int imbe = 0, ambe = 0;
  double ie = 0, ae = 0;
  for (auto& v : g_vocFrames) {
    if (v.imbe) imbe++, ie += v.errs;
    else ambe++, ae += v.errs;
  }
  printf("IMBE frames %d (FEC corrections per frame %.2f), AMBE frames %d (%.2f per frame)\n", imbe, imbe ? ie / imbe : 0.0, ambe,
         ambe ? ae / ambe : 0.0);
  printf("\n%s\n", rx.state(samples / 2400).c_str());
  return 0;
}
