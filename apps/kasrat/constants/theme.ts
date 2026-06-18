import type { ViewStyle } from 'react-native';

export const C = {
  bg: '#0e0c09',
  surface: '#161310',
  surface2: '#1e1915',
  border: '#2a231a',
  text: '#f5f0e8',
  text2: '#a09585',
  text3: '#5e5045',
  accent: '#f59e0b',
  accent2: '#d97706',
  green: '#22c55e',
  red: '#ef4444',
} as const;

export const F = {
  xs: 11,
  sm: 13,
  base: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  xxxl: 30,
} as const;

// ── Ember & Iron design system ──────────────────────────────────────────────
// Effort is rendered as heat: a lift glows hotter the harder it is. One scale
// drives the RPE pips, the e1RM glow, and the PR bloom.
export const HEAT = {
  cool: '#b45309',  // RPE ≤6 — dull ember
  warm: '#f59e0b',  // RPE 7–8 — working heat (== accent)
  hot: '#ff5e1a',   // RPE 9 — near failure
  white: '#ffe8c2', // RPE 10 / PR — white-hot
  ash: '#5e5045',   // cold / inactive (== text3)
} as const;

// Map a program/target RPE ("8", "7-8", "9-10", "10") to a heat color (upper bound wins).
export function heatForRpe(rpe?: string | number): string {
  if (rpe === undefined || rpe === null || rpe === '') return HEAT.warm;
  const nums = String(rpe).match(/\d+/g)?.map(Number) ?? [];
  const v = nums.length ? Math.max(...nums) : 0;
  if (v <= 0) return HEAT.warm;
  if (v <= 6) return HEAT.cool;
  if (v <= 8) return HEAT.warm;
  if (v === 9) return HEAT.hot;
  return HEAT.white;
}

// Map a 0..1 effort fraction (e.g. live e1RM vs all-time best) to a heat color.
export function heatForFraction(t: number): string {
  if (t >= 1) return HEAT.white;
  if (t >= 0.92) return HEAT.hot;
  if (t >= 0.75) return HEAT.warm;
  return HEAT.cool;
}

// Archivo superfamily — forged, stamped-steel numerals + a clean grotesque body.
// Loaded in app/_layout.tsx via @expo-google-fonts/archivo (JS-bundled TTFs).
export const FONT = {
  black: 'Archivo_900Black',
  xbold: 'Archivo_800ExtraBold',
  bold: 'Archivo_700Bold',
  semi: 'Archivo_600SemiBold',
  medium: 'Archivo_500Medium',
  regular: 'Archivo_400Regular',
} as const;

export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

export const SHADOW: Record<'card' | 'ember', ViewStyle> = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  ember: {
    shadowColor: HEAT.hot,
    shadowOpacity: 0.55,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
};
