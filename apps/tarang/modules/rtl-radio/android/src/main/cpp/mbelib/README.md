# mbelib (vendored)

mbelib 1.3.0 by the mbelib author, ISC licence (see `COPYRIGHT`), from
https://github.com/szechyjs/mbelib at commit e2d84c12b41419b5a051d16b39e4510b4b552065 (tag v1.3.0).
Only the files Tarang needs are here, unmodified: the shared synthesis (`mbelib.c`), IMBE 7200x4400 (P25 Phase 1)
and AMBE 3600x2450 half rate (P25 Phase 2), plus `ecc.c`, which they reference.

Tarang doesn't use mbelib's FEC or deinterleaving: `../p25p1.cpp` and `../p25p2.cpp` correct and descramble the
frames themselves, and `../p25voice.cpp` hands the parameter bits to `mbe_processImbe4400Dataf` /
`mbe_processAmbe2450Dataf`.

Upstream's patent notice, kept as it was published:

> This source code is provided for educational purposes only. It is a written description of how certain voice
> encoding/decoding algorythims could be implemented. Executable objects compiled or derived from this package may
> be covered by one or more patents. Readers are strongly advised to check for any patent restrictions or
> licencing requirements before compiling or using this source code.
