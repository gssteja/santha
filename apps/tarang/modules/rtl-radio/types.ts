export type Mode = 'AM' | 'NFM' | 'WFM' | 'USB' | 'LSB' | 'CW';

export type Favorite = { f: number; mode: Mode; bw: number; label: string };

export type Hit = { t: number; f: number; mode: Mode; bw: number; label: string; snr: number; group: string };

export type Survey = { t: number; stations: { f: number; snr: number }[] };

export type VfoB = { freq: number; mode: Mode; bw: number; squelch: number; label: string; snr: number; open: boolean; inView: boolean };

export type SweepPeak = { f: number; snr: number; width: number; mode: Mode; label: string };

export type SweepResult = { t: number; start: number; stop: number; step: number; peaks: SweepPeak[] };

export type Recording = { id: string; name: string; seconds: number };

export type RadioState = {
  running: boolean;
  status: 'off' | 'starting' | 'radio' | 'error';
  error: string;
  needsPermission: boolean;
  device: string;
  freq: number;
  hwCenter: number | null;
  mode: Mode;
  bw: number;
  label: string;
  squelch: number;
  gain: number | null;
  gains: number[];
  ppm: number;
  stereo: boolean;
  nr: boolean;
  stereoActive: boolean;
  directSampling: boolean;
  snr: number;
  open: boolean;
  noise: number;
  vfoB: VfoB | null;
  recording: { name: string; seconds: number } | null;
  scan: { state: 'search' | 'hold' | 'survey' | 'sweep'; group: string; name: string; progress: string; ignored: number } | null;
  rds: { pi: string; ps: string; rt: string; pty: string; synced: boolean; groups: number } | null;
  stats: { blocks: number; msPerBlock: number; bytesIn: number; dropped: number; streaming: boolean };
  listsVersion: number;
  hits: Hit[];
  favorites: Favorite[];
  survey: Record<string, Survey>;
  rdsNames: Record<string, string>;
  sweep: SweepResult | null;
  recordings: Recording[];
};

export type ScanChannel = { f: number; label?: string; mode?: Mode; bw?: number };

export type RadioCommand =
  | { action: 'tune'; f: number; mode?: Mode; bw?: number; label?: string }
  | { action: 'mode'; mode: Mode }
  | { action: 'bw'; bw: number }
  | { action: 'squelch'; db: number }
  | { action: 'gain'; db: number | null }
  | { action: 'ppm'; ppm: number }
  | { action: 'stereo'; on: boolean }
  | { action: 'nr'; on: boolean }
  | { action: 'scan' | 'survey'; group: string; name: string; mode: Mode; channels: ScanChannel[]; threshold?: number }
  | { action: 'scan_stop' | 'scan_skip' | 'scan_ignore' | 'scan_stay' | 'strongest' | 'vfo_b_off' | 'swap' }
  | { action: 'vfo_b'; f: number; mode?: Mode; bw?: number; squelch?: number; label?: string }
  | { action: 'vfo_b_squelch'; db: number }
  | { action: 'record'; on: boolean }
  | { action: 'sweep'; start: number; stop: number }
  | { action: 'fav_add'; f: number; mode: Mode; bw: number; label?: string }
  | { action: 'fav_remove'; f: number };
