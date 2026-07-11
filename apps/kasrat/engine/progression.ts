// Adaptive layer — reads logged history and SUGGESTS; never mutates the program.
import type { WorkoutRecord, WorkoutSet } from '@/types';
import { isHeavyWeek } from '@/store/programs';
import { bestE1RM, roundTo, setsVolume } from './strength';

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

export type StallFlag = { sessions: number; peakOrm: number; peakVol: number } | null;

// One (orm, vol) sample per session containing the lift, oldest→newest.
function liftSeries(history: WorkoutRecord[], name: string): { orm: number; vol: number }[] {
  const chrono = [...history].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const out: { orm: number; vol: number }[] = [];
  for (const rec of chrono) {
    const ex = rec.exerciseData?.find(e => eq(e.name, name));
    if (!ex) continue;
    const orm = bestE1RM(ex.sets)?.orm ?? 0;
    const vol = setsVolume(ex.sets, ex.perSide);
    if (orm <= 0 && vol <= 0) continue; // nothing loggable (e.g. bodyweight)
    out.push({ orm, vol });
  }
  return out;
}

// Flags a genuine plateau: the last `threshold` sessions all failed to set a new
// all-time high in EITHER e1RM or volume. Adding reps/sets/load in any form resets
// the streak — so we only nudge a deload when there's truly no progress on any front
// (the old check looked at e1RM alone and nagged whenever the top single held).
export function detectStall(history: WorkoutRecord[], name: string, threshold = 3): StallFlag {
  const series = liftSeries(history, name);
  if (series.length < threshold + 1) return null; // need a baseline + `threshold` flat sessions
  let peakOrm = 0;
  let peakVol = 0;
  let lastProgress = 0; // index of the most recent session that set a new high (baseline counts)
  series.forEach((s, i) => {
    const advanced = i === 0 || s.orm > peakOrm + 0.01 || s.vol > peakVol + 0.01;
    if (s.orm > peakOrm) peakOrm = s.orm;
    if (s.vol > peakVol) peakVol = s.vol;
    if (advanced) lastProgress = i;
  });
  const streak = series.length - 1 - lastProgress;
  if (streak < threshold) return null;
  return { sessions: streak, peakOrm, peakVol };
}

// Deterministic, data-derived deload line — reflects the actual stall (lift, streak,
// peak e1RM) with a concrete next step. No canned/random copy.
export function deloadMessage(name: string, flag: StallFlag): string | null {
  if (!flag) return null;
  const short = name.split(/[(—]/)[0].trim();
  const peak = Math.round(flag.peakOrm);
  return peak > 0
    ? `${short}: stuck ${flag.sessions} sessions at ~${peak} lb e1RM — no extra volume either. Deload ~10% or add a set to break it.`
    : `${short}: no new high in ${flag.sessions} sessions. Deload ~10% or add a set to break it.`;
}

export type PRKind = 'strength' | 'volume' | 'both';
export type PREntry = {
  name: string;
  orm: number;
  weight: string;
  reps: string;
  volume: number;
  date: string;
  kind: PRKind;
};

// Sessions where a lift beat its prior all-time best on e1RM OR total volume,
// most recent first. Volume counts because more work done is real progress even
// when the top single is unchanged. The first time a lift appears is a baseline.
export function recentPRs(history: WorkoutRecord[], limit = 6): PREntry[] {
  const chrono = [...history].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const bestOrm: Record<string, number> = {};
  const bestVol: Record<string, number> = {};
  const seen = new Set<string>();
  const prs: PREntry[] = [];
  for (const rec of chrono) {
    for (const ex of rec.exerciseData ?? []) {
      const b = bestE1RM(ex.sets);
      const orm = b?.orm ?? 0;
      const vol = setsVolume(ex.sets, ex.perSide);
      if (orm <= 0 && vol <= 0) continue;
      const key = ex.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        bestOrm[key] = orm;
        bestVol[key] = vol;
        continue; // first appearance = baseline, not a PR
      }
      const strengthPR = orm > bestOrm[key] + 0.01;
      const volumePR = vol > bestVol[key] + 0.01;
      if (strengthPR) bestOrm[key] = orm;
      if (volumePR) bestVol[key] = vol;
      if (strengthPR || volumePR) {
        prs.push({
          name: ex.name,
          orm,
          weight: b?.weight ?? '',
          reps: b?.reps ?? '',
          volume: vol,
          date: rec.date,
          kind: strengthPR && volumePR ? 'both' : strengthPR ? 'strength' : 'volume',
        });
      }
    }
  }
  return prs.reverse().slice(0, limit);
}
