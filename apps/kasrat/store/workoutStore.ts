import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { SERVER_URL, STORE_KEY } from '@/constants/config';
import { ACTIVE_PROGRAM_ID, getProgram, PROGRAMS, epley1RM, isHeavyWeek, starterWeight, weightForReps } from '@/store/programs';
import { setsVolume } from '@/engine/strength';
import type { ActiveWorkout, WorkoutExercise, WorkoutRecord, WorkoutSet } from '@/types';

const STORAGE_KEY = 'kasrat_v1';

// The program the day-rotation follows. Retired programs stay in PROGRAMS (their history
// still resolves, and they can be started by hand) but no longer advance the rotation.
const ACTIVE_PROGRAM = getProgram(ACTIVE_PROGRAM_ID) ?? PROGRAMS[0];

export type ProgramProgress = { dayIndex: number; week: number };

type State = {
  activeWorkout: ActiveWorkout | null;
  history: WorkoutRecord[];
  program: ProgramProgress;
  loaded: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
};

type Action =
  | { type: 'LOAD'; payload: Pick<State, 'activeWorkout' | 'history'> & { program?: ProgramProgress } }
  | { type: 'MERGE_SERVER'; records: WorkoutRecord[] }
  | { type: 'SET_SYNCING'; value: boolean }
  | { type: 'SYNCED'; at: number }
  | { type: 'START_WORKOUT'; name: string; week?: number; programId?: string }
  | { type: 'ADD_EXERCISE'; exercise: WorkoutExercise }
  | { type: 'REMOVE_EXERCISE'; exIdx: number }
  | { type: 'SWAP_EXERCISE'; exIdx: number; newName: string }
  | { type: 'ADD_SET'; exIdx: number }
  | { type: 'ADD_DROP_SET'; exIdx: number; afterIdx: number }
  | { type: 'REMOVE_SET'; exIdx: number; setIdx: number }
  | { type: 'UPDATE_SET'; exIdx: number; setIdx: number; field: 'weight' | 'reps'; value: string }
  | { type: 'TOGGLE_SET'; exIdx: number; setIdx: number }
  | { type: 'FINISH_WORKOUT' }
  | { type: 'DISCARD_WORKOUT' };

