#include "p25.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "filters.h"

namespace tarang {
namespace p25 {

namespace {
constexpr int FIFO = FS * 4;              // 4 s of 48 kHz call audio
constexpr int START_SAMPLES = FS * 3 / 20; // 150 ms jitter cushion before a call starts playing
constexpr int64_t DC_GUARD = 20000, HALF_VIEW = 1000000;

inline bool fits(int64_t off) { return std::llabs(off) >= DC_GUARD && std::llabs(off) + 8000 <= HALF_VIEW; }
inline int64_t snap(int64_t hz) { return (hz + 3125) / 6250 * 6250; }
}  // namespace

Receiver::Receiver() : p2_(this) {
  wide_.init(10, false);
  rrc_.init(10, true);
  rrc6_.init(8, true);
  for (int k = 0; k < 2; k++) {
    paths_[k].rx = this;
    paths_[k].idx = k;
    p1_[k].setListener(&paths_[k]);
  }
  bi_.resize(8192);
  bq_.resize(8192);
  sa_.resize(8192);
  sb_.resize(8192);
  // 8 kHz -> 48 kHz: low-pass at 3.7 kHz, taps padded to a multiple of 6, gain 6 for the zero stuffing
  std::vector<float> h = lowpass(3700, FS, 60, 800);
  while (h.size() % 6) h.push_back(0);
  for (auto& x : h) x *= 6;
  up_ = h;
  fifo_.assign(FIFO, 0.f);
}

void Receiver::setOptions(bool favoritesOnly, int hangMs, bool muted) {
  trunk_.setFollowFavoritesOnly(favoritesOnly);
  trunk_.setHangMs(hangMs);
  trunk_.setMuted(muted);
}

void Receiver::setSystem(uint32_t wacn, int sysid, int nac) {
  sysWacn_ = wacn;
  sysId_ = sysid;
  sysNac_ = nac;
  trunk_.setKnownSystem(wacn, sysid, nac);
}

int64_t Receiver::chooseCenter(int64_t f) const {
  const int64_t cc = trunk_.controlFreq();
  if (cc && f != cc && std::llabs(f - cc) <= 1700000) { // keep the control channel in view too: coming back is then instant
    int64_t c = snap((f + cc) / 2);
    if (std::llabs(f - c) < 30000 || std::llabs(cc - c) < 30000) c += 50000;
    if (fits(f - c) && fits(cc - c)) return c;
  }
  return snap(f - 250000);
}

void Receiver::reconfigure(const Channel& t, int64_t hw) {
  const bool sameChannel = curValid_ && t.freq == cur_.freq && t.tdma == cur_.tdma;
  chan_.setOffset(t.freq - hw);
  if (!sameChannel || hw != curHw_) {
    chan_.reset();
    wide_.reset();
    rrc_.reset();
    rrc6_.reset();
    for (auto& p : p1_) p.reset();
    for (auto& r : recent_) r.pos = -1e18;
    p2_.reset();
    retunes_++;
  }
  const int nac = trunk_.mode() == Mode::HUNT ? -1 : trunk_.nac();
  for (auto& p : p1_) p.setNac(nac);
  if (t.tdma) {
    const uint32_t wacn = trunk_.wacn() ? trunk_.wacn() : sysWacn_;
    const int sysid = trunk_.sysid() >= 0 ? trunk_.sysid() : sysId_;
    const int cnac = trunk_.nac() >= 0 ? trunk_.nac() : sysNac_;
    if (wacn && sysid >= 0 && cnac >= 0) p2_.setScrambler(wacn, (uint32_t)sysid, (uint32_t)cnac);
    p2_.setChannel(t.slot);
  }
  cur_ = t;
  curHw_ = hw;
  curValid_ = true;
}

int64_t Receiver::process(const uint8_t* iq, int n, int64_t hw, int64_t nowMs) {
  now_ = nowMs;
  const Channel t = trunk_.target();
  if (!t.freq) {
    trunk_.tick(nowMs, false);
    return want_ = hw;
  }
  if (!fits(t.freq - hw)) { // wait for the dongle to move
    want_ = chooseCenter(t.freq);
    curValid_ = false;
    trunk_.tick(nowMs, false);
    return want_;
  }
  want_ = hw;
  if (!curValid_ || t.freq != cur_.freq || t.tdma != cur_.tdma || t.slot != cur_.slot || hw != curHw_) reconfigure(t, hw);
  chan_.setFine(fine_);
  const int m = chan_.process(iq, n, bi_.data(), bq_.data());
  int syncs = 0;
  double fe = 0;
  DiffDetector& coarseDet = t.tdma ? rrc6_ : wide_;
  if (!t.tdma) {
    wide_.process(bi_.data(), bq_.data(), m, sa_.data());
    rrc_.process(bi_.data(), bq_.data(), m, sb_.data());
    p1_[0].process(sa_.data(), m);
    p1_[1].process(sb_.data(), m);
    fe = p1_[primary_].takeFreqError(&syncs);
    p1_[1 - primary_].takeFreqError(nullptr);
    if (nowMs - evalAt_ >= 1000) evaluatePaths();
  } else {
    rrc6_.process(bi_.data(), bq_.data(), m, sb_.data());
    p2_.process(sb_.data(), m);
    fe = p2_.takeFreqError(&syncs);
  }
  // AFC: from the frame syncs when there are any, else from the mean instantaneous frequency
  const double meanHz = coarseDet.takeMeanHz();
  if (syncs) {
    fine_ += 0.5 * fe;
    lastSyncMs_ = nowMs;
  } else if (nowMs - lastSyncMs_ > 300 && std::fabs(meanHz) > 100) {
    // no frame syncs: an offset past ~300 Hz wraps the outer symbols round, so pull in from the mean frequency
    fine_ += 0.4 * meanHz;
  }
  if (fine_ > 4000) fine_ = 4000;
  if (fine_ < -4000) fine_ = -4000;

  const bool wasClear = trunk_.callClear();
  trunk_.tick(nowMs, syncs > 0);
  if (trunk_.mode() == Mode::VOICE) {
    if (trunk_.callEncrypted()) {
      pending_.clear();
      if (wasClear) fifoLen_ = 0; // believed clear, turned out not to be: drop what was vocoded
    } else if (trunk_.callClear() && !pending_.empty()) {
      for (auto& f : pending_) vocode(f);
      pending_.clear();
    }
  } else {
    pending_.clear();
  }
  const Channel nt = trunk_.target();
  if (nt.freq && !fits(nt.freq - hw)) want_ = chooseCenter(nt.freq);
  return want_;
}

void Receiver::evaluatePaths() {
  // the path that framed more of the last second's frames, or as many with clearly cleaner syncs
  evalAt_ = now_;
  uint32_t d[2];
  for (int k = 0; k < 2; k++) {
    d[k] = p1_[k].frames() - lastFrames_[k];
    lastFrames_[k] = p1_[k].frames();
  }
  const int sec = 1 - primary_;
  if (d[sec] > d[primary_] || (d[sec] == d[primary_] && d[sec] > 0 && p1_[sec].quality() < 0.7f * p1_[primary_].quality())) primary_ = sec;
}

// The two paths' callbacks: TSBKs from either (once), everything else from the primary path.
void Receiver::Path::onNid(int nac, int duid, int errs) {
  if (idx == rx->primary_) rx->onNid(nac, duid, errs);
}
void Receiver::Path::onTsbk(int nac, const uint8_t t[12]) {
  const P1Framer& f = rx->p1_[idx];
  const double pos = f.frameStart() - (idx ? rx->rrc_.delay() : rx->wide_.delay());
  for (auto& r : rx->recent_)
    if (std::fabs(r.pos - pos) < 10 && r.block == f.block() && !std::memcmp(r.b, t, 10)) return; // the other path had it
  RecentTsbk& r = rx->recent_[rx->recentIdx_++ % 8];
  r.pos = pos;
  r.block = f.block();
  std::memcpy(r.b, t, 10);
  rx->tsbksIn_++;
  rx->onTsbk(nac, t);
}
void Receiver::Path::onHeader(int nac, int algid, int kid, int tgid) {
  if (idx == rx->primary_) rx->onHeader(nac, algid, kid, tgid);
}
void Receiver::Path::onLinkControl(int nac, const uint8_t lc[9]) {
  if (idx == rx->primary_) rx->onLinkControl(nac, lc);
}
void Receiver::Path::onEncryptionSync(int nac, int algid, int kid) {
  if (idx == rx->primary_) rx->onEncryptionSync(nac, algid, kid);
}
void Receiver::Path::onTerminator(int nac) {
  if (idx == rx->primary_) rx->onTerminator(nac);
}
void Receiver::Path::onImbe(const uint8_t bits[88], int errs) {
  if (idx == rx->primary_) rx->onImbe(bits, errs);
}

// ---------- Phase 1 ----------

void Receiver::onNid(int, int duid, int) {
  if (trunk_.mode() == Mode::VOICE && duid != TSDU) trunk_.onVoiceSignal(now_);
}

void Receiver::onTsbk(int nac, const uint8_t b[12]) {
  if (trunk_.mode() != Mode::VOICE) trunk_.onTsbk(b, nac, now_);
}

void Receiver::onHeader(int, int algid, int, int tgid) {
  trunk_.onCallInfo(tgid, -1, -1, now_);
  trunk_.onAlgid(algid, now_);
}

void Receiver::onLinkControl(int, const uint8_t lc[9]) {
  const int lco = lc[0] & 0x3f;
  if (lco == 0x00) trunk_.onCallInfo(lc[4] << 8 | lc[5], lc[6] << 16 | lc[7] << 8 | lc[8], lc[2], now_);
  else if (lco == 0x0f) trunk_.onCallEnd(now_);
}

void Receiver::onEncryptionSync(int, int algid, int) { trunk_.onAlgid(algid, now_); }

void Receiver::onTerminator(int) { trunk_.onCallEnd(now_); }

void Receiver::onImbe(const uint8_t bits[88], int errs) { voiceFrame(true, bits, 88, errs); }

// ---------- Phase 2 ----------

void Receiver::onP2Slot(int, int, int) {
  if (trunk_.mode() == Mode::VOICE) trunk_.onVoiceSignal(now_);
}

void Receiver::onMac(int channel, const uint8_t* pdu, int len) {
  const bool ours = channel == cur_.slot;
  const int op = pdu[0] >> 5;
  if (ours) {
    switch (op) {
      case MAC_PTT:
        trunk_.onCallInfo(pdu[16] << 8 | pdu[17], pdu[13] << 16 | pdu[14] << 8 | pdu[15], -1, now_);
        trunk_.onAlgid(pdu[10], now_);
        return;
      case MAC_END_PTT: trunk_.onCallEnd(now_); return;
      case MAC_IDLE:
      case MAC_HANGTIME: trunk_.onCallEnd(now_); break;
    }
  }
  if (op == MAC_ACTIVE || op == MAC_IDLE || op == MAC_HANGTIME || op == MAC_SIGNAL) {
    for (int p = 1; p < len;) {
      const int ml = macMessageLength(pdu + p, len - p);
      if (ml <= 0) break;
      const int use = ml < len - p ? ml : len - p;
      // another channel's "user" messages describe its call, not ours
      if (ours || ((pdu[p] & 0x3f) != 0x01 && pdu[p] != 0x21)) trunk_.onMacMessage(pdu + p, use, now_);
      p += ml;
    }
  }
}

void Receiver::onAmbe(int channel, const uint8_t bits[49], int errs) {
  if (channel == cur_.slot) voiceFrame(false, bits, 49, errs);
}

void Receiver::onP2Ess(int channel, int algid, int) {
  if (channel == cur_.slot) trunk_.onAlgid(algid, now_);
}

// ---------- voice ----------

void Receiver::voiceFrame(bool imbe, const uint8_t* bits, int nbits, int errs) {
  if (trunk_.mode() != Mode::VOICE) return;
  trunk_.onVoiceFrame(now_);
  if (trunk_.call().tg != callTg_) {
    callTg_ = trunk_.call().tg;
    voc_.reset();
    pending_.clear();
  }
  if (trunk_.callEncrypted()) {
    pending_.clear();
    return;
  }
  Frame f;
  f.imbe = imbe;
  f.errs = errs;
  std::memcpy(f.bits, bits, nbits);
  if (trunk_.callClear()) {
    for (auto& p : pending_) vocode(p);
    pending_.clear();
    vocode(f);
  } else {
    pending_.push_back(f); // not known to be clear yet: hold it, unvocoded
    if (pending_.size() > 40) pending_.erase(pending_.begin());
  }
}

void Receiver::vocode(const Frame& f) {
  float pcm[160], out[960];
  if (f.imbe) voc_.imbe(f.bits, f.errs, pcm);
  else voc_.ambe(f.bits, f.errs, pcm);
  // x6 polyphase interpolation
  const int taps = (int)up_.size() / 6;
  double sq = 0;
  for (int i = 0; i < 160; i++) {
    std::memmove(hist_ + 1, hist_, (taps - 1) * sizeof(float));
    hist_[0] = pcm[i];
    for (int p = 0; p < 6; p++) {
      float s = 0;
      for (int j = 0; j < taps; j++) s += up_[p + 6 * j] * hist_[j];
      out[6 * i + p] = s;
      sq += s * s;
    }
  }
  // slow AGC towards a comfortable level
  const double rms = std::sqrt(sq / 960);
  if (rms > 1e-3) {
    const float want = (float)(0.12 / rms);
    agc_ += 0.08f * ((want < 0.3f ? 0.3f : want > 8.f ? 8.f : want) - agc_);
  }
  for (int i = 0; i < 960; i++) {
    float v = out[i] * agc_;
    v = v > 0.98f ? 0.98f : v < -0.98f ? -0.98f : v;
    if (fifoLen_ == fifo_.size()) { // full (shouldn't happen): drop the oldest
      fifoHead_ = (fifoHead_ + 1) % fifo_.size();
      fifoLen_--;
    }
    fifo_[(fifoHead_ + fifoLen_) % fifo_.size()] = v;
    fifoLen_++;
  }
}

bool Receiver::render(float* stereo, int frames) {
  if (!playing_ && (fifoLen_ >= (size_t)START_SAMPLES || (fifoLen_ > 0 && trunk_.mode() != Mode::VOICE))) playing_ = true;
  bool any = false;
  for (int i = 0; i < frames; i++) {
    float v = 0;
    if (playing_ && fifoLen_) {
      v = fifo_[fifoHead_];
      fifoHead_ = (fifoHead_ + 1) % fifo_.size();
      fifoLen_--;
      any = true;
    }
    stereo[2 * i] = stereo[2 * i + 1] = v;
  }
  if (!fifoLen_) playing_ = false;
  return any;
}

std::string Receiver::state(int64_t nowMs) {
  std::string s = trunk_.stateJson(nowMs);
  s.pop_back(); // '}'
  char buf[512];
  const P1Framer& p = p1_[primary_];
  snprintf(buf, sizeof buf,
           ",\"rx\":{\"path\":\"%s\",\"afc\":%.0f,\"quality\":%.3f,\"syncs\":%u,\"frames\":%u,\"nidFails\":%u,\"tsbks\":%u,"
           "\"tsbkFails\":%u,\"p2\":{\"locked\":%s,\"slot\":%d,\"macs\":%u,\"macFails\":%u,\"voice\":%u},\"audioMs\":%d,"
           "\"want\":%lld,\"retunes\":%lld}}",
           primary_ ? "cqpsk" : "c4fm", fine_, cur_.tdma ? p2_.quality() : p.quality(), p.syncs(), p.frames(), p.nidFails(), tsbksIn_,
           p.tsbkFails(), p2_.locked() ? "true" : "false", p2_.slotIndex(), p2_.macs(), p2_.macFails(), p2_.voiceFrames(),
           (int)(fifoLen_ / 48), (long long)want_, (long long)retunes_);
  s += buf;
  return s;
}

}  // namespace p25
}  // namespace tarang
