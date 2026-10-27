/** @file
    Tarang's bridge to rtl_433's device decoders.

    The per-buffer pipeline of rtl_433.c's sdr_callback, cut down to what the phone needs: envelope and FM
    demodulation, pulse detection, the OOK/FSK slicers and every default-enabled decoder. rtl_433's SDR input,
    option parsing and output handlers are left out; each decoded message becomes one JSON line instead.

    Based on rtl_433 (r_api.c, rtl_433.c), Copyright (C) 2012 by Benjamin Larsson and contributors.
    This program is free software; you can redistribute it and/or modify it under the terms of the GNU General
    Public License as published by the Free Software Foundation; either version 2 of the License, or (at your
    option) any later version.
*/

#include "r433.h"

#include <limits.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "baseband.h"
#include "data.h"
#include "list.h"
#include "logger.h"
#include "pulse_detect.h"
#include "pulse_slicer.h"
#include "r_device.h"
#include "rtl_433.h"
#include "rtl_433_devices.h" // declares every decoder (extern r_device ...)

#define CHUNK (128 * 1024)  // samples per pass, like rtl_433's default 256 KiB buffers
#define MSG_MAX 4096

struct r433 {
    list_t devs;
    int enable_fm;
    pulse_detect_t *pulse_detect;
    filter_state_t lowpass;
    demodfm_state_t fm_state;
    pulse_data_t pulse_data;
    pulse_data_t fsk_pulse_data;
    uint16_t *temp;
    int16_t *am;
    int16_t *fm;
    uint32_t samp_rate;
    uint32_t center_freq;
    uint64_t input_pos;
    float noise_level;
    float min_level;
    float min_snr;
    int fsk_active; // which pulse data the current decode came from
    int events;
    char *out;
    size_t out_len;
    size_t out_cap;
    char msg[MSG_MAX];
};

static void quiet_log(log_level_t level, char const *src, char const *msg, void *userdata)
{
    (void)level, (void)src, (void)msg, (void)userdata;
}

static void drop_log(r_device *dev, int level, data_t *data)
{
    (void)dev, (void)level;
    data_free(data);
}

static void append(r433_t *r, char const *s, size_t n)
{
    if (r->out_len + n + 2 > r->out_cap) {
        if (r->out_len > 256 * 1024) return; // nobody is draining: drop rather than grow without bound
        size_t cap = (r->out_len + n + 2) * 2;
        char *p = realloc(r->out, cap);
        if (!p) return;
        r->out = p;
        r->out_cap = cap;
    }
    memcpy(r->out + r->out_len, s, n);
    r->out_len += n;
    r->out[r->out_len++] = '\n';
    r->out[r->out_len] = '\0';
}

/** A decoder produced a message: add the signal metadata (-M level -M protocol) and queue it as JSON. */
static void on_output(r_device *dev, data_t *data)
{
    r433_t *r = dev->output_ctx;
    pulse_data_t const *pd = r->fsk_active ? &r->fsk_pulse_data : &r->pulse_data;
    if (dev->protocol_num)
        data = data_int(data, "protocol", "Protocol", NULL, dev->protocol_num);
    if (r->fsk_active) {
        data = data_str(data, "mod", "Modulation", NULL, "FSK");
        data = data_dbl(data, "freq1", "Freq1", "%.3f MHz", pd->freq1_hz / 1000000.0);
        data = data_dbl(data, "freq2", "Freq2", "%.3f MHz", pd->freq2_hz / 1000000.0);
    }
    else {
        data = data_str(data, "mod", "Modulation", NULL, "ASK");
        data = data_dbl(data, "freq", "Freq", "%.3f MHz", pd->freq1_hz / 1000000.0);
    }
    data = data_dbl(data, "rssi", "RSSI", "%.1f dB", pd->rssi_db);
    data = data_dbl(data, "snr", "SNR", "%.1f dB", pd->snr_db);
    data = data_dbl(data, "noise", "Noise", "%.1f dB", pd->noise_db);
    size_t n = data_print_jsons(data, r->msg, sizeof(r->msg));
    if (n > 0 && n < sizeof(r->msg) - 1)
        append(r, r->msg, strlen(r->msg));
    data_free(data);
    r->events++;
}

