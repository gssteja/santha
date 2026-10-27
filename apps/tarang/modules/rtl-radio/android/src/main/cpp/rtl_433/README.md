# rtl_433 (vendored subset)

The device decoders and pulse pipeline from [rtl_433](https://github.com/merbanan/rtl_433), release **25.12**
(commit ea7d504877df751a202432d47dbb0c425ab0a93c), unmodified. GPL-2.0-or-later, see COPYING.

Only what decoding needs is copied: the core sources in `src/` (no SDR input, HTTP server, MQTT or other outputs),
every decoder in `src/devices/`, and the headers they include. `../r433.c` replaces rtl_433.c's sample callback.

To update: copy the same files from a newer release, then add any new core sources the decoders need.
