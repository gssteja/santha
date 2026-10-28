#include "same.h"

#include <cmath>
#include <cstdio>
#include <cstring>

namespace tarang {

namespace {
constexpr double MARK = 2083.0 + 1.0 / 3; // 4 cycles per bit
constexpr double SPACE = 1562.5;          // 3 cycles per bit
constexpr double BAUD = 520.0 + 5.0 / 6;
constexpr int MAX_MSG = 268;              // the longest legal header
constexpr int64_t BURST_GAP_MS = 4000;    // repeats come about a second apart
constexpr int TONE_WINDOW = 2400;         // 0.2 s at 12 kHz

bool printable(uint8_t c) { return c >= 0x20 && c < 0x7f; }

// A header is complete once the part after '+' holds TTTT-JJJHHMM-LLLLLLLL-
bool headerComplete(const std::string& m) {
  const size_t plus = m.find('+');
  if (plus == std::string::npos) return false;
  int dashes = 0;
  for (size_t i = plus; i < m.size(); i++) dashes += m[i] == '-';
  return dashes >= 3;
}

bool plausibleHeader(const std::string& m) {
  if (m.size() < 40 || m.compare(0, 5, "ZCZC-") != 0) return false;
  const size_t plus = m.find('+');
  if (plus == std::string::npos || plus + 1 + 4 + 1 + 7 + 1 + 8 + 1 > m.size()) return false;
  // ORG-EEE-PSSCCC... : at least one six-digit location code
  if (m.size() < 16 || m[8] != '-' || m[12] != '-') return false;
  for (size_t i = 13; i < plus; i++) {
    const char c = m[i];
    if (!(c == '-' || (c >= '0' && c <= '9'))) return false;
  }
  for (size_t i = plus + 1; i < plus + 5; i++)
    if (m[i] < '0' || m[i] > '9') return false;
  return true;
}

void appendJsonString(std::string& out, const std::string& s) {
  out += '"';
  for (char c : s) {
    if (c == '"' || c == '\\') out += '\\';
    out += c;
  }
  out += '"';
}
}  // namespace

SameDecoder::SameDecoder() {
  dec_.init(lowpass(2800, 48000, 50, 1500), 4, 8192, false);
  mono_.resize(8192);
  out_.resize(8192 / 4 + 4);
  fsk_.init(FS, MARK, SPACE, BAUD);
  toneStepRe_ = std::cos(2 * M_PI * 1050 / FS);
  toneStepIm_ = std::sin(2 * M_PI * 1050 / FS);
}

void SameDecoder::process(const float* stereo, int frames, int64_t nowMs) {
  while (frames > 0) {
    const int n = std::min(frames, 8192);
    float* in = dec_.inputI();
    for (int i = 0; i < n; i++) in[i] = stereo[2 * i];
    const int m = dec_.run(n, out_.data(), nullptr);
    for (int i = 0; i < m; i++) {
      const float x = out_[i];
      int bit;
      if (fsk_.push(x, &bit)) onBit(bit, nowMs);

      // attention tone
      const double t = toneRe_ * toneStepRe_ - toneIm_ * toneStepIm_;
      toneIm_ = toneRe_ * toneStepIm_ + toneIm_ * toneStepRe_;
      toneRe_ = t;
      toneI_ += x * toneRe_;
      toneQ_ += x * toneIm_;
      total_ += (double)x * x;
      if (++toneN_ == TONE_WINDOW) {
        const double r = 1 / std::sqrt(toneRe_ * toneRe_ + toneIm_ * toneIm_);
        toneRe_ *= r, toneIm_ *= r;
        // a pure tone puts (I^2 + Q^2) / (N^2 / 4) / (power) ~ 1; voice and noise far less
        const double ratio = (toneI_ * toneI_ + toneQ_ * toneQ_) / (TONE_WINDOW * 0.5 * total_ + 1e-12);
        const bool tone = ratio > 0.6 && total_ / TONE_WINDOW > 1e-5;
        toneRun_ = tone ? std::max(toneRun_, 0) + 1 : std::min(toneRun_, 0) - 1;
        if (!toneOn_ && toneRun_ >= 5) { // a second of steady 1050 Hz
          toneOn_ = true;
          events_ += "{\"kind\":\"tone\",\"on\":true}\n";
        } else if (toneOn_ && toneRun_ <= -3) {
          toneOn_ = false;
          events_ += "{\"kind\":\"tone\",\"on\":false}\n";
        }
        toneI_ = toneQ_ = total_ = 0;
        toneN_ = 0;
      }
    }
    stereo += 2 * n;
    frames -= n;
  }
  if (!bursts_.empty() && nowMs - lastBurstMs_ > BURST_GAP_MS) flushBursts(nowMs);
}

void SameDecoder::onBit(int bit, int64_t nowMs) {
  sr_ = static_cast<uint8_t>((sr_ >> 1) | (bit << 7)); // least significant bit first
  if (!collecting_) {
    // hunt for the 0xAB preamble bit by bit; once in step, count whole bytes
    if (bitsLeft_ > 0) {
      if (--bitsLeft_ > 0) return;
      if (sr_ == 0xAB) {
        preamble_++;
        bitsLeft_ = 8;
        return;
      }
      if (preamble_ >= 2 && (sr_ == 'Z' || sr_ == 'N')) {
        collecting_ = true;
        msg_.assign(1, static_cast<char>(sr_));
        bitsLeft_ = 8;
        return;
      }
      preamble_ = 0;
      bitsLeft_ = 0;
    }
    if (sr_ == 0xAB) {
      preamble_ = 1;
      bitsLeft_ = 8;
    }
    return;
  }
  if (--bitsLeft_ > 0) return;
  bitsLeft_ = 8;
  if (!printable(sr_)) {
    endMessage(nowMs);
    return;
  }
  msg_ += static_cast<char>(sr_);
  if ((msg_.compare(0, 4, "NNNN") == 0) || (msg_[0] == 'Z' && headerComplete(msg_)) || msg_.size() >= MAX_MSG) {
    endMessage(nowMs);
  }
}

void SameDecoder::endMessage(int64_t nowMs) {
  collecting_ = false;
  preamble_ = 0;
  bitsLeft_ = 0;
  if (msg_.compare(0, 4, "NNNN") == 0) {
    if (nowMs - lastEomMs_ > 10000) events_ += "{\"kind\":\"eom\"}\n";
    lastEomMs_ = nowMs;
  } else if (msg_.compare(0, 4, "ZCZC") == 0) {
    bursts_.push_back(msg_);
    lastBurstMs_ = nowMs;
    if (bursts_.size() >= 3) flushBursts(nowMs);
  }
  msg_.clear();
}

// Majority vote across the repeats, character by character (they're identical when received cleanly).
void SameDecoder::flushBursts(int64_t nowMs) {
  std::string best;
  const int n = static_cast<int>(bursts_.size());
  if (n >= 3) {
    size_t len = std::max({bursts_[0].size(), bursts_[1].size(), bursts_[2].size()});
    for (size_t i = 0; i < len; i++) {
      char c[3];
      for (int k = 0; k < 3; k++) c[k] = i < bursts_[k].size() ? bursts_[k][i] : 0;
      char v = c[0] == c[1] || c[0] == c[2] ? c[0] : c[1] == c[2] ? c[1] : c[0];
      if (!v) break;
      best += v;
    }
  } else if (n == 2) {
    best = bursts_[0] == bursts_[1] ? bursts_[0] : plausibleHeader(bursts_[1]) ? bursts_[1] : bursts_[0];
  } else if (n == 1) {
    best = bursts_[0];
  }
  bursts_.clear();
  if (!plausibleHeader(best)) return;
  if (best == lastSent_ && nowMs - lastSentMs_ < 120000) return; // the same alert, repeated
  lastSent_ = best;
  lastSentMs_ = nowMs;
  events_ += "{\"kind\":\"header\",\"text\":";
  appendJsonString(events_, best);
  char tail[32];
  std::snprintf(tail, sizeof tail, ",\"bursts\":%d}\n", n);
  events_ += tail;
}

std::string SameDecoder::take() {
  std::string out;
  out.swap(events_);
  return out;
}

}  // namespace tarang
