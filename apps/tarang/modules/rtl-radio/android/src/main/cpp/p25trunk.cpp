#include "p25trunk.h"

#include <algorithm>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>

namespace tarang {
namespace p25 {

namespace {

constexpr int64_t CC_DWELL_MS = 1500;    // hunting: time on each control channel candidate
constexpr int64_t CC_LOST_MS = 3000;     // no TSBK for this long: the control channel is gone
constexpr int64_t SIGNAL_LOST_MS = 1000; // voice channel: no frame sync for this long
constexpr int64_t NO_VOICE_MS = 2500;    // voice channel: no voice at all since we arrived
constexpr int64_t NEW_CALL_MS = 2500;    // a grant this long after the last one for a talkgroup starts a new call
constexpr int64_t SKIP_MS = 3000;        // a skipped call is over once its grant updates stop this long
constexpr int64_t ENC_MS = 600000;       // a talkgroup found encrypted on the voice channel is skipped this long
constexpr int SLOTS_PER_CARRIER[16] = {1, 1, 1, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2};

void jsonAppend(std::string& s, const char* fmt, ...) __attribute__((format(printf, 2, 3)));
void jsonAppend(std::string& s, const char* fmt, ...) {
  char buf[512];
  va_list ap;
  va_start(ap, fmt);
  const int n = vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  if (n > 0) s.append(buf, n < (int)sizeof buf ? n : (int)sizeof buf - 1);
}

}  // namespace

uint32_t tsbkField(const uint8_t b[12], int shift, int bits) {
  unsigned __int128 w = 0;
  for (int i = 0; i < 12; i++) w = w << 8 | b[i];
  return (uint32_t)((w >> shift) & ((((unsigned __int128)1) << bits) - 1));
}

Trunk::Trunk() {}

void Trunk::setControlChannels(const std::vector<int64_t>& hz) {
  const int64_t cur = controlFreq();
  ccs_ = hz;
  configuredCcs_ = hz.size();
  ccIdx_ = ccs_.empty() ? -1 : 0;
  for (size_t i = 0; i < ccs_.size(); i++)
    if (ccs_[i] == cur) ccIdx_ = (int)i;
  if (ccIdx_ >= 0 && ccs_[ccIdx_] != cur) {
    mode_ = mode_ == Mode::VOICE ? mode_ : Mode::HUNT;
    ccSince_ = 0;
  }
}

void Trunk::addControl(int64_t hz) {
  if (hz <= 0 || std::find(ccs_.begin(), ccs_.end(), hz) != ccs_.end()) return;
  if (ccs_.size() >= 16) return;
  ccs_.push_back(hz);
  if (ccIdx_ < 0) ccIdx_ = 0;
}

Channel Trunk::channelFor(int id) const {
  Channel c;
  const Iden& d = iden_[(id >> 12) & 15];
  if (!d.valid) return c;
  const int n = id & 0xfff;
  c.tdma = d.slots > 1;
  c.freq = d.base + (int64_t)d.spacing * (c.tdma ? n / d.slots : n);
  c.slot = c.tdma ? n % d.slots : 0;
  return c;
}

Channel Trunk::target() const {
  if (mode_ == Mode::VOICE) return call_.ch;
  Channel c;
  c.freq = controlFreq();
  return c;
}

TgInfo& Trunk::tg(int id, int64_t nowMs) {
  auto it = tgs_.find(id);
  if (it != tgs_.end()) return it->second;
  if (tgs_.size() >= 600) { // forget the talkgroup heard longest ago
    auto old = tgs_.begin();
    for (auto i = tgs_.begin(); i != tgs_.end(); ++i)
      if (i->second.lastMs < old->second.lastMs) old = i;
    tgs_.erase(old);
  }
  TgInfo& t = tgs_[id];
  t.id = id;
  t.firstMs = nowMs;
  return t;
}

int Trunk::priority(int tg) const {
  auto f = flags_.find(tg);
  return f != flags_.end() && (f->second & TG_FAVORITE) ? 2 : 1;
}

bool Trunk::wantFollow(const TgInfo& t, int opts, int64_t nowMs) const {
  if (muted_) return false;
  auto f = flags_.find(t.id);
  const int fl = f != flags_.end() ? f->second : 0;
  if (fl & TG_LOCKOUT) return false;
  if (hold_ >= 0 && t.id != hold_) return false;
  if (favoritesOnly_ && !(fl & TG_FAVORITE)) return false;
  if (opts >= 0 ? (opts & 0x40) != 0 : t.enc == 1) return false; // encrypted: never followed
  auto e = encUntil_.find(t.id);
  if (e != encUntil_.end() && e->second > nowMs) return false;
  auto s = skipUntil_.find(t.id);
  if (s != skipUntil_.end() && s->second > nowMs) return false;
  if (t.ch.tdma && !systemKnown()) return false; // can't descramble the voice bursts yet
  return true;
}

void Trunk::grant(int tgid, int src, int chId, int opts, int64_t nowMs) {
  if (tgid <= 0) return;
  grantCh(tgid, src, channelFor(chId), opts, nowMs);
}

void Trunk::grantCh(int tgid, int src, const Channel& ch, int opts, int64_t nowMs) {
  grants_++;
  TgInfo& t = tg(tgid, nowMs);
  if (nowMs - t.lastMs > NEW_CALL_MS || t.calls == 0) {
    t.calls++;
    t.callStartMs = nowMs;
  }
  t.lastMs = nowMs;
  if (src > 0) t.src = src;
  if (opts >= 0) {
    t.enc = (opts & 0x40) ? 1 : 0;
    t.emergency = (opts & 0x80) != 0;
  }
  if (ch.freq) t.ch = ch;
  auto s = skipUntil_.find(tgid);
  if (s != skipUntil_.end() && s->second > nowMs) s->second = nowMs + SKIP_MS;
  if (mode_ == Mode::VOICE && call_.tg == tgid && call_.ch.freq == ch.freq && call_.ch.slot == ch.slot) {
    if (src > 0) call_.src = src;
    return;
  }
  if (!ch.freq || !wantFollow(t, opts, nowMs)) return;
  pending_.push_back({tgid, src, opts, ch});
}

void Trunk::follow(const Grant& g, int64_t nowMs) {
  const TgInfo& t = tgs_[g.tg];
  call_ = CallInfo();
  call_.tg = g.tg;
  call_.src = g.src > 0 ? g.src : t.src;
  call_.ch = g.ch;
  call_.startMs = nowMs;
  call_.lastVoiceMs = nowMs;
  // clear service options let us tune; only the voice channel's own algorithm ID (0x80) lets the voice through
  call_.enc = g.opts >= 0 && (g.opts & 0x40) ? 1 : -1;
  call_.emergency = t.emergency;
  lastSignalMs_ = nowMs;
  mode_ = Mode::VOICE;
}

void Trunk::leave(int64_t nowMs, const char* why) {
  if (mode_ != Mode::VOICE) return;
  std::string e;
  jsonAppend(e, "{\"tg\":%d,\"src\":%d,\"f\":%lld,\"slot\":%d,\"tdma\":%s,\"enc\":%d,\"emergency\":%s,\"ago\":%lld,\"dur\":%lld,\"frames\":%d,\"end\":\"%s\"}",
             call_.tg, call_.src, (long long)call_.ch.freq, call_.ch.slot, call_.ch.tdma ? "true" : "false", call_.enc,
             call_.emergency ? "true" : "false", (long long)nowMs, (long long)(nowMs - call_.startMs), call_.frames, why);
  log_.push_back(e);
  if (log_.size() > 50) log_.erase(log_.begin());
  events_ += e;
  events_ += '\n';
  call_ = CallInfo();
  mode_ = Mode::CONTROL;
  lastTsbkMs_ = nowMs; // give the control channel a moment to come back
}

void Trunk::skipCall(int64_t nowMs) {
  if (mode_ != Mode::VOICE) return;
  skipUntil_[call_.tg] = nowMs + SKIP_MS;
  leave(nowMs, "skipped");
}

// ---------- control channel ----------

void Trunk::onTsbk(const uint8_t b[12], int nac, int64_t nowMs) {
  lastTsbkMs_ = nowMs;
  if (nac > 0) nac_ = nac;
  if (b[0] & 0x40) return; // protected (encrypted) TSBK
  parseTsbk(b, nowMs);
}

void Trunk::parseTsbk(const uint8_t b[12], int64_t nowMs) {
  const int op = b[0] & 0x3f, mfid = b[1];
  auto F = [&](int shift, int bits) { return (int64_t)tsbkField(b, shift, bits); };
  if (mfid == 0x90) { // Motorola
    switch (op) {
      case 0x00: { // group regroup add: a patch / supergroup
        const int sg = (int)F(64, 16);
        auto& m = patches_[sg];
        for (int s : {48, 32, 16}) {
          const int ga = (int)F(s, 16);
          if (ga && ga != sg && std::find(m.begin(), m.end(), ga) == m.end()) m.push_back(ga);
        }
        if (m.size() > 16) m.erase(m.begin());
        return;
      }
      case 0x01: { // group regroup delete
        const int sg = (int)F(64, 16);
        auto it = patches_.find(sg);
        if (it == patches_.end()) return;
        for (int s : {48, 32, 16}) {
          const int ga = (int)F(s, 16);
          it->second.erase(std::remove(it->second.begin(), it->second.end(), ga), it->second.end());
        }
        if (it->second.empty()) patches_.erase(it);
        return;
      }
      case 0x02: grant((int)F(40, 16), (int)F(16, 24), (int)F(56, 16), (int)F(72, 8), nowMs); return; // regroup voice grant
      case 0x03: // regroup grant update
        grant((int)F(48, 16), -1, (int)F(64, 16), -1, nowMs);
        if (F(32, 16) != F(64, 16) || F(16, 16) != F(48, 16)) grant((int)F(16, 16), -1, (int)F(32, 16), -1, nowMs);
        return;
    }
    return;
  }
  if (mfid > 1) return; // another manufacturer's message
  switch (op) {
    case 0x00: grant((int)F(40, 16), (int)F(16, 24), (int)F(56, 16), (int)F(72, 8), nowMs); return; // group voice grant
    case 0x02:                                                                                       // grant update
      grant((int)F(48, 16), -1, (int)F(64, 16), -1, nowMs);
      if (F(32, 16) != F(64, 16) || F(16, 16) != F(48, 16)) grant((int)F(16, 16), -1, (int)F(32, 16), -1, nowMs);
      return;
    case 0x03: grant((int)F(16, 16), -1, (int)F(48, 16), (int)F(72, 8), nowMs); return; // grant update, explicit
    case 0x3D: {                                                                         // IDEN_UP (700/800/900 MHz)
      Iden& d = iden_[F(76, 4)];
      const int toff = (int)F(58, 9);
      d.valid = true;
      d.base = F(16, 32) * 5;
      d.spacing = (int)F(48, 10) * 125;
      d.txOffset = (toff & 0x100 ? 1 : -1) * (int64_t)(toff & 0xff) * 250000;
      d.slots = 1;
      return;
    }
    case 0x34: { // IDEN_UP_VU
      Iden& d = iden_[F(76, 4)];
      const int toff = (int)F(58, 14);
      d.valid = true;
      d.base = F(16, 32) * 5;
      d.spacing = (int)F(48, 10) * 125;
      d.txOffset = (toff & 0x2000 ? 1 : -1) * (int64_t)(toff & 0x1fff) * d.spacing;
      d.slots = 1;
      return;
    }
    case 0x33: { // IDEN_UP_TDMA
      Iden& d = iden_[F(76, 4)];
      const int toff = (int)F(58, 14);
      d.valid = true;
      d.base = F(16, 32) * 5;
      d.spacing = (int)F(48, 10) * 125;
      d.txOffset = (toff & 0x2000 ? 1 : -1) * (int64_t)(toff & 0x1fff) * d.spacing;
      d.slots = SLOTS_PER_CARRIER[F(72, 4)];
      return;
    }
    case 0x3A: { // RFSS status
      rfss_ = (int)F(48, 8);
      site_ = (int)F(40, 8);
      if (sysid_ < 0) sysid_ = (int)F(56, 12);
      const Channel c = channelFor((int)F(24, 16));
      if (c.freq) {
        siteCc_ = c.freq;
        addControl(c.freq);
      }
      return;
    }
    case 0x3B: { // network status: WACN and system ID (they seed the TDMA scrambler)
      wacn_ = (uint32_t)F(52, 20);
      sysid_ = (int)F(40, 12);
      addControl(channelFor((int)F(24, 16)).freq);
      return;
    }
    case 0x3C: { // adjacent site
      const Channel c = channelFor((int)F(24, 16));
      if (!c.freq) return;
      char name[24];
      snprintf(name, sizeof name, "%d-%d", (int)F(48, 8), (int)F(40, 8));
      for (auto& a : adjacent_)
        if (a.first == c.freq) {
          a.second = name;
          return;
        }
      if (adjacent_.size() < 16) adjacent_.push_back({c.freq, name});
      return;
    }
    case 0x39: // secondary control channels
      addControl(channelFor((int)F(48, 16)).freq);
      addControl(channelFor((int)F(24, 16)).freq);
      return;
    case 0x29: addControl(channelFor((int)F(48, 16)).freq); return; // secondary control channel, explicit
  }
}

void Trunk::onMacMessage(const uint8_t* m, int len, int64_t nowMs) {
  if (len < 1) return;
  const int op = m[0], b1b2 = op >> 6;
  if (b1b2 == 1 && len >= 9) { // abbreviated form: the TSBK of the same opcode without the MFID
    uint8_t t[12] = {0};
    t[0] = (uint8_t)(0x80 | (op & 0x3f));
    for (int i = 1; i <= 8; i++) t[i + 1] = m[i];
    parseTsbk(t, nowMs);
    return;
  }
  if (b1b2 != 0) return;
  switch (op) {
    case 0x01: // group voice channel user, abbreviated: who's talking on this channel
    case 0x21: // ... extended
      if (len >= 7) onCallInfo(m[2] << 8 | m[3], m[4] << 16 | m[5] << 8 | m[6], m[1], nowMs);
      return;
    case 0x05: // grant updates, multiple, implicit
      for (int i = 0; i < 3 && 1 + 5 * i + 4 < len; i++) {
        const uint8_t* g = m + 1 + 5 * i;
        grant(g[3] << 8 | g[4], -1, g[1] << 8 | g[2], g[0], nowMs);
      }
      return;
    case 0x25: // grant updates, multiple, explicit
      for (int i = 0; i < 2 && 1 + 7 * i + 6 < len; i++) {
        const uint8_t* g = m + 1 + 7 * i;
        grant(g[5] << 8 | g[6], -1, g[1] << 8 | g[2], g[0], nowMs);
      }
      return;
  }
}

// ---------- voice channel ----------

void Trunk::onVoiceSignal(int64_t nowMs) { lastSignalMs_ = nowMs; }

void Trunk::onVoiceFrame(int64_t nowMs) {
  if (mode_ != Mode::VOICE) return;
  call_.frames++;
  call_.lastVoiceMs = nowMs;
  call_.endMs = 0;
  lastSignalMs_ = nowMs;
}

void Trunk::onCallInfo(int tgid, int src, int svcOpts, int64_t nowMs) {
  if (mode_ != Mode::VOICE) return;
  if (tgid > 0 && tgid != call_.tg) {
    // the channel now carries someone else: stay if we'd follow them too
    TgInfo& t = tg(tgid, nowMs);
    t.lastMs = nowMs;
    if (!wantFollow(t, svcOpts, nowMs)) {
      leave(nowMs, "reassigned");
      return;
    }
    call_.tg = tgid;
    call_.src = -1;
    call_.enc = -1;
  }
  if (src > 0) {
    call_.src = src;
    tgs_[call_.tg].src = src;
  }
  if (svcOpts >= 0) {
    call_.emergency = (svcOpts & 0x80) != 0;
    if (svcOpts & 0x40) onAlgid(-2, nowMs); // the service options say encrypted
  }
}

void Trunk::onAlgid(int algid, int64_t nowMs) {
  if (mode_ != Mode::VOICE) return;
  call_.algid = algid;
  if (algid == 0x80) {
    if (call_.enc < 0) call_.enc = 0;
    return;
  }
  call_.enc = 1;
  TgInfo& t = tg(call_.tg, nowMs);
  t.enc = 1;
  encUntil_[call_.tg] = nowMs + ENC_MS;
}

void Trunk::onCallEnd(int64_t nowMs) {
  if (mode_ == Mode::VOICE && call_.endMs == 0) call_.endMs = nowMs;
}

bool Trunk::tick(int64_t nowMs, bool controlOk) {
  (void)controlOk;
  bool changed = false;
  switch (mode_) {
    case Mode::HUNT:
      if (ccIdx_ < 0) break;
      if (ccSince_ == 0) ccSince_ = nowMs;
      if (lastTsbkMs_ >= ccSince_) {
        mode_ = Mode::CONTROL;
      } else if (nowMs - ccSince_ > CC_DWELL_MS) {
        ccIdx_ = (ccIdx_ + 1) % (int)ccs_.size();
        ccSince_ = nowMs;
        changed = true;
      }
      break;
    case Mode::CONTROL:
      if (nowMs - lastTsbkMs_ > CC_LOST_MS) {
        mode_ = Mode::HUNT;
        ccSince_ = nowMs;
        break;
      }
      if (!pending_.empty()) {
        auto best = std::max_element(pending_.begin(), pending_.end(),
                                     [&](const Grant& a, const Grant& b) { return priority(a.tg) < priority(b.tg); });
        follow(*best, nowMs);
        changed = true;
      }
      break;
    case Mode::VOICE: {
      const char* why = nullptr;
      if (call_.enc == 1) why = "encrypted";
      else if (nowMs - lastSignalMs_ > SIGNAL_LOST_MS) why = "signal";
      else if (call_.frames == 0 && nowMs - call_.startMs > NO_VOICE_MS) why = "no voice";
      else if (call_.endMs && nowMs - call_.endMs > hangMs_ && call_.lastVoiceMs <= call_.endMs) why = "ended";
      else if (call_.frames > 0 && nowMs - call_.lastVoiceMs > hangMs_ + 1000) why = "quiet";
      if (why) {
        leave(nowMs, why);
        changed = true;
      }
      // a favorite talkgroup's grant (heard on this channel's MAC) takes over a non-favorite call
      if (mode_ == Mode::VOICE && !pending_.empty()) {
        for (const Grant& g : pending_)
          if (priority(g.tg) > priority(call_.tg)) {
            leave(nowMs, "preempted");
            follow(g, nowMs);
            changed = true;
            break;
          }
      }
      break;
    }
  }
  pending_.clear();
  for (auto it = skipUntil_.begin(); it != skipUntil_.end();) it = it->second < nowMs ? skipUntil_.erase(it) : std::next(it);
  return changed;
}

std::string Trunk::takeEvents() {
  std::string e;
  e.swap(events_);
  return e;
}

std::string Trunk::stateJson(int64_t nowMs) const {
  std::string s = "{";
  const char* mode = mode_ == Mode::HUNT ? "hunt" : mode_ == Mode::CONTROL ? "control" : "voice";
  jsonAppend(s, "\"mode\":\"%s\",\"cc\":%lld,\"nac\":%d,\"wacn\":%u,\"sysid\":%d,\"rfss\":%d,\"site\":%d,\"grants\":%u,\"hold\":%d",
             mode, (long long)controlFreq(), nac_, wacn_, sysid_, rfss_, site_, grants_, hold_);
  s += ",\"ccs\":[";
  for (size_t i = 0; i < ccs_.size(); i++) jsonAppend(s, "%s%lld", i ? "," : "", (long long)ccs_[i]);
  s += "],\"adjacent\":[";
  for (size_t i = 0; i < adjacent_.size(); i++)
    jsonAppend(s, "%s{\"f\":%lld,\"site\":\"%s\"}", i ? "," : "", (long long)adjacent_[i].first, adjacent_[i].second.c_str());
  s += "],\"patches\":[";
  bool first = true;
  for (auto& p : patches_) {
    jsonAppend(s, "%s{\"sg\":%d,\"tgs\":[", first ? "" : ",", p.first);
    for (size_t i = 0; i < p.second.size(); i++) jsonAppend(s, "%s%d", i ? "," : "", p.second[i]);
    s += "]}";
    first = false;
  }
  s += "],\"call\":";
  if (mode_ == Mode::VOICE) {
    jsonAppend(s, "{\"tg\":%d,\"src\":%d,\"f\":%lld,\"slot\":%d,\"tdma\":%s,\"enc\":%d,\"algid\":%d,\"emergency\":%s,\"dur\":%lld,\"frames\":%d,\"talking\":%s}",
               call_.tg, call_.src, (long long)call_.ch.freq, call_.ch.slot, call_.ch.tdma ? "true" : "false", call_.enc, call_.algid,
               call_.emergency ? "true" : "false", (long long)(nowMs - call_.startMs), call_.frames,
               nowMs - call_.lastVoiceMs < 400 && call_.frames > 0 ? "true" : "false");
  } else {
    s += "null";
  }
  // talkgroups, most recent first
  std::vector<const TgInfo*> list;
  list.reserve(tgs_.size());
  for (auto& t : tgs_) list.push_back(&t.second);
  std::sort(list.begin(), list.end(), [](const TgInfo* a, const TgInfo* b) { return a->lastMs > b->lastMs; });
  if (list.size() > 250) list.resize(250);
  s += ",\"tgs\":[";
  for (size_t i = 0; i < list.size(); i++) {
    const TgInfo& t = *list[i];
    jsonAppend(s, "%s{\"id\":%d,\"ago\":%lld,\"calls\":%d,\"src\":%d,\"enc\":%d,\"emergency\":%s,\"f\":%lld,\"slot\":%d,\"tdma\":%s}", i ? "," : "",
               t.id, (long long)(nowMs - t.lastMs), t.calls, t.src, t.enc, t.emergency ? "true" : "false", (long long)t.ch.freq, t.ch.slot,
               t.ch.tdma ? "true" : "false");
  }
  s += "],\"log\":[";
  for (size_t i = 0; i < log_.size(); i++) {
    // stored with "ago" holding the end time; rewrite it relative to now
    const std::string& e = log_[log_.size() - 1 - i];
    const size_t p = e.find("\"ago\":");
    const size_t q = e.find(',', p);
    const long long end = std::atoll(e.c_str() + p + 6);
    if (i) s += ',';
    s.append(e, 0, p + 6);
    jsonAppend(s, "%lld", (long long)(nowMs - end));
    s.append(e, q, std::string::npos);
  }
  s += "]}";
  return s;
}

}  // namespace p25
}  // namespace tarang
