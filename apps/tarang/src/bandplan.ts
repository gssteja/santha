// What a signal found by the band survey probably is, from the current region's band plan (src/regions.json).
// US (ATSC) TV pilots sit 0.31 MHz above a channel's lower edge, so a channel is named from the pilot's position;
// DVB-T elsewhere fills the whole channel.
import { getRegion } from './region';

export function bandName(f: number): string {
  const r = getRegion();
  const mhz = f / 1e6;
  for (const [lo, hi, width, first, pilot] of r.tv) {
    if (mhz >= lo && mhz < hi && (!pilot || (mhz - lo) % width < 0.5)) return `TV channel ${first + Math.floor((mhz - lo) / width)}`;
  }
  for (const [lo, hi, name] of r.bands) if (mhz >= lo && mhz < hi) return name;
  return '';
}
