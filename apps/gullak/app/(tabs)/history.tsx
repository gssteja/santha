import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Card, Chip, MonthSwitcher, Row, Screen, s } from '@/components/ui';
import { C } from '@/constants/theme';
import { dayLabel, fmt, monthKey, todayISO } from '@/lib/money';
import { monthSummary, txnTitle } from '@/lib/summary';
import { useFinance } from '@/store/FinanceContext';
import type { Txn, TxnKind } from '@/types/finance';

const FILTERS: { value: 'all' | TxnKind; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
  { value: 'debt', label: 'Debt' },
];

export default function History() {
  const router = useRouter();
  const { txns, debts, settings } = useFinance();
  const [month, setMonth] = useState(monthKey(todayISO()));
  const [filter, setFilter] = useState<'all' | TxnKind>('all');

  const sum = useMemo(() => monthSummary(txns, month, settings.fx), [txns, month, settings.fx]);
  const groups = useMemo(() => {
    const out: { date: string; items: Txn[] }[] = [];
    for (const t of txns) {
      if (monthKey(t.date) !== month || (filter !== 'all' && t.kind !== filter)) continue;
      const last = out[out.length - 1];
      if (last && last.date === t.date) last.items.push(t);
      else out.push({ date: t.date, items: [t] });
    }
    return out;
  }, [txns, month, filter]);

  return (
    <Screen title="History">
      <MonthSwitcher value={month} onChange={setMonth} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
        {FILTERS.map(f => <Chip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} />)}
      </View>
      <Text style={[s.muted, { marginBottom: 12 }]}>
        In {fmt(sum.income, 'USD')} · Spent {fmt(sum.spent, 'USD')} · Debt {fmt(sum.debtPaid, 'USD')}
      </Text>
      {groups.length ? groups.map(g => (
        <View key={g.date}>
          <Text style={s.sectionTitle}>{dayLabel(g.date)}</Text>
          <Card>
            {g.items.map(t => (
              <Row
                key={t.id}
                left={txnTitle(t, debts)}
                sub={t.note || (t.kind === 'debt' ? 'Debt payment' : t.kind === 'income' ? 'Income' : undefined)}
                right={fmt(t.amount, t.currency, { sign: t.kind === 'income' })}
                rightColor={t.kind === 'income' ? C.green : undefined}
                onPress={() => router.push({ pathname: '/add', params: { id: t.id } })}
              />
            ))}
          </Card>
        </View>
      )) : <Card><Text style={s.muted}>Nothing logged for this month.</Text></Card>}
    </Screen>
  );
}
