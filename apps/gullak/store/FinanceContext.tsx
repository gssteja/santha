import React, { createContext, useContext } from 'react';
import { useFinanceStore } from './financeStore';

type FinanceContextType = ReturnType<typeof useFinanceStore>;

const FinanceContext = createContext<FinanceContextType | null>(null);

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const store = useFinanceStore();
  return <FinanceContext.Provider value={store}>{children}</FinanceContext.Provider>;
}

export function useFinance(): FinanceContextType {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinance must be used within FinanceProvider');
  return ctx;
}
