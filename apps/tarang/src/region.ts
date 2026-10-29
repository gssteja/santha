// Where in the world the radio is: picks the presets, the band plan used to label survey peaks, FM de-emphasis,
// the rtl_433 sensor bands and the APRS / ACARS / NOAA decoders. "auto" follows the phone's location.
import { requireNativeModule } from 'expo-modules-core';
import { useSyncExternalStore } from 'react';

import { Radio } from '../modules/rtl-radio';
import raw from './regions.json';

export type RegionId = 'US' | 'QA' | 'IN';

export type Region = {
  id: RegionId;
  name: string;
  short: string;
  /** [west, south, east, north] boxes that pick this region from a location */
  boxes: [number, number, number, number][];
  home: [number, number];
  home_name: string;
  deemph_us: number;
  /** broadcast FM edges, MHz */
  fm: [number, number];
  sensor_bands: number[];
  /** [lo MHz, hi MHz, channel width MHz, first channel, US-style pilot] */
  tv: [number, number, number, number, boolean][];
  bands: [number, number, string][];
  aprs_hz: number[];
  acars_hz: number[];
  noaa: boolean;
};

const table = raw as unknown as Record<string, Omit<Region, 'id'>>;
export const REGIONS = Object.fromEntries(
  Object.entries(table)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => [k, { ...v, id: k as RegionId }]),
) as Record<RegionId, Region>;
export const REGION_IDS = Object.keys(REGIONS) as RegionId[];

// persisted natively so it is known before the first render: "US" (fixed), or "auto" / "auto:IN" (last detected)
const native = requireNativeModule<{ getRegion(): string; saveRegion(v: string): void }>('RtlRadioMap');

type Snapshot = { region: Region; auto: boolean };

function parse(v: string): Snapshot {
  const [mode, last] = v.split(':');
  if (mode !== 'auto' && mode in REGIONS) return { region: REGIONS[mode as RegionId], auto: false };
  return { region: REGIONS[(last in REGIONS ? last : 'US') as RegionId], auto: true };
}

let snap: Snapshot = parse(native.getRegion() || 'auto');
const listeners = new Set<() => void>();

function apply() {
  const r = snap.region;
  Radio.setRegion(r.deemph_us, r.sensor_bands);
  Radio.setRegionDecoders(r.aprs_hz, r.acars_hz, r.noaa);
}

function set(next: Snapshot) {
  const changed = next.region.id !== snap.region.id || next.auto !== snap.auto;
  snap = next;
  native.saveRegion(next.auto ? `auto:${next.region.id}` : next.region.id);
  if (!changed) return;
  apply();
  for (const l of listeners) l();
}

export const getRegion = (): Region => snap.region;
export const isAuto = (): boolean => snap.auto;

/** Fix the region, or pass "auto" to follow the phone's location. */
export function chooseRegion(id: RegionId | 'auto') {
  if (id === 'auto') {
    set({ region: snap.region, auto: true });
    const rx = Radio.getState().receiver;
    if (rx) noteLocation(rx.lat, rx.lon);
  } else set({ region: REGIONS[id], auto: false });
}

export function regionAt(lat: number, lon: number): Region | null {
  for (const id of REGION_IDS) {
    if (REGIONS[id].boxes.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n)) return REGIONS[id];
  }
  return null;
}

/** A fresh location: in auto mode, switch to the region it falls in (anywhere unknown keeps the last one). */
export function noteLocation(lat: number, lon: number) {
  if (!snap.auto) return;
  const r = regionAt(lat, lon);
  if (r) set({ region: r, auto: true });
}

/** Ask for the location now (prompts for permission the first time). */
export async function detectRegion(): Promise<Region | null> {
  const loc = await Radio.locate(true).catch(() => null);
  if (!loc) return null;
  noteLocation(loc.lat, loc.lon);
  return regionAt(loc.lat, loc.lon);
}

export function onRegionChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useRegion(): Snapshot {
  return useSyncExternalStore(onRegionChange, () => snap);
}

// the engine starts with US values; give it ours, then follow the last known location
apply();
{
  const rx = Radio.getState().receiver;
  if (rx) noteLocation(rx.lat, rx.lon);
}
