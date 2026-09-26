import type { Currency } from '@/types/finance';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Hand-rolled grouping: Hermes' Intl coverage for en-IN varies by device.
function groupUS(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function groupIN(int: string): string {
  if (int.length <= 3) return int;
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

export function fmt(amount: number, currency: Currency, opts: { cents?: boolean; sign?: boolean } = {}): string {
  const neg = amount < 0;
  const abs = Math.abs(amount);
  const cents = opts.cents ?? (currency === 'USD' && Math.abs(abs - Math.round(abs)) > 0.004);
  const fixed = abs.toFixed(cents ? 2 : 0);
  const [int, dec] = fixed.split('.');
  const grouped = currency === 'INR' ? groupIN(int) : groupUS(int);
  const sym = currency === 'INR' ? '₹' : '$';
  const sign = neg ? '−' : opts.sign ? '+' : '';
  return `${sign}${sym}${grouped}${dec ? '.' + dec : ''}`;
}

export function toUSD(amount: number, currency: Currency, fx: number): number {
  return currency === 'USD' ? amount : amount / fx;
}
export function convert(amount: number, from: Currency, to: Currency, fx: number): number {
  if (from === to) return amount;
  return from === 'USD' ? amount * fx : amount / fx;
}

// ── dates (local, YYYY-MM-DD strings) ─────────────────────────────────────────
export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function todayISO(): string {
  return iso(new Date());
}
export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function isValidISO(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return iso(parseISO(s)) === s;
}
export function monthKey(date: string): string {
  return date.slice(0, 7);
}
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
export function dayLabel(date: string): string {
  const d = parseISO(date);
  const t = todayISO();
  if (date === t) return 'Today';
  if (date === iso(new Date(Date.now() - 86400000))) return 'Yesterday';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  return `${wd}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export function shortDate(date: string): string {
  const d = parseISO(date);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function parseAmount(s: string): number {
  const n = Number(s.replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
