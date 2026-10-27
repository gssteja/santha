/** Tarang's bridge to rtl_433's device decoders (weather stations, thermometers, tire sensors, remotes...). */
#ifndef TARANG_R433_H_
#define TARANG_R433_H_

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct r433 r433_t;

/** All of rtl_433's default-enabled decoders, for CU8 samples at [samp_rate]. */
r433_t *r433_create(uint32_t samp_rate);
void r433_free(r433_t *r);

/** Call after every retune: clears the filters and pulse detector, and tags messages with [center_freq]. */
void r433_reset(r433_t *r, uint32_t center_freq);

/** Runs [n_samples] interleaved uint8 I/Q samples through the decoders. Returns messages decoded. */
int r433_process(r433_t *r, uint8_t const *iq, unsigned n_samples);

/** Newline-separated JSON messages decoded since the last call (rtl_433 -F json -M level -M protocol). */
char const *r433_take(r433_t *r, size_t *len);

unsigned r433_decoders(r433_t const *r);

#ifdef __cplusplus
}
#endif

#endif
