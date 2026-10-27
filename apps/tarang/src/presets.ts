import type { Mode, ScanChannel } from '../modules/rtl-radio';
import raw from './presets.json';

export type Group = {
  id: string;
  name: string;
  mode: Mode;
  bw: number;
  desc: string;
  squelch?: number;
  survey?: boolean;
  range?: [number, number, number];
  /** fixed channel list (absent for whole-band groups) */
  channels?: { f: number; label: string }[];
  /** what a scan steps through */
  scanChannels: ScanChannel[];
};

type RawGroup = Omit<Group, 'channels' | 'scanChannels'> & { channels?: { f: number; label: string }[] };

export const GROUPS: Group[] = (raw as RawGroup[]).map((g) => {
  let scanChannels: ScanChannel[];
  let channels: Group['channels'];
  if (g.range) {
    const [start, stop, step] = g.range;
    const count = Math.round((stop - start) / step) + 1;
    scanChannels = Array.from({ length: count }, (_, i) => ({ f: Math.round((start + i * step) * 1e6), label: '' }));
  } else {
    channels = (g.channels ?? []).map((c) => ({ f: Math.round(c.f * 1e6), label: c.label }));
    scanChannels = channels;
  }
  return { ...g, channels, scanChannels: scanChannels.map((c) => ({ ...c, mode: g.mode, bw: g.bw })) };
});

const labels = new Map<number, string>();
for (const g of GROUPS) for (const c of g.channels ?? []) labels.set(c.f, c.label);

export function presetLabel(f: number): string {
  for (const [cf, l] of labels) if (Math.abs(cf - f) < 1000) return l;
  return '';
}