function defaultSet(): WorkoutSet {
  return { weight: '', reps: '', done: false };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD':
      return {
        ...state,
        activeWorkout: action.payload.activeWorkout,
        history: action.payload.history,
        program: action.payload.program ?? state.program,
        loaded: true,
      };

    case 'MERGE_SERVER': {
      const byId = new Map(state.history.map(r => [r.id, r]));
      for (const r of action.records) {
        if (r.id) byId.set(r.id, r);
      }
      const merged = [...byId.values()].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      return { ...state, history: merged };
    }

    case 'SET_SYNCING':
      return { ...state, syncing: action.value };

    case 'SYNCED':
      return { ...state, syncing: false, lastSyncedAt: action.at };

    case 'START_WORKOUT':
      return {
        ...state,
        activeWorkout: {
          id: Date.now().toString(),
          name: action.name,
          startTime: Date.now(),
          exercises: [],
          week: action.week,
          programId: action.programId,
        },
      };

    case 'ADD_EXERCISE': {
      if (!state.activeWorkout) return state;
      return {
        ...state,
        activeWorkout: {
          ...state.activeWorkout,
          exercises: [...state.activeWorkout.exercises, action.exercise],
        },
      };
    }

    case 'REMOVE_EXERCISE': {
      if (!state.activeWorkout) return state;
      return {
        ...state,
        activeWorkout: {
          ...state.activeWorkout,
          exercises: state.activeWorkout.exercises.filter((_, i) => i !== action.exIdx),
        },
      };
    }

    case 'SWAP_EXERCISE': {
      if (!state.activeWorkout) return state;
      return {
        ...state,
        activeWorkout: {
          ...state.activeWorkout,
          exercises: state.activeWorkout.exercises.map((ex, i) =>
            i === action.exIdx ? { ...ex, name: action.newName } : ex
          ),
        },
      };
    }

    case 'ADD_SET': {
      if (!state.activeWorkout) return state;
      const exercises = state.activeWorkout.exercises.map((ex, i) => {
        if (i !== action.exIdx) return ex;
        const last = ex.sets[ex.sets.length - 1];
        return {
          ...ex,
          sets: [...ex.sets, { weight: last?.weight ?? '', reps: last?.reps ?? '', done: false }],
        };
      });
      return { ...state, activeWorkout: { ...state.activeWorkout, exercises } };
    }

    case 'ADD_DROP_SET': {
      if (!state.activeWorkout) return state;
      const exercises = state.activeWorkout.exercises.map((ex, i) => {
        if (i !== action.exIdx) return ex;
        const src = ex.sets[action.afterIdx];
        // drop set: seed from the chosen set's weight (you'll lower it), reps blank, no rest
        const dropSet = { weight: src?.weight ?? '', reps: '', done: false, drop: true };
        const sets = [...ex.sets];
        sets.splice(action.afterIdx + 1, 0, dropSet);
        return { ...ex, sets };
      });
      return { ...state, activeWorkout: { ...state.activeWorkout, exercises } };
    }

    case 'REMOVE_SET': {
      if (!state.activeWorkout) return state;
      const exercises = state.activeWorkout.exercises.map((ex, i) => {
        if (i !== action.exIdx || ex.sets.length <= 1) return ex;
        return { ...ex, sets: ex.sets.filter((_, j) => j !== action.setIdx) };
      });
      return { ...state, activeWorkout: { ...state.activeWorkout, exercises } };
    }

    case 'UPDATE_SET': {
      if (!state.activeWorkout) return state;
      const exercises = state.activeWorkout.exercises.map((ex, i) => {
        if (i !== action.exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) =>
            j === action.setIdx ? { ...s, [action.field]: action.value } : s
          ),
        };
      });
      return { ...state, activeWorkout: { ...state.activeWorkout, exercises } };
    }

    case 'TOGGLE_SET': {
      if (!state.activeWorkout) return state;
      const exercises = state.activeWorkout.exercises.map((ex, i) => {
        if (i !== action.exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) =>
            j === action.setIdx ? { ...s, done: !s.done } : s
          ),
        };
      });
      return { ...state, activeWorkout: { ...state.activeWorkout, exercises } };
    }

    case 'FINISH_WORKOUT': {
      if (!state.activeWorkout) return state;
      const w = state.activeWorkout;
      const duration = Math.floor((Date.now() - w.startTime) / 1000);
      const completedSets = w.exercises.flatMap(e => e.sets.filter(s => s.done));
      // Unilateral lifts count both sides toward volume. Negative weight (assisted
      // pull-ups / dips, where user logs the assist as -lbs) clamps to 0 — assisted
      // reps don't contribute to load volume.
      const volume = w.exercises.reduce((acc, e) => {
        const mult = e.perSide ? 2 : 1;
        return acc + e.sets.filter(s => s.done).reduce(
          (a, s) => a + Math.max(0, parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0) * mult,
          0
        );
      }, 0);
      const record: WorkoutRecord = {
        id: w.id,
        name: w.name,
        date: new Date().toISOString(),
        duration,
        sets: completedSets.length,
        volume: Math.round(volume),
        week: w.week ?? state.program.week,
        programId: w.programId,
        exercises: w.exercises.map(e => e.name),
        exerciseData: w.exercises.map(e => ({
          name: e.name,
          muscle: e.muscle,
          sets: e.sets.filter(s => s.done),
          perSide: e.perSide,
        })),
      };
      // If this workout was the suggested program day, advance the rotation.
      let program = state.program;
      const suggested = ACTIVE_PROGRAM?.days[state.program.dayIndex];
      if (suggested && w.name === suggested.name) {
        const dayCount = ACTIVE_PROGRAM.days.length;
        const nextIndex = (state.program.dayIndex + 1) % dayCount;
        const week = nextIndex === 0 ? state.program.week + 1 : state.program.week;
        program = { dayIndex: nextIndex, week };
      }
      return { ...state, activeWorkout: null, history: [record, ...state.history], program };
    }

    case 'DISCARD_WORKOUT':
      return { ...state, activeWorkout: null };

    default:
      return state;
  }
}

