import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { SERVER_URL, STORE_KEY } from '@/constants/config';
import { useStore } from './StoreContext';
import { useMetrics } from './MetricsContext';
import {
  connectHealth,
  grantedAccess,
  healthStatus,
  lastDays,
  localDayKey,
  readDays,
  recoverySignal,
  syncWorkouts,
} from './health';
import type { BodyMetric } from './metricsStore';
import type { DailyHealth, HealthStatus, Recovery } from './health';

// Health Connect sync: on launch and whenever the app comes back to the foreground (at most
// every 5 min), pull the recent days, import weigh-ins into Body, match or write workouts,
// and mirror the days to the server so they're readable off the phone.
const STORAGE_KEY = 'kasrat_health_v1';
const KEEP_DAYS = 90;
const FIRST_SYNC_DAYS = 30;
const RESYNC_DAYS = 3;
const MIN_INTERVAL_MS = 5 * 60_000;

async function pushDays(days: DailyHealth[]) {
  try {
    await fetch(`${SERVER_URL}/api/health/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': STORE_KEY },
      body: JSON.stringify(days),
    });
  } catch {
    // Server copy is a mirror; the phone keeps its own.
  }
}

function useHealthStore() {
  const { history, loaded: historyLoaded, replaceRecords } = useStore();
  const { upsertMetrics } = useMetrics();
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [days, setDays] = useState<DailyHealth[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // The sync reads these after awaits; refs keep it from acting on a stale render.
  const historyRef = useRef(history);
  historyRef.current = history;
  const daysRef = useRef(days);
  daysRef.current = days;
  const lastSyncRef = useRef(lastSyncAt);
  lastSyncRef.current = lastSyncAt;
  const busy = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try {
          const p = JSON.parse(raw);
          setDays(p.days ?? []);
          setLastSyncAt(p.lastSyncAt ?? null);
        } catch {}
      }
      setLoaded(true);
    });
    healthStatus().then(setStatus);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ days, lastSyncAt }));
  }, [days, lastSyncAt, loaded]);

  const sync = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      const st = await healthStatus();
      setStatus(st);
      if (st !== 'connected') return;
      const granted = await grantedAccess();

      const fresh = await readDays(lastDays(lastSyncRef.current ? RESYNC_DAYS : FIRST_SYNC_DAYS), granted);
      const byDate = new Map(daysRef.current.map(d => [d.date, d]));
      for (const d of fresh) byDate.set(d.date, d);
      const cutoff = lastDays(KEEP_DAYS)[0];
      setDays([...byDate.values()].filter(d => d.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date)));

      upsertMetrics(
        fresh.flatMap<BodyMetric>(d =>
          d.weightKg !== undefined
            ? [{ id: `hc-${d.date}`, date: d.weighedAt ?? d.date, weight: d.weightKg, unit: 'kg', source: 'health-connect' }]
            : []
        )
      );

      replaceRecords(await syncWorkouts(historyRef.current, granted));
      await pushDays(fresh);
      setLastSyncAt(Date.now());
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [upsertMetrics, replaceRecords]);

  const connect = useCallback(async () => {
    const ok = await connectHealth();
    setStatus(await healthStatus());
    if (ok) sync();
    return ok;
  }, [sync]);

  // Launch sync waits for workout history, so matching sees every record.
  useEffect(() => {
    if (loaded && historyLoaded && status === 'connected') sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, historyLoaded, status === 'connected']);

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active') return;
      if (lastSyncRef.current && Date.now() - lastSyncRef.current < MIN_INTERVAL_MS) return;
      sync();
    });
    return () => sub.remove();
  }, [sync]);

  const today = localDayKey(new Date());
  const recovery: Recovery | null = useMemo(() => recoverySignal(days, today), [days, today]);
  // Last night = the newest sleep that ended in the past 18 h.
  const lastNight = useMemo(() => {
    const s = [...days].reverse().find(d => d.sleep)?.sleep;
    return s && Date.now() - Date.parse(s.end) < 18 * 3_600_000 ? s : null;
  }, [days]);

  return { status, days, today: days.find(d => d.date === today) ?? null, lastNight, recovery, lastSyncAt, syncing, sync, connect };
}

type HealthContextType = ReturnType<typeof useHealthStore>;

const HealthContext = createContext<HealthContextType | null>(null);

export function HealthProvider({ children }: { children: React.ReactNode }) {
  const store = useHealthStore();
  return <HealthContext.Provider value={store}>{children}</HealthContext.Provider>;
}

export function useHealth(): HealthContextType {
  const ctx = useContext(HealthContext);
  if (!ctx) throw new Error('useHealth must be used within HealthProvider');
  return ctx;
}
