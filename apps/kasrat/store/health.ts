// Health Connect bridge. Samsung Health (watch workouts, sleep, heart rate, weigh-ins), Muse and
// anything else on the phone that writes to Health Connect is read from here. Kasrat writes back
// only its own strength sessions, and only when no other app recorded that workout.
//
// Everything is best-effort: a permission the user left off, or a record type an older Health
// Connect doesn't know, just leaves that field out instead of failing the sync.
import { Platform } from 'react-native';
import {
  ExerciseType,
  RecordingMethod,
  SdkAvailabilityStatus,
  SleepStageType,
  aggregateGroupByPeriod,
  aggregateRecord,
  deleteRecordsByUuids,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  insertRecords,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
} from 'react-native-health-connect';
import type {
  AggregateResult,
  AggregateResultRecordType,
  Permission,
  ReadHealthDataHistoryPermission,
  RecordResult,
  RecordType,
} from 'react-native-health-connect';
import type { WorkoutHealth, WorkoutRecord } from '@/types';

const KASRAT_PACKAGE = 'com.santha.kasrat';

const READ_TYPES: RecordType[] = [
  'ExerciseSession',
  'HeartRate',
  'RestingHeartRate',
  'HeartRateVariabilityRmssd',
  'SleepSession',
  'Steps',
  'Distance',
  'FloorsClimbed',
  'ActiveCaloriesBurned',
  'TotalCaloriesBurned',
  'Weight',
  'BodyFat',
  'LeanBodyMass',
  'BasalMetabolicRate',
  'OxygenSaturation',
  'RespiratoryRate',
  'Vo2Max',
  'BloodPressure',
  'BloodGlucose',
  'SkinTemperature',
  'Hydration',
  'Nutrition',
  'MindfulnessSession',
];

const PERMISSIONS: (Permission | ReadHealthDataHistoryPermission)[] = [
  ...READ_TYPES.map(recordType => ({ accessType: 'read' as const, recordType })),
  { accessType: 'write', recordType: 'ExerciseSession' },
  // Without this Health Connect only serves the 30 days before the first grant.
  { accessType: 'read', recordType: 'ReadHealthDataHistory' },
];

/** One local calendar day of everything Health Connect had. Sleep is the night that ended that morning. */
export type DailyHealth = {
  date: string; // local YYYY-MM-DD
  updatedAt: number;
  steps?: number;
  distanceKm?: number;
  floors?: number;
  activeKcal?: number;
  totalKcal?: number;
  restingHr?: number;
  /** Mean RMSSD, ms. */
  hrv?: number;
  spo2?: number;
  respRate?: number;
  vo2max?: number;
  /** °C against the wearer's own baseline. */
  skinTempDelta?: number;
  weightKg?: number;
  weighedAt?: string;
  bodyFatPct?: number;
  leanKg?: number;
  bmrKcal?: number;
  bp?: { systolic: number; diastolic: number };
  glucoseMgDl?: number;
  waterL?: number;
  food?: { kcal?: number; proteinG?: number; carbsG?: number; fatG?: number; fiberG?: number };
  sleep?: { start: string; end: string; minutes: number; deep?: number; rem?: number; light?: number; awake?: number };
  mindfulMinutes?: number;
  workouts?: { title?: string; type: number; start: string; end: string; minutes: number; source?: string }[];
};

export type HealthStatus = 'unsupported' | 'needs-update' | 'not-connected' | 'connected';

// ── Connection ───────────────────────────────────────────────────────────────

let ready: Promise<boolean> | null = null;

function init(): Promise<boolean> {
  if (!ready) {
    ready = initialize().catch(() => false);
    ready.then(ok => { if (!ok) ready = null; });
  }
  return ready;
}

async function sdkStatus(): Promise<number> {
  if (Platform.OS !== 'android') return SdkAvailabilityStatus.SDK_UNAVAILABLE;
  return getSdkStatus().catch(() => SdkAvailabilityStatus.SDK_UNAVAILABLE);
}

