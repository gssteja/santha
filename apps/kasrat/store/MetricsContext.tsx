import React, { createContext, useContext } from 'react';
import { useMetricsStore } from './metricsStore';

type MetricsContextType = ReturnType<typeof useMetricsStore>;

const MetricsContext = createContext<MetricsContextType | null>(null);

export function MetricsProvider({ children }: { children: React.ReactNode }) {
  const store = useMetricsStore();
  return <MetricsContext.Provider value={store}>{children}</MetricsContext.Provider>;
}

export function useMetrics(): MetricsContextType {
  const ctx = useContext(MetricsContext);
  if (!ctx) throw new Error('useMetrics must be used within MetricsProvider');
  return ctx;
}
