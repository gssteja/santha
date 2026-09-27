import type { Debt, Txn } from '@/types/finance';
import { addMonths, convert, iso, monthKey, parseISO, todayISO } from './money';

// A payment's value in the debt's own currency: what the lender credited if recorded,
// otherwise converted at the current rate.
export function paidInDebtCurrency(t: Txn, debt: Debt, fx: number): number {
  if (t.currency === debt.currency) return t.amount;
  if (t.credited && t.credited > 0) return t.credited;
  return convert(t.amount, t.currency, debt.currency, fx);
}

export interface DebtStatus {
  balance: number; // outstanding incl. interest accrued but not yet charged
  paid: number; // total paid since startDate, debt currency
  paidThisMonth: number;
  interestTotal: number;
  interestThisMonth: number;
  progress: number; // 0..1 of startBalance cleared
}

// Daily accrual on the reducing balance, charged at each month-end — how Indian
// education loans compute it. Payments dated on/after startDate reduce the balance.
export function debtStatus(debt: Debt, txns: Txn[], fx: number, asOf: string = todayISO()): DebtStatus {
  const pays: Record<string, number> = {};
  let paid = 0;
  let paidThisMonth = 0;
  const curMonth = monthKey(asOf);
  for (const t of txns) {
    if (t.deleted || t.kind !== 'debt' || t.debtId !== debt.id) continue;
    if (t.date < debt.startDate || t.date > asOf) continue;
    const v = paidInDebtCurrency(t, debt, fx);
    pays[t.date] = (pays[t.date] ?? 0) + v;
    paid += v;
    if (monthKey(t.date) === curMonth) paidThisMonth += v;
  }
  let bal = debt.startBalance;
  let acc = 0;
  let interestTotal = 0;
  let interestThisMonth = 0;
  const daily = debt.rate / 100 / 365;
  const end = parseISO(asOf);
  for (let d = parseISO(debt.startDate); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const k = iso(d);
    if (pays[k]) bal -= pays[k];
    if (bal <= 0) {
      bal = Math.max(0, bal + acc);
      acc = 0;
      continue;
    }
    if (k !== debt.startDate) {
      const i = bal * daily;
      acc += i;
      interestTotal += i;
      if (monthKey(k) === curMonth) interestThisMonth += i;
    }
    const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    if (tomorrow.getMonth() !== d.getMonth()) {
      bal += acc;
      acc = 0;
    }
  }
  const balance = Math.max(0, bal + acc);
  return {
    balance,
    paid,
    paidThisMonth,
    interestTotal,
    interestThisMonth,
    progress: debt.startBalance > 0 ? Math.min(1, Math.max(0, 1 - balance / debt.startBalance)) : 1,
  };
}

export interface Projection {
  payoffMonth: string | null; // YYYY-MM, null if the plan never clears it
  futureInterest: number; // debt currency
  months: number;
}

// Pay the rest of this month's planned amount now, then `planned` every month after.
export function project(debt: Debt, status: DebtStatus, fx: number, asOf: string = todayISO()): Projection {
  const planned = convert(debt.planned, 'USD', debt.currency, fx);
  let bal = status.balance;
  // A debt whose balance date is still ahead starts paying from that month, not this one.
  let key = monthKey(debt.startDate > asOf ? debt.startDate : asOf);
  if (bal <= 0.5) return { payoffMonth: null, futureInterest: 0, months: 0 };
  bal -= Math.max(0, planned - status.paidThisMonth);
  let futureInterest = 0;
  let months = 0;
  const r = debt.rate / 100 / 12;
  while (bal > 0.5) {
    if (months > 600 || planned <= bal * r) return { payoffMonth: null, futureInterest, months };
    key = addMonths(key, 1);
    const i = bal * r;
    futureInterest += i;
    bal = bal + i - planned;
    months++;
  }
  return { payoffMonth: key, futureInterest, months };
}

// Even monthly payment that clears a 0% promo balance one month before the promo ends.
export function promoMonthly(debt: Debt, status: DebtStatus, asOf: string = todayISO()): number | null {
  if (!debt.promoEnd || status.balance <= 0.5) return null;
  const lastKey = addMonths(monthKey(debt.promoEnd), -1);
  let n = 0;
  for (let k = monthKey(debt.startDate > asOf ? debt.startDate : asOf); k <= lastKey; k = addMonths(k, 1)) n++;
  return n > 0 ? status.balance / n : status.balance;
}
