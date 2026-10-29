// Vocoder glue: the decoder's error-corrected parameter bits into mbelib's synthesis.
#include "p25voice.h"

#include <cstring>

extern "C" {
#include "mbelib/mbelib.h"
}

namespace tarang {
namespace p25 {

namespace {
constexpr int UV_QUALITY = 3;              // unvoiced synthesis noise sources (mbelib's / DSD's default)
constexpr float SCALE = 7.0f / 32768.0f;   // mbelib's float output is 1/7 of its int16 scale
}  // namespace

struct Vocoder::State {
  mbe_parms cur, prev, enh;
  char err[64];
};

Vocoder::Vocoder() : st_(new State) { reset(); }

Vocoder::~Vocoder() { delete st_; }

void Vocoder::reset() { mbe_initMbeParms(&st_->cur, &st_->prev, &st_->enh); }

void Vocoder::imbe(const uint8_t bits[88], int errs, float out[160]) {
  char d[88];
  for (int i = 0; i < 88; i++) d[i] = (char)bits[i];
  int e = errs, e2 = errs < 40 ? errs : 40; // mbelib writes one character per error into err
  mbe_processImbe4400Dataf(out, &e, &e2, st_->err, d, &st_->cur, &st_->prev, &st_->enh, UV_QUALITY);
  for (int i = 0; i < 160; i++) out[i] *= SCALE;
}

void Vocoder::ambe(const uint8_t bits[49], int errs, float out[160]) {
  char d[49];
  for (int i = 0; i < 49; i++) d[i] = (char)bits[i];
  int e = errs, e2 = errs < 40 ? errs : 40;
  mbe_processAmbe2450Dataf(out, &e, &e2, st_->err, d, &st_->cur, &st_->prev, &st_->enh, UV_QUALITY);
  for (int i = 0; i < 160; i++) out[i] *= SCALE;
}

}  // namespace p25
}  // namespace tarang
