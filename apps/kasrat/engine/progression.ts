// Adaptive layer — reads logged history and SUGGESTS; never mutates the program.
import type { WorkoutRecord, WorkoutSet } from '@/types';
import { isHeavyWeek } from '@/store/programs';
import { bestE1RM, roundTo } from './strength';

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Most recent logged sets for an exercise; phase-matched (heavy/light) when waved.
function lastSetsFor(history: WorkoutRecord[], name: string, week: number, waved: boolean): WorkoutSet[] {
  for (const rec of history) {
    if (waved && rec.week !== undefined && isHeavyWeek(rec.week) !== isHeavyWeek(week)) continue;
    const ex = rec.exerciseData?.find(e => eq(e.name, name));
    if (ex && ex.sets.length) return ex.sets;
  }
  return [];
}

export type LoadSuggestion = { weight: number; reason: string } | null;

// Double-progression load pick from the last phase-matched session, nudged by readiness.
// readiness: -1 beat-up · 0 normal · 1 fresh. step defaults to 5 (lb).
export function suggestLoad(opts: {
  history: WorkoutRecord[];
  name: string;
  targetReps: number;
  week: number;
  waved: boolean;
  step?: number;
  readiness?: number;
}): LoadSuggestion {
  const { history, name, targetReps, week, waved, step = 5, readiness = 0 } = opts;
  const sets = lastSetsFor(history, name, week, waved).filter(s => !s.drop);
  let top: { w: number; r: number } | null = null;
  for (const s of sets) {
    const w = Math.max(0, parseFloat(s.weight) || 0);
    const r = parseInt(s.reps) || 0;
    if (w <= 0 || r <= 0) continue;
    if (!top || w > top.w) top = { w, r };
  }
  if (!top) return null;

  const met = targetReps > 0 ? top.r >= targetReps : true;
  let weight = top.w;
  if (met && readiness >= 0) weight = top.w + step;            // earned progression
  else if (!met && readiness < 0) weight = Math.max(0, top.w - step); // beat-up + missed → back off
  weight = roundTo(weight, step);

  const reason = met
    ? readiness < 0
      ? `hit ${top.r} — holding (low readiness)`
      : `hit ${top.r}≥${targetReps} — +${step}`
    : readiness < 0
      ? `missed ${targetReps}, beat-up — −${step}`
      : `missed ${targetReps} — hold`;
  return { weight, reason };
}

export type DeloadFlag = { sessions: number; reason: string } | null;

// Flags a stall: no new e1RM high across the last 3 sessions containing the lift.
export function detectDeload(history: WorkoutRecord[], name: string): DeloadFlag {
  const orms: number[] = [];
  for (const rec of history) {
    const ex = rec.exerciseData?.find(e => eq(e.name, name));
    if (!ex) continue;
    const best = bestE1RM(ex.sets);
    if (best) orms.push(best.orm);
    if (orms.length >= 3) break;
  }
  if (orms.length < 3) return null;
  const [newest, ...rest] = orms;
  if (newest <= Math.max(...rest) + 0.01) {
    return { sessions: 3, reason: 'no new high in 3 sessions' };
  }
  return null;
}

export type PREntry = { name: string; orm: number; weight: string; reps: string; date: string };

// Sessions where a lift beat its prior all-time e1RM, most recent first.
// The first time a lift appears is a baseline, not a PR.
export function recentPRs(history: WorkoutRecord[], limit = 6): PREntry[] {
  const chrono = [...history].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const best: Record<string, number> = {};
  const prs: PREntry[] = [];
  for (const rec of chrono) {
    for (const ex of rec.exerciseData ?? []) {
      const b = bestE1RM(ex.sets);
      if (!b) continue;
      const key = ex.name.toLowerCase();
      if (best[key] === undefined) {
        best[key] = b.orm;
        continue;
      }
      if (b.orm > best[key] + 0.01) {
        best[key] = b.orm;
        prs.push({ name: ex.name, orm: b.orm, weight: b.weight, reps: b.reps, date: rec.date });
      }
    }
  }
  return prs.reverse().slice(0, limit);
}
