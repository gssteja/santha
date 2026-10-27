import type { Mode } from '../modules/rtl-radio';

export function fmtMHz(hz: number): string {
  let s = (hz / 1e6).toFixed(4);
  if (s.endsWith('0')) s = s.slice(0, -1);
  return s;
}

export const MODES: Mode[] = ['AM', 'NFM', 'WFM', 'USB', 'LSB', 'CW'];

/** Tap/step grid per mode: airband 25 kHz, narrowband 5 kHz, broadcast FM 100 kHz, SSB 500 Hz, CW 100 Hz. */
export const SNAP: Record<Mode, number> = { AM: 25000, NFM: 5000, WFM: 100000, USB: 500, LSB: 500, CW: 100 };
/** Finer grid while dragging on the waterfall. */
export const FINE_SNAP: Record<Mode, number> = { AM: 1000, NFM: 500, WFM: 10000, USB: 50, LSB: 50, CW: 10 };

export const DEFAULT_BW: Record<Mode, number> = { AM: 8000, NFM: 12500, WFM: 200000, USB: 2800, LSB: 2800, CW: 500 };

const HAM_LSB = [[1.8e6, 2.0e6], [3.5e6, 4.0e6], [7.0e6, 7.3e6]]; // ham convention: LSB below 10 MHz
const HAM_USB = [[14.0e6, 14.35e6], [18.068e6, 18.168e6], [21.0e6, 21.45e6], [24.89e6, 24.99e6], [28.0e6, 29.7e6]];

/** The usual modulation for a frequency, so tuning around picks a sensible mode. */
export function bandMode(f: number): Mode | null {
  if (HAM_LSB.some(([lo, hi]) => f >= lo && f < hi)) return 'LSB';
  if (HAM_USB.some(([lo, hi]) => f >= lo && f < hi)) return 'USB';
  if (f < 30e6) return 'AM'; // AM broadcast, shortwave, time stations, CB
  if (f >= 88e6 && f < 108e6) return 'WFM';
  if (f >= 108e6 && f < 137e6) return 'AM';
  if ((f >= 144e6 && f < 174e6) || (f >= 400e6 && f < 470e6)) return 'NFM';
  return null;
}

export const snap = (f: number, step: number) => Math.round(f / step) * step;

export function fmtBw(bw: number): string {
  if (bw < 1000) return `${bw} Hz`;
  return bw >= 100000 ? `${Math.round(bw / 1000)} kHz` : `${(bw / 1000).toFixed(1).replace(/\.0$/, '')} kHz`;
}

/** Bandwidth step for the − / + buttons. */
export const BW_STEP: Record<Mode, number> = { AM: 1000, NFM: 2500, WFM: 20000, USB: 200, LSB: 200, CW: 100 };

export function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
