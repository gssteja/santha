import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SERVER_URL, STORE_KEY } from '@/constants/config';
import { uid } from '@/lib/money';
import type { Debt, FinanceData, Settings, Txn } from '@/types/finance';

const STORAGE_KEY = 'gullak.v1';

// Starting point (2026-09-26). Fixed ids + small updatedAt values so every device converges on
// the same records and any real edit wins the merge. Bump a seed's updatedAt to push a correction.
const SEED: FinanceData = {
  txns: [],
  debts: [
    {
      id: 'india-loan', name: 'India education loan', currency: 'INR', startBalance: 4060800,
      startDate: '2026-09-26', rate: 9, planned: 4840, updatedAt: 1,
    },
    {
      id: 'td-card', name: 'TD card', currency: 'USD', startBalance: 2311,
      startDate: '2026-10-11', rate: 0, promoEnd: '2027-02-01', planned: 578, updatedAt: 2,
    },
  ],
  settings: { fx: 95.82, budget: 2080, updatedAt: 1 },
};

// Last-write-wins by id; deletes are tombstones so they propagate.
function mergeList<T extends { id: string; updatedAt: number }>(a: T[], b: T[]): T[] {
  const byId = new Map<string, T>();
  for (const r of a) byId.set(r.id, r);
  for (const r of b) {
    const cur = byId.get(r.id);
    if (!cur || (r.updatedAt ?? 0) >= (cur.updatedAt ?? 0)) byId.set(r.id, r);
  }
  return [...byId.values()];
}
export function mergeData(a: FinanceData, b: FinanceData): FinanceData {
  return {
    txns: mergeList(a.txns, b.txns ?? []),
    debts: mergeList(a.debts, b.debts ?? []),
    settings: (b.settings?.updatedAt ?? 0) > (a.settings?.updatedAt ?? 0) ? b.settings : a.settings,
  };
}

export type SyncState = { status: 'idle' | 'syncing' | 'ok' | 'error'; at?: number; message?: string };

async function pushAndPull(data: FinanceData): Promise<FinanceData> {
  // Hermes has no AbortSignal.timeout — use a controller + timer.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${SERVER_URL}/api/finance/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': STORE_KEY },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    return (await res.json()) as FinanceData;
  } finally {
    clearTimeout(timer);
  }
}

export function useFinanceStore() {
  const [data, setData] = useState<FinanceData>(SEED);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncState>({ status: 'idle' });
  const dataRef = useRef(data);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback((next: FinanceData) => {
    dataRef.current = next;
    setData(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const syncNow = useCallback(async () => {
    setSync(s => ({ ...s, status: 'syncing' }));
    try {
      const server = await pushAndPull(dataRef.current);
      // Merge again: local edits may have landed while the request was in flight.
      commit(mergeData(dataRef.current, server));
      setSync({ status: 'ok', at: Date.now() });
    } catch (e) {
      const message = e instanceof Error ? (e.name === 'AbortError' ? 'Timed out' : e.message) : 'Sync failed';
      setSync(s => ({ status: 'error', at: s.at, message }));
    }
  }, [commit]);

  const scheduleSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => { syncNow(); }, 1500);
  }, [syncNow]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (raw) {
          try { commit(mergeData(SEED, JSON.parse(raw) as FinanceData)); } catch { /* keep seed */ }
        }
      })
      .finally(() => {
        setReady(true);
        syncNow();
      });
  }, [commit, syncNow]);

  const update = useCallback((fn: (d: FinanceData) => FinanceData) => {
    commit(fn(dataRef.current));
    scheduleSync();
  }, [commit, scheduleSync]);

  const addTxn = useCallback((t: Omit<Txn, 'id' | 'updatedAt'>) => {
    update(d => ({ ...d, txns: [...d.txns, { ...t, id: uid(), updatedAt: Date.now() }] }));
  }, [update]);

  const updateTxn = useCallback((id: string, patch: Partial<Txn>) => {
    update(d => ({ ...d, txns: d.txns.map(t => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)) }));
  }, [update]);

  const deleteTxn = useCallback((id: string) => updateTxn(id, { deleted: true }), [updateTxn]);

  const saveDebt = useCallback((debt: Omit<Debt, 'id' | 'updatedAt'> & { id?: string }) => {
    update(d => {
      const rec: Debt = { ...debt, id: debt.id ?? uid(), updatedAt: Date.now() };
      const exists = d.debts.some(x => x.id === rec.id);
      return { ...d, debts: exists ? d.debts.map(x => (x.id === rec.id ? rec : x)) : [...d.debts, rec] };
    });
  }, [update]);

  const deleteDebt = useCallback((id: string) => {
    update(d => ({ ...d, debts: d.debts.map(x => (x.id === id ? { ...x, deleted: true, updatedAt: Date.now() } : x)) }));
  }, [update]);

  const saveSettings = useCallback((patch: Partial<Omit<Settings, 'updatedAt'>>) => {
    update(d => ({ ...d, settings: { ...d.settings, ...patch, updatedAt: Date.now() } }));
  }, [update]);

  const txns = useMemo(
    () => data.txns.filter(t => !t.deleted).sort((a, b) => (a.date === b.date ? b.updatedAt - a.updatedAt : b.date.localeCompare(a.date))),
    [data.txns],
  );
  const debts = useMemo(() => data.debts.filter(d => !d.deleted), [data.debts]);

  return {
    ready, data, txns, debts, settings: data.settings, sync,
    addTxn, updateTxn, deleteTxn, saveDebt, deleteDebt, saveSettings, syncNow,
  };
}
