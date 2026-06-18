// Plate-calculator math (lb). Pure.
export const DEFAULT_BAR = 45;
export const DEFAULT_PLATES = [45, 35, 25, 10, 5, 2.5];

export type PlateResult = {
  /** Plates to load on ONE side, heaviest first. */
  perSide: number[];
  /** Weight actually achievable with the available plates. */
  achieved: number;
  /** target − achieved (rounding leftover the plates can't make up). */
  leftover: number;
};

// Greedy plate breakdown per side for a target barbell weight.
export function platesPerSide(
  target: number,
  bar = DEFAULT_BAR,
  plates = DEFAULT_PLATES
): PlateResult {
  if (!isFinite(target) || target <= bar) {
    return { perSide: [], achieved: bar, leftover: Math.max(0, (target || 0) - bar) };
  }
  let perSideWeight = (target - bar) / 2;
  const perSide: number[] = [];
  for (const p of [...plates].sort((a, b) => b - a)) {
    while (perSideWeight >= p - 1e-9) {
      perSide.push(p);
      perSideWeight -= p;
    }
  }
  const loaded = perSide.reduce((a, b) => a + b, 0);
  const achieved = bar + loaded * 2;
  return { perSide, achieved, leftover: Math.round((target - achieved) * 100) / 100 };
}
