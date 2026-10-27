cmake_minimum_required(VERSION 3.22.1)
project(tarangdsp C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# rtl_433's pulse pipeline and device decoders (vendored, see rtl_433/README.md), as plain C: no fast-math,
# since some decoders rely on exact IEEE float behaviour.
file(GLOB R433_DEVICES CONFIGURE_DEPENDS rtl_433/src/devices/*.c)
add_library(r433 STATIC
    r433.c
    rtl_433/src/abuf.c
    rtl_433/src/baseband.c
    rtl_433/src/bit_util.c
    rtl_433/src/bitbuffer.c
    rtl_433/src/compat_time.c
    rtl_433/src/data.c
    rtl_433/src/decoder_util.c
    rtl_433/src/list.c
    rtl_433/src/logger.c
    rtl_433/src/optparse.c
    rtl_433/src/pulse_data.c
    rtl_433/src/pulse_detect.c
    rtl_433/src/pulse_detect_fsk.c
    rtl_433/src/pulse_slicer.c
    rtl_433/src/r_util.c
    rtl_433/src/rfraw.c
    ${R433_DEVICES})
target_include_directories(r433 PUBLIC rtl_433/include .)
target_compile_definitions(r433 PRIVATE _GNU_SOURCE NDEBUG)
target_compile_options(r433 PRIVATE -O2 -w -ffunction-sections -fdata-sections -fvisibility=hidden)
set_target_properties(r433 PROPERTIES POSITION_INDEPENDENT_CODE ON)

add_library(tarangdsp SHARED dsp.cpp rds.cpp adsb.cpp jni.cpp)

# -ffast-math lets clang reassociate the FIR dot products into NEON vector reductions.
target_compile_options(tarangdsp PRIVATE -O3 -ffast-math -fno-exceptions -fno-rtti -Wall)
target_link_libraries(tarangdsp PRIVATE r433 m)
target_link_options(tarangdsp PRIVATE -Wl,--gc-sections -Wl,-z,max-page-size=16384)
