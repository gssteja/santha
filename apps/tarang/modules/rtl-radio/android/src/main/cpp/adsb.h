// ADS-B / Mode S receiver for 2.4 MS/s blocks at 1090 MHz: demodulation, CRC checking with single-bit repair,
// message decoding (identification, positions, velocities, altitude and squawk replies) and an aircraft table.
// The demodulator follows dump1090-fa's 2.4 MHz phase-correlation design; decoding follows the Mode S / DO-260
// message formats (see "The 1090 Megahertz Riddle", Junzi Sun).
#pragma once

#include <cstddef>
#include <cstdint>
#include <unordered_map>
#include <vector>

namespace tarang {

struct Aircraft {
  uint32_t addr = 0;
  bool nonIcao = false; // DF18 anonymous / TIS-B track address
  char callsign[9] = {0};
  int category = 0;           // e.g. 0xA3 (set A, category 3); 0 = unknown
  int altitude = INT32_MIN;   // barometric, ft
  int gnssAltitude = INT32_MIN;
  int squawk = -1;            // octal digits as hex nibbles (7700 -> 0x7700)
  int emergency = 0;
  double lat = 0, lon = 0;
  bool hasPos = false;
  bool onGround = false;
  float gs = -1, track = -1, heading = -1; // kt, degrees
  int vr = INT32_MIN;                      // ft/min
  float rssi = -99;                        // dBFS, smoothed
  uint32_t messages = 0;
  int64_t seenMs = 0, posMs = 0;
  int64_t confirmedMs = 0; // last DF11/17/18 with a good CRC: lets address/parity replies through
  // CPR halves waiting for their partner
  int cprLat[2] = {0, 0}, cprLon[2] = {0, 0};
  int64_t cprMs[2] = {0, 0};
  bool cprSurface[2] = {false, false};
  int posRejects = 0;
};

// One aircraft in the snapshot buffer (little-endian, 88 bytes).
struct AircraftRecord {
  int32_t addr;
  int32_t flags; // bit0 hasPos, 1 onGround, 2 nonIcao, 3 hasAlt, 4 hasGs, 5 hasTrack, 6 hasVr, 7 hasSquawk, 8 hasGnssAlt
  double lat, lon;
  int32_t altitude, gnssAltitude;
  float gs, track, heading;
  int32_t vr, squawk, emergency, category;
  float rssi;
  int32_t messages;
  int32_t seenAgoMs, posAgoMs;
  char callsign[8];
};
static_assert(sizeof(AircraftRecord) == 88, "record layout is shared with Kotlin (dsp/Decoders.kt)");
static_assert(offsetof(AircraftRecord, squawk) == 48 && offsetof(AircraftRecord, rssi) == 60 &&
                  offsetof(AircraftRecord, posAgoMs) == 72 && offsetof(AircraftRecord, callsign) == 76,
              "record layout is shared with Kotlin (dsp/Decoders.kt)");

class Adsb {
 public:
  static constexpr int FS = 2'400'000;

  Adsb();

  // Receiver position for local CPR decoding and range checks.
  void setReceiver(double lat, double lon);
  void clearReceiver() { hasRx_ = false; }

  // [n] interleaved uint8 I/Q samples. Returns the number of messages accepted.
  int process(const uint8_t* iq, int n, int64_t nowMs);

  // Drops aircraft not heard for a minute, then writes up to [max] records. Returns the count written.
  int snapshot(AircraftRecord* out, int max, int64_t nowMs);

  uint64_t messages() const { return messages_; }
  uint64_t preambles() const { return preambles_; }
  int tracked() const { return static_cast<int>(aircraft_.size()); }

  // Exposed for the host tests.
  static uint32_t checksum(const uint8_t* msg, int bits);
  bool decode(const uint8_t* msg, int bits, int64_t nowMs, float rssi);

 private:
  int score(const uint8_t* msg, int bits, int* fixBit) const;
  bool known(uint32_t addr, int64_t nowMs) const;
  Aircraft& get(uint32_t addr, int64_t nowMs);
  void decodeExtendedSquitter(Aircraft& a, const uint8_t* msg, int64_t nowMs);
  void updatePosition(Aircraft& a, bool odd, int lat, int lon, bool surface, int64_t nowMs);
  bool acceptPosition(Aircraft& a, double lat, double lon, int64_t nowMs);

  std::vector<uint16_t> mag_;   // magnitude, with the tail of the previous block in front
  int carry_ = 0;               // samples carried over from the previous block
  int64_t lastNow_ = 0;
  std::unordered_map<uint32_t, Aircraft> aircraft_;
  bool hasRx_ = false;
  double rxLat_ = 0, rxLon_ = 0;
  uint64_t messages_ = 0, preambles_ = 0;
};

}  // namespace tarang
