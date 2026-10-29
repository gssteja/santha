// P25 trunking: the control channel's TSBKs (TIA-102.AABC: channel identifier updates, network / RFSS /
// adjacent site status, voice grants and grant updates, Motorola patch messages) and the voice channel's
// signalling become a model of the system, a talkgroup activity table and a decision about where to listen:
// the control channel, or one call's voice channel (FDMA, or one TDMA slot). One dongle covers 2.4 MHz, so
// following a call usually means retuning, then coming back when the call ends, as OP25 does.
#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace tarang {
namespace p25 {

struct Iden {
  bool valid = false;
  int64_t base = 0;   // Hz
  int spacing = 0;    // Hz
  int64_t txOffset = 0;
  int slots = 1;      // TDMA slots per carrier (1 = FDMA)
};

struct Channel {
  int64_t freq = 0; // 0 = unknown
  bool tdma = false;
  int slot = 0;
};

// Talkgroup flags set by the user.
enum TgFlag { TG_FAVORITE = 1, TG_LOCKOUT = 2 };

struct TgInfo {
  int id = 0;
  int64_t firstMs = 0, lastMs = 0, callStartMs = 0;
  int calls = 0;
  int src = -1;
  int enc = -1;    // 1 encrypted, 0 clear, -1 not known
  bool emergency = false;
  Channel ch;
};

struct CallInfo {
  int tg = -1, src = -1;
  Channel ch;
  int64_t startMs = 0, lastVoiceMs = 0, endMs = 0;
  int enc = -1;   // 1 encrypted (service options or algorithm ID), 0 clear (the voice channel's ALGID is 0x80), -1 not yet known
  int algid = -1;
  bool emergency = false;
  int frames = 0; // vocoder frames heard
};

enum class Mode { HUNT, CONTROL, VOICE };

class Trunk {
 public:
  Trunk();

  // ---------- configuration ----------
  void setControlChannels(const std::vector<int64_t>& hz);
  void setFlags(const std::unordered_map<int, int>& flags) { flags_ = flags; }
  void setFollowFavoritesOnly(bool on) { favoritesOnly_ = on; }
  void setHangMs(int ms) { hangMs_ = ms; }
  void setHold(int tg) { hold_ = tg; } // only follow this talkgroup (-1: off)
  int hold() const { return hold_; }
  void skipCall(int64_t nowMs);        // leave the current call; ignore its talkgroup until that call ends
  void setMuted(bool m) { muted_ = m; } // listening off: stay on the control channel
  // the system's WACN / system ID / NAC when known ahead of the control channel's announcements
  void setKnownSystem(uint32_t wacn, int sysid, int nac) {
    if (!wacn_ && wacn) wacn_ = wacn;
    if (sysid_ < 0 && sysid >= 0) sysid_ = sysid;
    if (nac_ < 0 && nac >= 0) nac_ = nac;
  }

  // ---------- control channel ----------
  void onTsbk(const uint8_t b[12], int nac, int64_t nowMs);
  // a Phase 2 MAC message (on a voice channel's FACCH / SACCH)
  void onMacMessage(const uint8_t* m, int len, int64_t nowMs);

  // ---------- voice channel ----------
  void onVoiceSignal(int64_t nowMs);              // a frame sync / burst on the voice channel
  void onVoiceFrame(int64_t nowMs);               // a vocoder frame
  void onCallInfo(int tg, int src, int svcOpts, int64_t nowMs);
  void onAlgid(int algid, int64_t nowMs);         // 0x80 = clear
  void onCallEnd(int64_t nowMs);                  // terminator / MAC_END_PTT / MAC_IDLE

  // Evaluates timeouts and pending grants; returns true when the target changed.
  bool tick(int64_t nowMs, bool controlOk);

  // ---------- where to listen ----------
  Mode mode() const { return mode_; }
  Channel target() const;
  int64_t controlFreq() const { return ccIdx_ >= 0 && ccIdx_ < (int)ccs_.size() ? ccs_[ccIdx_] : 0; }
  const CallInfo& call() const { return call_; }
  bool callClear() const { return call_.enc == 0; }
  bool callEncrypted() const { return call_.enc == 1; }

  // ---------- system model ----------
  Channel channelFor(int id) const;
  int nac() const { return nac_; }
  uint32_t wacn() const { return wacn_; }
  int sysid() const { return sysid_; }
  bool systemKnown() const { return wacn_ != 0 && sysid_ >= 0 && nac_ >= 0; }
  const std::unordered_map<int, TgInfo>& talkgroups() const { return tgs_; }
  std::string stateJson(int64_t nowMs) const;
  std::string takeEvents();
  uint32_t grants() const { return grants_; }

 private:
  struct Grant {
    int tg, src, opts;
    Channel ch;
  };
  void parseTsbk(const uint8_t b[12], int64_t nowMs);
  void grant(int tg, int src, int chId, int opts, int64_t nowMs);
  void grantCh(int tg, int src, const Channel& ch, int opts, int64_t nowMs);
  bool wantFollow(const TgInfo& t, int opts, int64_t nowMs) const;
  int priority(int tg) const;
  void follow(const Grant& g, int64_t nowMs);
  void leave(int64_t nowMs, const char* why);
  void addControl(int64_t hz);
  TgInfo& tg(int id, int64_t nowMs);

  std::vector<int64_t> ccs_;   // candidates: configured first, then learned
  size_t configuredCcs_ = 0;
  int ccIdx_ = -1;
  int64_t ccSince_ = 0, lastTsbkMs_ = 0, lastSignalMs_ = 0;
  Mode mode_ = Mode::HUNT;
  Iden iden_[16];
  int nac_ = -1, sysid_ = -1, rfss_ = -1, site_ = -1;
  uint32_t wacn_ = 0;
  int64_t siteCc_ = 0;
  std::vector<std::pair<int64_t, std::string>> adjacent_;
  std::unordered_map<int, std::vector<int>> patches_; // super group -> member talkgroups
  std::unordered_map<int, TgInfo> tgs_;
  std::unordered_map<int, int> flags_;
  std::unordered_map<int, int64_t> skipUntil_; // talkgroup -> until (refreshed by its grant updates)
  std::unordered_map<int, int64_t> encUntil_;  // talkgroups found encrypted on the voice channel
  std::vector<Grant> pending_;                 // grants seen since the last tick
  CallInfo call_;
  std::vector<std::string> log_; // recent calls, newest last (JSON objects)
  std::string events_;
  bool favoritesOnly_ = false, muted_ = false;
  int hold_ = -1;
  int hangMs_ = 1000;
  uint32_t grants_ = 0;
};

// TSBK / MAC field helper: (96-bit big-endian word >> shift) & mask, as the standard's tables count bits.
uint32_t tsbkField(const uint8_t b[12], int shift, int bits);

}  // namespace p25
}  // namespace tarang
