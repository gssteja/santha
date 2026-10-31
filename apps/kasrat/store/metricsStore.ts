import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useReducer } from 'react';

// Body metrics + daily readiness live in their OWN store (separate AsyncStorage key)
// so they can never be folded into training volume.
const STORAGE_KEY = 'kasrat_metrics_v1';

export type BodyMetric = {
  id: string;
  date: string; // ISO
  weight?: number; // in `unit`
  unit?: 'kg' | 'lb';
  waist?: number;
  arm?: number;
  chest?: number;
  thigh?: number;
  note?: string;
  /** Imported from Health Connect (id is `hc-<day>`), so a re-sync replaces it instead of adding a copy. */
  source?: 'health-connect';
};

// Daily readiness check-in. Each input 1–5; score buckets to -1 | 0 | 1.
export type Readiness = {
  date: string; // YYYY-MM-DD
  sleep: number; // 1 poor – 5 great
  soreness: number; // 1 wrecked – 5 fresh
  stress: number; // 1 high – 5 low
  score: number; // -1 beat · 0 normal · 1 fresh
  /** Watch recovery (resting HR / HRV vs baseline) folded into the score, with why. */
  recovery?: { flag: number; note: string };
};

export function readinessScore(sleep: number, soreness: number, stress: number): number {
  const avg = (sleep + soreness + stress) / 3;
  if (avg <= 2.34) return -1;
  if (avg >= 3.67) return 1;
  return 0;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

type State = { metrics: BodyMetric[]; readiness: Readiness[]; loaded: boolean };
type Action =
  | { type: 'LOAD'; payload: Pick<State, 'metrics' | 'readiness'> }
  | { type: 'ADD_METRIC'; metric: BodyMetric }
  | { type: 'DELETE_METRIC'; id: string }
  | { type: 'UPSERT_METRICS'; metrics: BodyMetric[] }
  | { type: 'SET_READINESS'; readiness: Readiness };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD':
      return { ...state, metrics: action.payload.metrics, readiness: action.payload.readiness, loaded: true };
    case 'ADD_METRIC':
      return {
        ...state,
        metrics: [action.metric, ...state.metrics].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
      };
    case 'UPSERT_METRICS': {
      const ids = new Set(action.metrics.map(m => m.id));
      return {
        ...state,
        metrics: [...state.metrics.filter(m => !ids.has(m.id)), ...action.metrics].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
      };
    }
    case 'DELETE_METRIC':
      return { ...state, metrics: state.metrics.filter(m => m.id !== action.id) };
    case 'SET_READINESS': {
      const others = state.readiness.filter(r => r.date !== action.readiness.date);
      return { ...state, readiness: [action.readiness, ...others] };
    }
    default:
      return state;
  }
}

const INITIAL: State = { metrics: [], readiness: [], loaded: false };

export function useMetricsStore() {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      let data: Pick<State, 'metrics' | 'readiness'> = { metrics: [], readiness: [] };
      if (raw) {
        try {
          const p = JSON.parse(raw);
          data = { metrics: p.metrics ?? [], readiness: p.readiness ?? [] };
        } catch {}
      }
      dispatch({ type: 'LOAD', payload: data });
    });
  }, []);

  useEffect(() => {
    if (!state.loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ metrics: state.metrics, readiness: state.readiness }));
  }, [state.metrics, state.readiness, state.loaded]);

  const addMetric = useCallback((m: Omit<BodyMetric, 'id' | 'date'> & { date?: string }) => {
    const { date, ...rest } = m;
    dispatch({
      type: 'ADD_METRIC',
      metric: { id: Date.now().toString(), date: date ?? new Date().toISOString(), ...rest },
    });
  }, []);

  const deleteMetric = useCallback((id: string) => dispatch({ type: 'DELETE_METRIC', id }), []);

  const upsertMetrics = useCallback((metrics: BodyMetric[]) => {
    if (metrics.length) dispatch({ type: 'UPSERT_METRICS', metrics });
  }, []);

  const setReadiness = useCallback(
    (sleep: number, soreness: number, stress: number, recovery?: { flag: number; note: string } | null) => {
      const base = readinessScore(sleep, soreness, stress);
      const score = Math.max(-1, Math.min(1, base + (recovery?.flag ?? 0)));
      dispatch({
        type: 'SET_READINESS',
        readiness: { date: todayKey(), sleep, soreness, stress, score, ...(recovery ? { recovery } : {}) },
      });
    },
    []
  );

  const todayReadiness = state.readiness.find(r => r.date === todayKey()) ?? null;
  const latestWeight = state.metrics.find(m => m.weight !== undefined) ?? null;

  return { ...state, todayReadiness, latestWeight, addMetric, deleteMetric, upsertMetrics, setReadiness };
}