/* from r_api.c */
static void calc_rssi_snr(r433_t *r, pulse_data_t *pulse_data)
{
    float ook_high_estimate = pulse_data->ook_high_estimate > 0 ? pulse_data->ook_high_estimate : 1;
    float ook_low_estimate  = pulse_data->ook_low_estimate > 0 ? pulse_data->ook_low_estimate : 1;
    float asnr              = ook_high_estimate / ook_low_estimate;
    float foffs1            = (float)pulse_data->fsk_f1_est / INT16_MAX * r->samp_rate / 2.0f;
    float foffs2            = (float)pulse_data->fsk_f2_est / INT16_MAX * r->samp_rate / 2.0f;
    pulse_data->freq1_hz      = foffs1 + r->center_freq;
    pulse_data->freq2_hz      = foffs2 + r->center_freq;
    pulse_data->centerfreq_hz = r->center_freq;
    pulse_data->depth_bits    = 8;
    // amplitude (CU8): 10x because it's squares
    pulse_data->range_db = 42.1442f;
    pulse_data->rssi_db  = 10.0f * log10f(ook_high_estimate) - 42.1442f;
    pulse_data->noise_db = 10.0f * log10f(ook_low_estimate) - 42.1442f;
    pulse_data->snr_db   = 10.0f * log10f(asnr);
}

/* from r_api.c: run all decoders of each priority, stop once one produces an event */
static int run_demods(list_t *r_devs, pulse_data_t *pulse_data, int fsk)
{
    int p_events = 0;
    unsigned next_priority = 0;
    for (unsigned priority = 0; !p_events && priority < UINT_MAX; priority = next_priority) {
        next_priority = UINT_MAX;
        for (void **iter = r_devs->elems; iter && *iter; ++iter) {
            r_device *r_dev = *iter;
            if (r_dev->priority > priority && r_dev->priority < next_priority)
                next_priority = r_dev->priority;
            if (r_dev->priority != priority)
                continue;
            if (!fsk) {
                switch (r_dev->modulation) {
                case OOK_PULSE_PCM: p_events += pulse_slicer_pcm(pulse_data, r_dev); break;
                case OOK_PULSE_PPM: p_events += pulse_slicer_ppm(pulse_data, r_dev); break;
                case OOK_PULSE_PWM: p_events += pulse_slicer_pwm(pulse_data, r_dev); break;
                case OOK_PULSE_MANCHESTER_ZEROBIT: p_events += pulse_slicer_manchester_zerobit(pulse_data, r_dev); break;
                case OOK_PULSE_PIWM_RAW: p_events += pulse_slicer_piwm_raw(pulse_data, r_dev); break;
                case OOK_PULSE_PIWM_DC: p_events += pulse_slicer_piwm_dc(pulse_data, r_dev); break;
                case OOK_PULSE_DMC: p_events += pulse_slicer_dmc(pulse_data, r_dev); break;
                case OOK_PULSE_PWM_OSV1: p_events += pulse_slicer_osv1(pulse_data, r_dev); break;
                case OOK_PULSE_NRZS: p_events += pulse_slicer_nrzs(pulse_data, r_dev); break;
                default: break;
                }
            }
            else {
                switch (r_dev->modulation) {
                case FSK_PULSE_PCM: p_events += pulse_slicer_pcm(pulse_data, r_dev); break;
                case FSK_PULSE_PWM: p_events += pulse_slicer_pwm(pulse_data, r_dev); break;
                case FSK_PULSE_MANCHESTER_ZEROBIT: p_events += pulse_slicer_manchester_zerobit(pulse_data, r_dev); break;
                default: break;
                }
            }
        }
    }
    return p_events;
}

