import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { SERVER_URL } from '@/constants/config';
import type { ActiveWorkout, WorkoutExercise, WorkoutRecord, WorkoutSet } from '@/types';

const STORAGE_KEY = 'kasrat_v1';

type State = {
  activeWorkout: ActiveWorkout | null;
  history: WorkoutRecord[];
  loaded: boolean;
  syncing: boolean;
};

type Action =
  | { type: 'LOAD'; payload: Omit<State, 'loaded' | 'syncing'> }
  | { type: 'MERGE_SERVER'; records: WorkoutRecord[] }
  | { type: 'SET_SYNCING'; value: boolean }
  | { type: 'START_WORKOUT'; name: string }
  | { type: 'ADD_EXERCISE'; exercise: WorkoutExercise }
  | { type: 'REMOVE_EXERCISE'; exIdx: number }
  | { type: 'SWAP_EXERCISE'; exIdx: number; newName: string }
  | { type: 'ADD_SET'; exIdx: number }
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
      return { ...state, ...action.payload, loaded: true };

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

    case 'START_WORKOUT':
      return {
        ...state,
        activeWorkout: {
          id: Date.now().toString(),
          name: action.name,
          startTime: Date.now(),
          exercises: [],
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
      const volume = completedSets.reduce(
        (acc, s) => acc + (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0),
        0
      );
      const record: WorkoutRecord = {
        id: w.id,
        name: w.name,
        date: new Date().toISOString(),
        duration,
        sets: completedSets.length,
        volume: Math.round(volume),
        exercises: w.exercises.map(e => e.name),
        exerciseData: w.exercises.map(e => ({
          name: e.name,
          muscle: e.muscle,
          sets: e.sets.filter(s => s.done),
        })),
      };
      return { ...state, activeWorkout: null, history: [record, ...state.history] };
    }

    case 'DISCARD_WORKOUT':
      return { ...state, activeWorkout: null };

    default:
      return state;
  }
}

const INITIAL: State = { activeWorkout: null, history: [], loaded: false, syncing: false };

async function syncToServer(records: WorkoutRecord[]) {
  try {
    await fetch(`${SERVER_URL}/api/workouts/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(records),
    });
  } catch {
    // Silently fail — local data is source of truth
  }
}

async function fetchFromServer(): Promise<WorkoutRecord[]> {
  try {
    const res = await fetch(`${SERVER_URL}/api/workouts`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export function useWorkoutStore() {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // Load local, then merge server
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(async raw => {
      let local = { activeWorkout: null as ActiveWorkout | null, history: [] as WorkoutRecord[] };
      if (raw) {
        try { local = JSON.parse(raw); } catch {}
      }
      dispatch({ type: 'LOAD', payload: local });

      // Merge server records in background
      const serverRecords = await fetchFromServer();
      if (serverRecords.length > 0) {
        dispatch({ type: 'MERGE_SERVER', records: serverRecords });
      }
    });
  }, []);

  // Persist local on every state change
  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ activeWorkout: state.activeWorkout, history: state.history })
    );
  }, [state.activeWorkout, state.history, state.loaded]);

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

  // Live volume for active workout
  const activeVolume = useMemo(() => {
    if (!state.activeWorkout) return 0;
    return Math.round(
      state.activeWorkout.exercises
        .flatMap(e => e.sets.filter(s => s.done))
        .reduce((acc, s) => acc + (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0), 0)
    );
  }, [state.activeWorkout]);

  // Check if exercise beat previous best volume
  const isProgressiveOverload = useCallback(
    (exerciseName: string, currentSets: WorkoutSet[]): boolean => {
      const prev = getPreviousSets(exerciseName);
      if (!prev.length) return false;
      const prevVol = prev.reduce((a, s) => a + (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0), 0);
      const currVol = currentSets
        .filter(s => s.done)
        .reduce((a, s) => a + (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0), 0);
      return currVol > prevVol;
    },
    [getPreviousSets]
  );

  const startWorkout = useCallback((name: string) => dispatch({ type: 'START_WORKOUT', name }), []);

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
    // Sync after finish — read updated state via setTimeout to get new record
    setTimeout(() => {
      AsyncStorage.getItem(STORAGE_KEY).then(raw => {
        if (raw) {
          try {
            const { history } = JSON.parse(raw);
            syncToServer(history);
          } catch {}
        }
      });
    }, 100);
  }, []);

  const discardWorkout = useCallback(() => dispatch({ type: 'DISCARD_WORKOUT' }), []);

  return {
    ...state,
    activeVolume,
    getPreviousSets,
    isProgressiveOverload,
    startWorkout,
    addExercise,
    removeExercise,
    swapExercise,
    addSet,
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
