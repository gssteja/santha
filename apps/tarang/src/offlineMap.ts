// The offline vector map for the plane tab: cut on the phone from a Protomaps planet build (MapDownloader.kt) into
// one PMTiles archive per area in modules/rtl-radio/android/src/main/assets/maps/areas.json.
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

export type MapStatus = {
  installed: boolean;
  any: boolean;
  build: string | null;
  bytes: number;
  running: boolean;
  areas: { name: string; file: string; done: boolean }[];
};
export type MapProgress = { phase: string; done: number; total: number };

type Native = {
  offlineMaps(): MapStatus | null;
  downloadOfflineMaps(): Promise<MapStatus>;
  cancelMapDownload(): void;
  deleteOfflineMaps(): void;
  addListener(event: 'onMapDownload', l: (p: MapProgress) => void): EventSubscription;
};

const native = requireNativeModule<Native>('RtlRadioMap');

/** Rough download size of every area, for the confirmation prompt. */
export const MAP_DOWNLOAD_MB = 265;

export const OfflineMaps = {
  status: () => native.offlineMaps(),
  download: () => native.downloadOfflineMaps(),
  cancel: () => native.cancelMapDownload(),
  remove: () => native.deleteOfflineMaps(),
  onProgress: (l: (p: MapProgress) => void) => native.addListener('onMapDownload', l),
};
