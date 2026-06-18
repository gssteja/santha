// Pure strength math — framework-free so it's unit-testable in isolation.
// Canonical home for the 1RM formulas (re-exported from store/programs for back-compat).
import type { WorkoutSet } from '@/types';

export function epley1RM(weight: number, reps: number): number {
  if (reps <= 0) return weight;
  return weight * (1 + reps / 30);
}

export function brzycki1RM(weight: number, reps: number): number {
  if (reps <= 0) return weight;
  if (reps >= 37) return weight; // formula diverges past ~36 reps
  return weight * (36 / (37 - reps));
}

export function weightForReps(orm: number, reps: number): number {
  if (reps <= 0) return orm;
  return orm / (1 + reps / 30);
}

export function roundTo(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

// Best Epley e1RM across a set list. Negative weight clamps to 0 (assisted reps
// don't set records); blank/zero sets are ignored.
export function bestE1RM(
  sets: Pick<WorkoutSet, 'weight' | 'reps'>[]
): { orm: number; weight: string; reps: string } | null {
  let best: { orm: number; weight: string; reps: string } | null = null;
  for (const s of sets) {
    const w = Math.max(0, parseFloat(s.weight) || 0);
    const r = parseInt(s.reps) || 0;
    if (w <= 0 || r <= 0) continue;
    const orm = epley1RM(w, r);
    if (!best || orm > best.orm) best = { orm, weight: s.weight, reps: s.reps };
  }
  return best;
}
