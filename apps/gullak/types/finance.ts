export type Currency = 'USD' | 'INR';
export type TxnKind = 'expense' | 'income' | 'debt';

export interface Txn {
  id: string;
  kind: TxnKind;
  amount: number;
  currency: Currency;
  date: string; // YYYY-MM-DD
  category: string;
  note: string;
  debtId?: string;
  // For a debt payment made in a different currency than the debt: what the lender
  // actually credited, in the debt's currency (e.g. rupees after transfer fees).
  credited?: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface Debt {
  id: string;
  name: string;
  currency: Currency;
  startBalance: number; // outstanding on startDate, in the debt's currency
  startDate: string;
  rate: number; // % per year; 0 for a 0% promo card
  promoEnd?: string; // 0% promo end date (deferred-interest cards)
  planned: number; // planned monthly payment, USD
  updatedAt: number;
  deleted?: boolean;
}

export interface Settings {
  fx: number; // INR per USD
  budget: number; // monthly spending budget, USD
  updatedAt: number;
}

export interface FinanceData {
  txns: Txn[];
  debts: Debt[];
  settings: Settings;
}

export const EXPENSE_CATEGORIES = [
  'Rent', 'Utilities', 'Groceries', 'Dining', 'Commute', 'Phone', 'Shopping',
  'Health', 'Subscriptions', 'Travel', 'Family', 'Fees', 'Other',
];
export const INCOME_CATEGORIES = ['Salary', 'Bonus', 'Refund', 'Interest', 'Other'];