export async function healthStatus(): Promise<HealthStatus> {
  const sdk = await sdkStatus();
  if (sdk === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'needs-update';
  if (sdk !== SdkAvailabilityStatus.SDK_AVAILABLE || !(await init())) return 'unsupported';
  return (await grantedAccess()).size > 0 ? 'connected' : 'not-connected';
}

/** Opens Health Connect's permission sheet. True when at least one permission came back granted. */
export async function connectHealth(): Promise<boolean> {
  if ((await sdkStatus()) !== SdkAvailabilityStatus.SDK_AVAILABLE || !(await init())) return false;
  const granted = await requestPermission(PERMISSIONS).catch(() => []);
  return granted.length > 0;
}

export function openHealthSettings() {
  openHealthConnectSettings();
}

/** Granted permissions as "read:Steps" / "write:ExerciseSession" keys. */
export async function grantedAccess(): Promise<Set<string>> {
  const granted = await getGrantedPermissions().catch(() => []);
  return new Set(granted.map(p => `${p.accessType}:${p.recordType}`));
}

// ── Reading ──────────────────────────────────────────────────────────────────

type Range = { start: Date; end: Date };

export function localDayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayRange(key: string): Range {
  const [y, m, d] = key.split('-').map(Number);
  return { start: new Date(y, m - 1, d), end: new Date(y, m - 1, d + 1) };
}

/** Local day keys for the last `n` days, oldest first, ending today. */
export function lastDays(n: number, now = new Date()): string[] {
  return Array.from({ length: n }, (_, i) =>
    localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1 - i)))
  );
}

const between = ({ start, end }: Range) => ({
  operator: 'between' as const,
  startTime: start.toISOString(),
  endTime: end.toISOString(),
});

async function readAll<T extends RecordType>(type: T, range: Range, granted: Set<string>): Promise<RecordResult<T>[]> {
  if (!granted.has(`read:${type}`)) return [];
  const out: RecordResult<T>[] = [];
  let pageToken: string | undefined;
  try {
    do {
      const res = await readRecords(type, { timeRangeFilter: between(range), pageToken });
      out.push(...res.records);
      pageToken = res.pageToken || undefined;
    } while (pageToken);
  } catch {
    // Unsupported type on this Health Connect version, or the permission went away mid-sync.
  }
  return out;
}

async function aggregate<T extends AggregateResultRecordType>(type: T, range: Range, granted: Set<string>) {
  if (!granted.has(`read:${type}`)) return null;
  try {
    const res = await aggregateRecord({ recordType: type, timeRangeFilter: between(range) });
    return res.dataOrigins.length ? res : null;
  } catch {
    return null;
  }
}

/** Per-local-day aggregates over the range, keyed YYYY-MM-DD; days with no data are left out. */
async function aggregateByDay<T extends AggregateResultRecordType>(type: T, range: Range, granted: Set<string>) {
  const out = new Map<string, AggregateResult<T>>();
  if (!granted.has(`read:${type}`)) return out;
  try {
    const groups = await aggregateGroupByPeriod({
      recordType: type,
      timeRangeFilter: between(range),
      timeRangeSlicer: { period: 'DAYS', length: 1 },
    });
    // Period buckets come back as local date-times ("2026-10-31T00:00").
    for (const g of groups) if (g.result.dataOrigins.length) out.set(g.startTime.slice(0, 10), g.result);
  } catch {
    // As in readAll: leave the field out.
  }
  return out;
}

