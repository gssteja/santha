#include "aprs.h"

#include <cstdio>

namespace tarang {

namespace {
constexpr int MIN_FRAME = 18;  // two addresses, control, PID, FCS
constexpr int MAX_FRAME = 340;

void jsonString(std::string& out, const uint8_t* p, size_t n) {
  out += '"';
  char buf[8];
  for (size_t i = 0; i < n; i++) {
    const uint8_t c = p[i];
    if (c == '"' || c == '\\') {
      out += '\\';
      out += static_cast<char>(c);
    } else if (c < 0x20 || c >= 0x7f) {
      std::snprintf(buf, sizeof buf, "\\u%04x", c); // keeps the line plain ASCII for JNI
      out += buf;
    } else {
      out += static_cast<char>(c);
    }
  }
  out += '"';
}

// An AX.25 address: six shifted characters (space padded) and an SSID byte.
std::string address(const uint8_t* a, bool digi) {
  std::string s;
  for (int i = 0; i < 6; i++) {
    const char c = static_cast<char>(a[i] >> 1);
    if (c != ' ') s += c;
  }
  const int ssid = (a[6] >> 1) & 0x0f;
  if (ssid) s += "-" + std::to_string(ssid);
  if (digi && (a[6] & 0x80)) s += '*'; // has been repeated
  return s;
}
}  // namespace

uint16_t AprsDecoder::fcs(const uint8_t* p, int n) {
  uint16_t crc = 0xffff;
  for (int i = 0; i < n; i++) {
    crc ^= p[i];
    for (int k = 0; k < 8; k++) crc = (crc & 1) ? (crc >> 1) ^ 0x8408 : crc >> 1;
  }
  return static_cast<uint16_t>(~crc);
}

AprsDecoder::AprsDecoder() {
  // the space tone's energy weight: flat, and three degrees of de-emphasis for pre-emphasized transmitters
  for (float g : {1.0f, 0.55f, 0.3f, 1.8f}) {
    Slicer s;
    s.fsk.init(48000, 1200, 2200, 1200, g, 0.2);
    slicers_.push_back(std::move(s));
  }
}

void AprsDecoder::process(const float* stereo, int frames, int64_t nowMs) {
  for (int i = 0; i < frames; i++) {
    const float x = stereo[2 * i];
    for (auto& s : slicers_) {
      int tone;
      if (s.fsk.push(x, &tone)) onBit(s, tone, nowMs);
    }
  }
}

void AprsDecoder::onBit(Slicer& s, int tone, int64_t nowMs) {
  const int d = tone == s.lastTone ? 1 : 0; // NRZI: no change is a one
  s.lastTone = tone;
  s.hist = static_cast<uint8_t>((s.hist << 1) | d);
  if (s.hist == 0x7e) { // flag: a frame ends (its last seven bits were the flag's own) and the next may start
    if (s.inFrame && s.nbits == 7 && static_cast<int>(s.frame.size()) >= MIN_FRAME) onFrame(s.frame, nowMs);
    s.inFrame = true;
    s.frame.clear();
    s.byte = 0;
    s.nbits = 0;
    s.ones = 0;
    return;
  }
  if (!s.inFrame) return;
  if (d) {
    if (++s.ones > 6) { // seven ones: abort
      s.inFrame = false;
      return;
    }
  } else {
    if (s.ones == 5) { // a stuffed zero
      s.ones = 0;
      return;
    }
    s.ones = 0;
  }
  s.byte = static_cast<uint8_t>(s.byte | (d << s.nbits)); // least significant bit first
  if (++s.nbits == 8) {
    s.frame.push_back(s.byte);
    s.byte = 0;
    s.nbits = 0;
    if (static_cast<int>(s.frame.size()) > MAX_FRAME) s.inFrame = false;
  }
}

void AprsDecoder::onFrame(const std::vector<uint8_t>& f, int64_t nowMs) {
  const int n = static_cast<int>(f.size());
  const uint16_t want = static_cast<uint16_t>(f[n - 2] | (f[n - 1] << 8));
  if (fcs(f.data(), n - 2) != want) return;
  // the same frame from another slicer, or a second copy a moment later
  for (auto it = recent_.begin(); it != recent_.end();) {
    if (nowMs - it->second > 3000) it = recent_.erase(it);
    else if (it->first == want) return;
    else ++it;
  }
  recent_.emplace_back(want, nowMs);

  // addresses: destination, source, up to eight digipeaters; the last has the extension bit set
  int pos = 0;
  std::vector<std::string> addrs;
  while (pos + 7 <= n - 2) {
    addrs.push_back(address(&f[pos], addrs.size() >= 2));
    const bool last = f[pos + 6] & 1;
    pos += 7;
    if (last) break;
    if (addrs.size() > 10) return;
  }
  if (addrs.size() < 2 || pos + 2 > n - 2) return;
  if (f[pos] != 0x03 || f[pos + 1] != 0xf0) return; // UI frame, no layer 3: what APRS uses
  pos += 2;
  frames_++;
  events_ += "{\"src\":";
  jsonString(events_, reinterpret_cast<const uint8_t*>(addrs[1].data()), addrs[1].size());
  events_ += ",\"dst\":";
  jsonString(events_, reinterpret_cast<const uint8_t*>(addrs[0].data()), addrs[0].size());
  events_ += ",\"path\":[";
  for (size_t i = 2; i < addrs.size(); i++) {
    if (i > 2) events_ += ',';
    jsonString(events_, reinterpret_cast<const uint8_t*>(addrs[i].data()), addrs[i].size());
  }
  events_ += "],\"info\":";
  jsonString(events_, &f[pos], n - 2 - pos);
  events_ += "}\n";
}

std::string AprsDecoder::take() {
  std::string out;
  out.swap(events_);
  return out;
}

}  // namespace tarang