r433_t *r433_create(uint32_t samp_rate)
{
    r433_t *r = calloc(1, sizeof(*r));
    if (!r) return NULL;
    r_logger_set_log_handler(quiet_log, NULL);
    baseband_init();
    r->samp_rate = samp_rate;
    r->min_level = -12.1442f; // rtl_433's defaults
    r->min_snr   = 9.0f;
    r->temp = malloc(CHUNK * sizeof(*r->temp));
    r->am   = malloc(CHUNK * sizeof(*r->am));
    r->fm   = malloc(CHUNK * sizeof(*r->fm));
    r->pulse_detect = pulse_detect_create();
    if (!r->temp || !r->am || !r->fm || !r->pulse_detect) {
        r433_free(r);
        return NULL;
    }
    pulse_detect_set_levels(r->pulse_detect, 0, 0.0f, r->min_level, r->min_snr, LOG_WARNING);

    r_device templates[] = {
#define DECL(name) name,
            DEVICES
#undef DECL
    };
    unsigned num = sizeof(templates) / sizeof(*templates);
    list_ensure_size(&r->devs, num);
    for (unsigned i = 0; i < num; i++) {
        if (templates[i].disabled) continue; // like rtl_433 with no -R options
        templates[i].protocol_num = i + 1;
        r_device *p;
        if (templates[i].create_fn) {
            p = templates[i].create_fn(NULL);
            if (!p) continue;
            p->protocol_num = i + 1;
        }
        else {
            p = malloc(sizeof(*p));
            if (!p) continue;
            *p = templates[i];
        }
        p->verbose = 0;
        p->verbose_bits = 0;
        p->log_fn = drop_log;
        p->output_fn = on_output;
        p->output_ctx = r;
        if (p->modulation >= FSK_DEMOD_MIN_VAL) r->enable_fm = 1;
        list_push(&r->devs, p);
    }
    r433_reset(r, 433920000);
    return r;
}

static void free_dev(void *p)
{
    r_device *d = p;
    free(d->decode_ctx);
    free(d);
}

void r433_free(r433_t *r)
{
    if (!r) return;
    list_free_elems(&r->devs, free_dev);
    if (r->pulse_detect) pulse_detect_free(r->pulse_detect);
    free(r->temp);
    free(r->am);
    free(r->fm);
    free(r->out);
    free(r);
}

void r433_reset(r433_t *r, uint32_t center_freq)
{
    r->center_freq = center_freq;
    r->noise_level = 0.0f;
    baseband_low_pass_filter_reset(&r->lowpass);
    baseband_demod_FM_reset(&r->fm_state);
    pulse_detect_reset(r->pulse_detect);
}

static void process_chunk(r433_t *r, uint8_t const *iq, unsigned n)
{
    float avg_db = envelope_detect(iq, r->temp, n);
    if (r->noise_level == 0.0f) r->noise_level = r->min_level - 3.0f;
    if (avg_db < r->noise_level + 3.0f)
        r->noise_level = (r->noise_level * 7 + avg_db) / 8; // fast fall over 8 buffers
    else
        r->noise_level = (r->noise_level * 31 + avg_db) / 32; // slow rise over 32 buffers
    baseband_low_pass_filter(&r->lowpass, r->temp, r->am, n);

    unsigned fpdm = r->center_freq > FSK_PULSE_DETECTOR_LIMIT ? FSK_PULSE_DETECT_NEW : FSK_PULSE_DETECT_OLD;
    if (r->enable_fm)
        baseband_demod_FM(&r->fm_state, iq, r->fm, n, r->samp_rate, fpdm ? 0.2f : 0.1f);

    int package_type = PULSE_DATA_OOK;
    while (package_type) {
        package_type = pulse_detect_package(r->pulse_detect, r->am, r->fm, n, r->samp_rate, r->input_pos,
                &r->pulse_data, &r->fsk_pulse_data, fpdm);
        if (package_type == PULSE_DATA_OOK) {
            calc_rssi_snr(r, &r->pulse_data);
            r->fsk_active = 0;
            run_demods(&r->devs, &r->pulse_data, 0);
        }
        else if (package_type == PULSE_DATA_FSK) {
            calc_rssi_snr(r, &r->fsk_pulse_data);
            r->fsk_active = 1;
            run_demods(&r->devs, &r->fsk_pulse_data, 1);
        }
    }
    r->input_pos += n;
}

int r433_process(r433_t *r, uint8_t const *iq, unsigned n_samples)
{
    int before = r->events;
    while (n_samples) {
        unsigned n = n_samples < CHUNK ? n_samples : CHUNK;
        process_chunk(r, iq, n);
        iq += 2 * n;
        n_samples -= n;
    }
    return r->events - before;
}

char const *r433_take(r433_t *r, size_t *len)
{
    *len = r->out_len;
    r->out_len = 0;
    return r->out ? r->out : "";
}

unsigned r433_decoders(r433_t const *r)
{
    return (unsigned)r->devs.len;
}
