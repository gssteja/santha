#!/bin/bash
# Host tests for the P25 decoder (cpp/p25*.cpp) on synthetic signals. The vocoder (mbelib) isn't linked:
# test_vocoder.cpp stands in for p25voice.cpp and records the vocoder frames the decoder hands over.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
CPP="$DIR/../../android/src/main/cpp"
OUT="${TMPDIR:-/tmp}/tarang-p25-tests"
mkdir -p "$OUT"
SRC="$CPP/p25fec.cpp"
for f in p25demod.cpp p25p1.cpp p25p2.cpp p25trunk.cpp p25.cpp; do [ -f "$CPP/$f" ] && SRC="$SRC $CPP/$f"; done
# Xcode's toolchain: the Command Line Tools linker can't read the newest macOS SDK stubs
XC=/Applications/Xcode.app/Contents/Developer
if [ -x "$XC/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++" ]; then
  CXX=("$XC/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++" -isysroot "$XC/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk")
else
  CXX=(clang++)
fi
"${CXX[@]}" -std=c++17 -O2 -ffast-math -Wall -Wno-unused-function -I"$CPP" -I"$DIR" $SRC "$DIR"/*_test.cpp "$DIR/main.cpp" "$DIR/test_vocoder.cpp" -o "$OUT/p25tests"
"$OUT/p25tests" "$@"