const INITIAL: State = {
  activeWorkout: null,
  history: [],
  program: { dayIndex: 0, week: 1 },
  loaded: false,
  syncing: false,
  lastSyncedAt: null,
};

async function syncToServer(records: WorkoutRecord[]): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/api/workouts/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': STORE_KEY },
      body: JSON.stringify(records),
    });
    return res.ok;
  } catch {
    // Silently fail — local data is source of truth
    return false;
  }
}

async function fetchFromServer(): Promise<WorkoutRecord[]> {
  // NB: AbortSignal.timeout() is NOT available in Hermes (RN 0.79) — it throws and the
  // whole fetch silently fails (no history loads on a fresh install). Use AbortController.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${SERVER_URL}/api/workouts`, {
      headers: { 'x-api-key': STORE_KEY },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function useWorkoutStore() {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // Load local, then merge server
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(async raw => {
      let local: {
        activeWorkout: ActiveWorkout | null;
        history: WorkoutRecord[];
        program?: ProgramProgress;
      } = { activeWorkout: null, history: [] };
      if (raw) {
        try { local = JSON.parse(raw); } catch {}
      }
      dispatch({ type: 'LOAD', payload: local });

      // Merge server records in background
      dispatch({ type: 'SET_SYNCING', value: true });
      const serverRecords = await fetchFromServer();
      if (serverRecords.length > 0) {
        dispatch({ type: 'MERGE_SERVER', records: serverRecords });
      }
      dispatch({ type: 'SYNCED', at: Date.now() });
    });
  }, []);

  // Persist local on every state change
  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeWorkout: state.activeWorkout,
        history: state.history,
        program: state.program,
      })
    );
  }, [state.activeWorkout, state.history, state.program, state.loaded]);

  // Previous performance lookup: find last logged sets for an exercise by name
  const getPreviousSets = useCallback(
    (exerciseName: string): WorkoutSet[] => {
      for (const record of state.history) {
        const ex = record.exerciseData?.find(
          e => e.name.toLowerCase() === exerciseName.toLowerCase()
        );
        if (ex && ex.sets.length > 0) return ex.sets;
      }
      return [];
    },
    [state.history]
  );

  // Phase-aware previous: for waved lifts, the most recent log from the SAME phase
  // (heavy weeks pull last heavy-week sets, light pull last light). Falls back to any
  // record lacking a stored week. Non-waved lifts just use the most recent log.
  const getPhaseSets = useCallback(
    (exerciseName: string, week: number, waved: boolean): WorkoutSet[] => {
      for (const record of state.history) {
        if (waved && record.week !== undefined && isHeavyWeek(record.week) !== isHeavyWeek(week)) {
          continue;
        }
        const ex = record.exerciseData?.find(
          e => e.name.toLowerCase() === exerciseName.toLowerCase()
        );
        if (ex && ex.sets.length > 0) return ex.sets;
      }
      return [];
    },
    [state.history]
  );

  // One-shot seed weights for the next 2 sessions: only used when no real log
  // exists. Waved lifts (squat/bench/deadlift) extrapolate via Epley 1RM from the
  // opposite phase if logged; everything else falls back to the starter table.
  // TODO(remove-after-d5): drop this helper + its call sites once D4 and D5 are logged.
  const getSeedSets = useCallback(
    (exerciseName: string, setCount: number, waved: boolean, currentReps: number): WorkoutSet[] => {
      if (waved) {
        const prev = getPreviousSets(exerciseName);
        const top = prev.reduce<{ w: number; r: number } | null>((acc, s) => {
          const w = parseFloat(s.weight) || 0;
          const r = parseInt(s.reps) || 0;
          if (w <= 0 || r <= 0) return acc;
          return !acc || w > acc.w ? { w, r } : acc;
        }, null);
        if (top && currentReps > 0) {
          const orm = epley1RM(top.w, top.r);
          const w = Math.max(5, Math.round(weightForReps(orm, currentReps) / 5) * 5);
          return Array.from({ length: setCount }, () => ({ weight: String(w), reps: '', done: false }));
        }
      }
      const sw = starterWeight(exerciseName);
      if (sw !== undefined) {
        return Array.from({ length: setCount }, () => ({ weight: String(sw), reps: '', done: false }));
      }
      return [];
    },
    [getPreviousSets]
  );

  // Live volume for active workout (unilateral lifts count both sides; negative weight clamps to 0).
  const activeVolume = useMemo(() => {
    if (!state.activeWorkout) return 0;
    return Math.round(
      state.activeWorkout.exercises.reduce((acc, e) => {
        const mult = e.perSide ? 2 : 1;
        return acc + e.sets.filter(s => s.done).reduce(
          (a, s) => a + Math.max(0, parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0) * mult,
          0
        );
      }, 0)
    );
  }, [state.activeWorkout]);

  // Best estimated 1RM ever logged for an exercise (Epley over every logged set).
  // Returns the top set's load/reps too, for display ("153 from 30×12"). History excludes
  // the in-progress workout, so this is always the bar to beat.
  const getBest1RM = useCallback(
    (exerciseName: string): { orm: number; weight: string; reps: string } | null => {
      let best: { orm: number; weight: string; reps: string } | null = null;
      for (const record of state.history) {
        const ex = record.exerciseData?.find(
          e => e.name.toLowerCase() === exerciseName.toLowerCase()
        );
        if (!ex) continue;
        for (const s of ex.sets) {
          const w = Math.max(0, parseFloat(s.weight) || 0);
          const r = parseInt(s.reps) || 0;
          if (w <= 0 || r <= 0) continue;
          const orm = epley1RM(w, r);
          if (!best || orm > best.orm) best = { orm, weight: s.weight, reps: s.reps };
        }
      }
      return best;
    },
    [state.history]
  );

  // Best single-session working volume ever logged for a lift (the volume bar to beat).
  // Mirrors getBest1RM: history excludes the in-progress workout. 0 when never logged.
  const getBestVolume = useCallback(
    (exerciseName: string): number => {
      let best = 0;
      for (const record of state.history) {
        const ex = record.exerciseData?.find(
          e => e.name.toLowerCase() === exerciseName.toLowerCase()
        );
        if (!ex) continue;
        const v = setsVolume(ex.sets, ex.perSide);
        if (v > best) best = v;
      }
      return best;
    },
    [state.history]
  );

  const startWorkout = useCallback(
    (name: string, week?: number, programId?: string) =>
      dispatch({ type: 'START_WORKOUT', name, week, programId }),
    []
  );

  const addExercise = useCallback(
    (exercise: WorkoutExercise) => dispatch({ type: 'ADD_EXERCISE', exercise }),
    []
  );

  const removeExercise = useCallback(
    (exIdx: number) => dispatch({ type: 'REMOVE_EXERCISE', exIdx }),
    []
  );

  const swapExercise = useCallback(
    (exIdx: number, newName: string) => dispatch({ type: 'SWAP_EXERCISE', exIdx, newName }),
    []
  );

  const addSet = useCallback((exIdx: number) => dispatch({ type: 'ADD_SET', exIdx }), []);

  const addDropSet = useCallback(
    (exIdx: number, afterIdx: number) => dispatch({ type: 'ADD_DROP_SET', exIdx, afterIdx }),
    []
  );

  const removeSet = useCallback(
    (exIdx: number, setIdx: number) => dispatch({ type: 'REMOVE_SET', exIdx, setIdx }),
    []
  );

  const updateSet = useCallback(
    (exIdx: number, setIdx: number, field: 'weight' | 'reps', value: string) =>
      dispatch({ type: 'UPDATE_SET', exIdx, setIdx, field, value }),
    []
  );

  const toggleSet = useCallback(
    (exIdx: number, setIdx: number) => dispatch({ type: 'TOGGLE_SET', exIdx, setIdx }),
    []
  );

  const finishWorkout = useCallback(() => {
    dispatch({ type: 'FINISH_WORKOUT' });
    dispatch({ type: 'SET_SYNCING', value: true });
    // Sync after finish — read updated state via setTimeout to get new record
    setTimeout(() => {
      AsyncStorage.getItem(STORAGE_KEY).then(async raw => {
        let ok = false;
        if (raw) {
          try {
            const { history } = JSON.parse(raw);
            ok = await syncToServer(history);
          } catch {}
        }
        // Stamp sync time on success; just clear the spinner on failure (local stays source of truth).
        dispatch(ok ? { type: 'SYNCED', at: Date.now() } : { type: 'SET_SYNCING', value: false });
      });
    }, 100);
  }, []);

  const discardWorkout = useCallback(() => dispatch({ type: 'DISCARD_WORKOUT' }), []);

  return {
    ...state,
    activeVolume,
    getPreviousSets,
    getPhaseSets,
    getSeedSets,
    getBest1RM,
    getBestVolume,
    startWorkout,
    addExercise,
    removeExercise,
    swapExercise,
    addSet,
    addDropSet,
    removeSet,
    updateSet,
    toggleSet,
    finishWorkout,
    discardWorkout,
  };
}