const minutesBetween = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 60_000);
const round = (n: number, dp = 0) => Math.round(n * 10 ** dp) / 10 ** dp;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Group values by the local day of their timestamp. */
function byDay<R>(records: R[], time: (r: R) => string): Map<string, R[]> {
  const m = new Map<string, R[]>();
  for (const r of records) {
    const k = localDayKey(new Date(time(r)));
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}

function sleepSummary(s: RecordResult<'SleepSession'>): NonNullable<DailyHealth['sleep']> {
  const stageMin = (...types: number[]) =>
    round((s.stages ?? []).filter(st => types.includes(st.stage)).reduce((a, st) => a + minutesBetween(st.startTime, st.endTime), 0));
  const total = minutesBetween(s.startTime, s.endTime);
  if (!s.stages?.length) return { start: s.startTime, end: s.endTime, minutes: round(total) };
  const awake = stageMin(SleepStageType.AWAKE, SleepStageType.OUT_OF_BED);
  return {
    start: s.startTime,
    end: s.endTime,
    minutes: round(total - awake),
    deep: stageMin(SleepStageType.DEEP),
    rem: stageMin(SleepStageType.REM),
    light: stageMin(SleepStageType.LIGHT, SleepStageType.SLEEPING),
    awake,
  };
}

/** Everything Health Connect has for the given local days. */
export async function readDays(keys: string[], granted: Set<string>): Promise<DailyHealth[]> {
  if (!keys.length) return [];
  const range = { start: dayRange(keys[0]).start, end: dayRange(keys[keys.length - 1]).end };
  const days = new Map<string, DailyHealth>(keys.map(k => [k, { date: k, updatedAt: Date.now() }]));
  const day = (k: string) => days.get(k);

  // Spot readings: average per day (weight and body composition take the day's last reading).
  const [rhr, hrv, spo2, resp, vo2, fat, lean, bmr, bp, glucose, weight, skin] = await Promise.all([
    readAll('RestingHeartRate', range, granted),
    readAll('HeartRateVariabilityRmssd', range, granted),
    readAll('OxygenSaturation', range, granted),
    readAll('RespiratoryRate', range, granted),
    readAll('Vo2Max', range, granted),
    readAll('BodyFat', range, granted),
    readAll('LeanBodyMass', range, granted),
    readAll('BasalMetabolicRate', range, granted),
    readAll('BloodPressure', range, granted),
    readAll('BloodGlucose', range, granted),
    readAll('Weight', range, granted),
    readAll('SkinTemperature', range, granted),
  ]);
  const last = <R extends { time: string }>(rs: R[]) => rs.reduce((a, b) => (b.time > a.time ? b : a));
  for (const [k, rs] of byDay(rhr, r => r.time)) { const d = day(k); if (d) d.restingHr = round(mean(rs.map(r => r.beatsPerMinute))); }
  for (const [k, rs] of byDay(hrv, r => r.time)) { const d = day(k); if (d) d.hrv = round(mean(rs.map(r => r.heartRateVariabilityMillis)), 1); }
  for (const [k, rs] of byDay(spo2, r => r.time)) { const d = day(k); if (d) d.spo2 = round(mean(rs.map(r => r.percentage)), 1); }
  for (const [k, rs] of byDay(resp, r => r.time)) { const d = day(k); if (d) d.respRate = round(mean(rs.map(r => r.rate)), 1); }
  for (const [k, rs] of byDay(vo2, r => r.time)) { const d = day(k); if (d) d.vo2max = round(last(rs).vo2MillilitersPerMinuteKilogram, 1); }
  for (const [k, rs] of byDay(fat, r => r.time)) { const d = day(k); if (d) d.bodyFatPct = round(last(rs).percentage, 1); }
  for (const [k, rs] of byDay(lean, r => r.time)) { const d = day(k); if (d) d.leanKg = round(last(rs).mass.inKilograms, 1); }
  for (const [k, rs] of byDay(bmr, r => r.time)) { const d = day(k); if (d) d.bmrKcal = round(last(rs).basalMetabolicRate.inKilocaloriesPerDay); }
  for (const [k, rs] of byDay(bp, r => r.time)) {
    const d = day(k);
    if (d) {
      const r = last(rs);
      d.bp = { systolic: round(r.systolic.inMillimetersOfMercury), diastolic: round(r.diastolic.inMillimetersOfMercury) };
    }
  }
  for (const [k, rs] of byDay(glucose, r => r.time)) { const d = day(k); if (d) d.glucoseMgDl = round(mean(rs.map(r => r.level.inMilligramsPerDeciliter))); }
  for (const [k, rs] of byDay(weight, r => r.time)) {
    const d = day(k);
    if (d) { const r = last(rs); d.weightKg = round(r.weight.inKilograms, 2); d.weighedAt = r.time; }
  }
  for (const [k, rs] of byDay(skin, r => r.startTime)) {
    const deltas = rs.flatMap(r => r.deltas.map(x => x.delta.inCelsius));
    const d = day(k);
    if (d && deltas.length) d.skinTempDelta = round(mean(deltas), 2);
  }

  // Sessions. Sleep belongs to the day it ended on, so start the read a day early.
  const sleepRange = { start: new Date(range.start.getTime() - 86_400_000), end: range.end };
  const [sleep, exercise, mindful] = await Promise.all([
    readAll('SleepSession', sleepRange, granted),
    readAll('ExerciseSession', range, granted),
    readAll('MindfulnessSession', range, granted),
  ]);
  for (const [k, rs] of byDay(sleep, r => r.endTime)) {
    const d = day(k);
    if (!d) continue;
    // Naps count toward the day only when there's no main sleep; take the longest session.
    const main = rs.reduce((a, b) => (minutesBetween(b.startTime, b.endTime) > minutesBetween(a.startTime, a.endTime) ? b : a));
    d.sleep = sleepSummary(main);
  }
  for (const [k, rs] of byDay(exercise, r => r.startTime)) {
    const d = day(k);
    if (d) {
      d.workouts = rs.map(r => ({
        title: r.title || undefined,
        type: r.exerciseType,
        start: r.startTime,
        end: r.endTime,
        minutes: round(minutesBetween(r.startTime, r.endTime)),
        source: r.metadata?.dataOrigin,
      }));
    }
  }
  for (const [k, rs] of byDay(mindful, r => r.startTime)) {
    const d = day(k);
    if (d) d.mindfulMinutes = round(rs.reduce((a, r) => a + minutesBetween(r.startTime, r.endTime), 0));
  }

  // Totals. Aggregates de-duplicate across sources (phone + watch steps, say); Health Connect
  // buckets them by local calendar day in one call per type.
  const [steps, dist, floors, active, total, water, food] = await Promise.all([
    aggregateByDay('Steps', range, granted),
    aggregateByDay('Distance', range, granted),
    aggregateByDay('FloorsClimbed', range, granted),
    aggregateByDay('ActiveCaloriesBurned', range, granted),
    aggregateByDay('TotalCaloriesBurned', range, granted),
    aggregateByDay('Hydration', range, granted),
    aggregateByDay('Nutrition', range, granted),
  ]);
  for (const [k, r] of steps) { const d = day(k); if (d) d.steps = r.COUNT_TOTAL; }
  for (const [k, r] of dist) { const d = day(k); if (d) d.distanceKm = round(r.DISTANCE.inKilometers, 2); }
  for (const [k, r] of floors) { const d = day(k); if (d) d.floors = round(r.FLOORS_CLIMBED_TOTAL); }
  for (const [k, r] of active) { const d = day(k); if (d) d.activeKcal = round(r.ACTIVE_CALORIES_TOTAL.inKilocalories); }
  for (const [k, r] of total) { const d = day(k); if (d) d.totalKcal = round(r.ENERGY_TOTAL.inKilocalories); }
  for (const [k, r] of water) { const d = day(k); if (d) d.waterL = round(r.VOLUME_TOTAL.inLiters, 2); }
  for (const [k, r] of food) {
    const d = day(k);
    if (d) {
      d.food = {
        kcal: round(r.ENERGY_TOTAL.inKilocalories),
        proteinG: round(r.PROTEIN_TOTAL.inGrams),
        carbsG: round(r.TOTAL_CARBOHYDRATE_TOTAL.inGrams),
        fatG: round(r.TOTAL_FAT_TOTAL.inGrams),
        fiberG: round(r.DIETARY_FIBER_TOTAL.inGrams),
      };
    }
  }

  return keys.map(k => days.get(k)!);
}

// ── Workouts ─────────────────────────────────────────────────────────────────

const HOUR = 3_600_000;
/** A Samsung session can stay open (or unsynced) for a while after Kasrat's finish. */
const WRITE_GRACE_MS = 2 * HOUR;
/** Keep looking for a late Samsung session to replace Kasrat's own write for this long
 *  (also covers sharing switched on in Samsung Health after the fact). */
const RECHECK_MS = 30 * 24 * HOUR;
/** Timers left running overnight make the logged duration useless as a window. */
const MAX_PLAUSIBLE_SEC = 4 * 3600;

/** The time a logged session actually covered. Records are stamped at finish. */
function sessionWindow(rec: WorkoutRecord): Range {
  const end = new Date(rec.date);
  const sec = rec.duration > 0 && rec.duration <= MAX_PLAUSIBLE_SEC ? rec.duration : 2 * 3600;
  return { start: new Date(end.getTime() - sec * 1000), end };
}

async function sessionStats(range: Range, granted: Set<string>) {
  const [hr, active, total] = await Promise.all([
    aggregate('HeartRate', range, granted),
    aggregate('ActiveCaloriesBurned', range, granted),
    aggregate('TotalCaloriesBurned', range, granted),
  ]);
  return {
    avgHr: hr ? round(hr.BPM_AVG) : undefined,
    maxHr: hr ? round(hr.BPM_MAX) : undefined,
    minHr: hr ? round(hr.BPM_MIN) : undefined,
    activeKcal: active ? round(active.ACTIVE_CALORIES_TOTAL.inKilocalories) : undefined,
    totalKcal: total ? round(total.ENERGY_TOTAL.inKilocalories) : undefined,
  };
}

/** Another app's workout that overlaps this session the most (10 min slack either side). */
async function findOtherSession(rec: WorkoutRecord, granted: Set<string>) {
  const w = sessionWindow(rec);
  const slack = 10 * 60_000;
  const lo = w.start.getTime() - slack;
  const hi = w.end.getTime() + slack;
  const sessions = await readAll('ExerciseSession', { start: new Date(lo - 2 * HOUR), end: new Date(hi + 2 * HOUR) }, granted);
  let best: (typeof sessions)[number] | null = null;
  let bestOverlap = 0;
  for (const s of sessions) {
    if (s.metadata?.dataOrigin === KASRAT_PACKAGE) continue;
    const overlap = Math.min(hi, Date.parse(s.endTime)) - Math.max(lo, Date.parse(s.startTime));
    if (overlap > bestOverlap) { best = s; bestOverlap = overlap; }
  }
  return best;
}

const clientId = (rec: WorkoutRecord) => `kasrat-${rec.id}`;

function setsSummary(rec: WorkoutRecord): string {
  return (rec.exerciseData ?? [])
    .map(e => `${e.name}: ${e.sets.map(s => (s.weight ? `${s.weight}×${s.reps}` : `×${s.reps}`)).join(', ')}`)
    .join('\n')
    .slice(0, 1000);
}

/**
 * Brings Health Connect up to date with logged workouts, newest 30 days only. Returns the
 * records whose `health` (and, for a runaway timer, `duration`) changed, for the caller to save.
 */
export async function syncWorkouts(history: WorkoutRecord[], granted: Set<string>, now = Date.now()): Promise<WorkoutRecord[]> {
  const canWrite = granted.has('write:ExerciseSession');
  const updated: WorkoutRecord[] = [];
  for (const rec of history) {
    const age = now - Date.parse(rec.date);
    if (age > 30 * 24 * HOUR) continue;
    const h = rec.health;
    if (h && !h.written) continue; // already matched to another app's session
    if (h?.written && age > RECHECK_MS) continue; // ours stands

    const other = await findOtherSession(rec, granted);
    if (other) {
      const range = { start: new Date(other.startTime), end: new Date(other.endTime) };
      const health: WorkoutHealth = {
        source: other.metadata?.dataOrigin,
        title: other.title || undefined,
        start: other.startTime,
        end: other.endTime,
        minutes: round(minutesBetween(other.startTime, other.endTime)),
        ...(await sessionStats(range, granted)),
        checkedAt: now,
      };
      if (h?.written && canWrite) {
        await deleteRecordsByUuids('ExerciseSession', [], [clientId(rec)]).catch(() => {});
      }
      const duration = rec.duration > MAX_PLAUSIBLE_SEC ? Math.round(health.minutes * 60) : rec.duration;
      updated.push({ ...rec, duration, health });
      continue;
    }

    if (h?.written || !canWrite || age < WRITE_GRACE_MS) continue;
    const w = sessionWindow(rec);
    try {
      await insertRecords([
        {
          recordType: 'ExerciseSession',
          exerciseType: ExerciseType.STRENGTH_TRAINING,
          title: rec.name,
          notes: setsSummary(rec),
          startTime: w.start.toISOString(),
          endTime: w.end.toISOString(),
          metadata: {
            clientRecordId: clientId(rec),
            clientRecordVersion: 1,
            recordingMethod: RecordingMethod.RECORDING_METHOD_ACTIVELY_RECORDED,
          },
        },
      ]);
    } catch {
      continue;
    }
    updated.push({
      ...rec,
      health: {
        start: w.start.toISOString(),
        end: w.end.toISOString(),
        minutes: round((w.end.getTime() - w.start.getTime()) / 60_000),
        ...(await sessionStats(w, granted)),
        written: true,
        checkedAt: now,
      },
    });
  }
  return updated;
}

// ── Readiness ────────────────────────────────────────────────────────────────

/** Last night's sleep on the 1–5 readiness dial. */
export function sleepDial(minutes: number): number {
  if (minutes < 300) return 1;
  if (minutes < 360) return 2;
  if (minutes < 420) return 3;
  if (minutes < 480) return 4;
  return 5;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export type Recovery = { flag: -1 | 0 | 1; note: string };

/**
 * Today's resting HR and HRV against the median of the 14 days before. A clear dip
 * (HRV 15% under, or resting HR 5 bpm over) is -1; both better than usual is +1.
 * Null until there are at least 5 baseline days.
 */
export function recoverySignal(days: DailyHealth[], today: string): Recovery | null {
  const t = days.find(d => d.date === today);
  if (!t || (t.hrv === undefined && t.restingHr === undefined)) return null;
  const prior = days.filter(d => d.date < today).slice(-14);
  const hrvBase = prior.flatMap(d => (d.hrv !== undefined ? [d.hrv] : []));
  const rhrBase = prior.flatMap(d => (d.restingHr !== undefined ? [d.restingHr] : []));
  const hrvMed = hrvBase.length >= 5 ? median(hrvBase) : undefined;
  const rhrMed = rhrBase.length >= 5 ? median(rhrBase) : undefined;
  if (hrvMed === undefined && rhrMed === undefined) return null;

  const hrvPct = t.hrv !== undefined && hrvMed ? Math.round((t.hrv / hrvMed - 1) * 100) : undefined;
  const rhrDelta = t.restingHr !== undefined && rhrMed !== undefined ? Math.round(t.restingHr - rhrMed) : undefined;
  if ((hrvPct !== undefined && hrvPct <= -15) || (rhrDelta !== undefined && rhrDelta >= 5)) {
    const why = [
      hrvPct !== undefined && hrvPct <= -15 ? `HRV ${-hrvPct}% under your usual` : null,
      rhrDelta !== undefined && rhrDelta >= 5 ? `resting HR ${rhrDelta} over` : null,
    ].filter(Boolean);
    return { flag: -1, note: why.join(', ') };
  }
  if (hrvPct !== undefined && hrvPct >= 10 && rhrDelta !== undefined && rhrDelta <= 0) {
    return { flag: 1, note: `HRV ${hrvPct}% over your usual` };
  }
  return { flag: 0, note: 'Recovery about usual' };
}
