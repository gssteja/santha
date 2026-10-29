#!/bin/bash
# Builds and runs decode_file.cpp on a recording: ./decode_file.sh file.cu8 centerHz controlChannelHz...
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
CPP="$DIR/../../android/src/main/cpp"
OUT="${TMPDIR:-/tmp}/tarang-p25-tests"
mkdir -p "$OUT"
XC=/Applications/Xcode.app/Contents/Developer
if [ -x "$XC/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++" ]; then
  CXX=("$XC/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++" -isysroot "$XC/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk")
else
  CXX=(clang++)
fi
"${CXX[@]}" -std=c++17 -O2 -ffast-math -Wall -I"$CPP" -I"$DIR" "$CPP"/p25fec.cpp "$CPP"/p25demod.cpp "$CPP"/p25p1.cpp "$CPP"/p25p2.cpp \
  "$CPP"/p25trunk.cpp "$CPP"/p25.cpp "$DIR/test_vocoder.cpp" "$DIR/decode_file.cpp" -o "$OUT/p25file"
"$OUT/p25file" "$@"