export function makeExerciseBlock(exId: string, name: string, muscle: string): WorkoutExercise {
  return { exId, name, muscle, sets: [defaultSet(), defaultSet(), defaultSet()] };
}

// Build a block from a program prescription: `setCount` sets, each prefilled with the
// target `reps`. Weight is prefilled from the last logged session (`prevSets`) when known
// — the program only prescribes %1RM, not absolute load, so there's nothing else to fill.
export function makeProgramExerciseBlock(
  exId: string,
  name: string,
  muscle: string,
  setCount: number,
  reps: string,
  prevSets?: WorkoutSet[],
  opts?: {
    perSide?: boolean;
    target?: string;
    heavy?: boolean;
    waved?: boolean;
    note?: string;
    drops?: string[];
    rpe?: string;
  },
): WorkoutExercise {
  const n = Math.max(1, setCount);
  const drops = opts?.drops ?? [];
  const sets: WorkoutSet[] = [];
  // Previous session interleaves working + drop sets ([main, drop, main, drop, …]).
  // Split them so a working set's weight is seeded from the previous *working* set
  // (not the lighter drop that follows it), and each drop from its previous drop.
  const prevMains = (prevSets ?? []).filter(s => !s.drop);
  const prevDrops = (prevSets ?? []).filter(s => s.drop);
  for (let i = 0; i < n; i++) {
    sets.push({ weight: prevMains[i]?.weight ?? prevMains[0]?.weight ?? '', reps, done: false });
    // Each working set is followed by its prescribed drop(s) — lighter, no rest.
    drops.forEach((dr, di) => {
      const pd = prevDrops[i * drops.length + di] ?? prevDrops[di];
      sets.push({ weight: pd?.weight ?? '', reps: dr, done: false, drop: true });
    });
  }
  return {
    exId,
    name,
    muscle,
    sets,
    perSide: opts?.perSide,
    target: opts?.target,
    heavy: opts?.heavy,
    waved: opts?.waved,
    note: opts?.note,
    rpe: opts?.rpe,
  };
}
