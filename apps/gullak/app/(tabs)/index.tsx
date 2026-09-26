import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bar, Card, MonthSwitcher, Row, Screen, s } from '@/components/ui';
import { C, F, RADIUS } from '@/constants/theme';
import { debtStatus, project } from '@/lib/debt';
import { fmt, monthKey, monthLabel, shortDate, todayISO } from '@/lib/money';
import { monthSummary, txnTitle } from '@/lib/summary';
import { useFinance } from '@/store/FinanceContext';
import type { TxnKind } from '@/types/finance';

export default function Home() {
  const router = useRouter();
  const { txns, debts, settings } = useFinance();
  const [month, setMonth] = useState(monthKey(todayISO()));
  const sum = useMemo(() => monthSummary(txns, month, settings.fx), [txns, month, settings.fx]);
  const recent = useMemo(() => txns.filter(t => monthKey(t.date) === month).slice(0, 6), [txns, month]);
  const debtRows = useMemo(() => debts.map(d => {
    const st = debtStatus(d, txns, settings.fx);
    return { d, st, pj: project(d, st, settings.fx) };
  }), [debts, txns, settings.fx]);

  const add = (kind: TxnKind) => router.push({ pathname: '/add', params: { kind } });
  const overBudget = sum.spent > settings.budget;
  const topCat = sum.byCategory[0]?.amount ?? 0;

  return (
    <Screen title="Gullak">
      <View style={st.quick}>
        <QuickAdd label="Expense" onPress={() => add('expense')} />
        <QuickAdd label="Paycheck" onPress={() => add('income')} />
        <QuickAdd label="Debt payment" onPress={() => add('debt')} />
      </View>

      <MonthSwitcher value={month} onChange={setMonth} />

      <Card>
        <Text style={s.muted}>Left over in {monthLabel(month)}</Text>
        <Text style={[s.big, { color: sum.left < 0 ? C.red : C.text }]}>{fmt(sum.left, 'USD')}</Text>
        <View style={st.split}>
          <Stat label="Income" value={fmt(sum.income, 'USD')} color={C.green} />
          <Stat label="Spent" value={fmt(sum.spent, 'USD')} />
          <Stat label="To debt" value={fmt(sum.debtPaid, 'USD')} />
        </View>
      </Card>

      <Card>
        <View style={st.between}>
          <Text style={s.rowLeft}>Budget</Text>
          <Text style={[s.muted, overBudget && { color: C.red }]}>
            {fmt(sum.spent, 'USD')} of {fmt(settings.budget, 'USD')}
          </Text>
        </View>
        <Bar value={settings.budget ? sum.spent / settings.budget : 0} color={overBudget ? C.red : C.accent} />
        {sum.byCategory.length ? (
          <View style={{ marginTop: 14 }}>
            {sum.byCategory.slice(0, 6).map(c => (
              <View key={c.category} style={{ marginBottom: 10 }}>
                <View style={st.between}>
                  <Text style={st.catName}>{c.category}</Text>
                  <Text style={st.catVal}>{fmt(c.amount, 'USD')}</Text>
                </View>
                <Bar value={topCat ? c.amount / topCat : 0} color={C.text3} />
              </View>
            ))}
          </View>
        ) : (
          <Text style={[s.muted, { marginTop: 10 }]}>No expenses logged this month.</Text>
        )}
      </Card>

      {debtRows.length ? (
        <>
          <Text style={s.sectionTitle}>Debts</Text>
          <Card>
            {debtRows.map(({ d, st: status, pj }) => (
              <Row
                key={d.id}
                left={d.name}
                sub={status.balance < 0.5 ? 'Paid off' : pj.payoffMonth ? `Paid off by ${monthLabel(pj.payoffMonth)} at plan pace` : 'Plan payment does not cover interest'}
                right={fmt(status.balance, d.currency)}
                onPress={() => router.push('/debts')}
              />
            ))}
          </Card>
        </>
      ) : null}

      <Text style={s.sectionTitle}>Recent</Text>
      <Card>
        {recent.length ? recent.map(t => (
          <Row
            key={t.id}
            left={txnTitle(t, debts)}
            sub={[shortDate(t.date), t.note].filter(Boolean).join(' · ')}
            right={fmt(t.amount, t.currency, { sign: t.kind === 'income' })}
            rightColor={t.kind === 'income' ? C.green : undefined}
            onPress={() => router.push({ pathname: '/add', params: { id: t.id } })}
          />
        )) : <Text style={s.muted}>Nothing yet. Use the buttons above to log something.</Text>}
      </Card>
    </Screen>
  );
}

function QuickAdd({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.quickBtn, pressed && { opacity: 0.7 }]}>
      <Text style={st.quickPlus}>+</Text>
      <Text style={st.quickText}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.muted}>{label}</Text>
      <Text style={[st.statVal, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  quick: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  quickBtn: { flex: 1, backgroundColor: C.surface, borderColor: C.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center' },
  quickPlus: { color: C.accent, fontSize: F.xl, fontWeight: '800', lineHeight: 22 },
  quickText: { color: C.text, fontSize: F.sm, fontWeight: '600', marginTop: 2 },
  split: { flexDirection: 'row', marginTop: 14 },
  statVal: { color: C.text, fontSize: F.lg, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  catName: { color: C.text2, fontSize: F.sm },
  catVal: { color: C.text, fontSize: F.sm, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
