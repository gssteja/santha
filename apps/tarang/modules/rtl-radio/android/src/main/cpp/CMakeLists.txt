cmake_minimum_required(VERSION 3.22.1)
project(tarangdsp CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(tarangdsp SHARED dsp.cpp rds.cpp jni.cpp)

# -ffast-math lets clang reassociate the FIR dot products into NEON vector reductions.
target_compile_options(tarangdsp PRIVATE -O3 -ffast-math -fno-exceptions -fno-rtti -Wall)
target_link_options(tarangdsp PRIVATE -Wl,--gc-sections -Wl,-z,max-page-size=16384)
