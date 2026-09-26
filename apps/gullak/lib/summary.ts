import type { Debt, Txn } from '@/types/finance';
import { monthKey, toUSD } from './money';

export interface MonthSummary {
  income: number;
  spent: number;
  debtPaid: number;
  left: number;
  byCategory: { category: string; amount: number }[];
}

// All totals in USD at the current exchange rate.
export function monthSummary(txns: Txn[], month: string, fx: number): MonthSummary {
  let income = 0, spent = 0, debtPaid = 0;
  const cats: Record<string, number> = {};
  for (const t of txns) {
    if (monthKey(t.date) !== month) continue;
    const v = toUSD(t.amount, t.currency, fx);
    if (t.kind === 'income') income += v;
    else if (t.kind === 'debt') debtPaid += v;
    else {
      spent += v;
      cats[t.category] = (cats[t.category] ?? 0) + v;
    }
  }
  const byCategory = Object.entries(cats).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  return { income, spent, debtPaid, left: income - spent - debtPaid, byCategory };
}

export function txnTitle(t: Txn, debts: Debt[]): string {
  if (t.kind === 'debt') return debts.find(d => d.id === t.debtId)?.name ?? 'Debt payment';
  return t.category;
}
