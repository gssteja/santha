import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Bar, Button, Card, Screen, s } from '@/components/ui';
import { C, F } from '@/constants/theme';
import { debtStatus, project, promoMonthly } from '@/lib/debt';
import { fmt, monthKey, monthLabel, shortDate, toUSD } from '@/lib/money';
import { useFinance } from '@/store/FinanceContext';

export default function Debts() {
  const router = useRouter();
  const { txns, debts, settings } = useFinance();
  const rows = useMemo(() => debts.map(d => {
    const st = debtStatus(d, txns, settings.fx);
    return { d, st, pj: project(d, st, settings.fx), promo: promoMonthly(d, st) };
  }), [debts, txns, settings.fx]);

  const totalUSD = rows.reduce((a, r) => a + toUSD(r.st.balance, r.d.currency, settings.fx), 0);
  const lastPayoff = rows.every(r => r.st.balance < 0.5 || r.pj.payoffMonth)
    ? rows.map(r => r.pj.payoffMonth).filter((k): k is string => !!k).sort().pop()
    : undefined;

  return (
    <Screen title="Debts">
      <Card>
        <Text style={s.muted}>Total owed</Text>
        <Text style={s.big}>{fmt(totalUSD, 'USD')}</Text>
        <Text style={s.muted}>
          {lastPayoff ? `Debt-free by ${monthLabel(lastPayoff)} at plan pace` : rows.length ? 'Set a plan payment on each debt to see a payoff date' : 'No debts'}
        </Text>
      </Card>

      {rows.map(({ d, st, pj, promo }) => {
        const promoRisk = !!d.promoEnd && st.balance > 0.5 && (!pj.payoffMonth || pj.payoffMonth >= monthKey(d.promoEnd));
        return (
          <Card key={d.id}>
            <View style={st2.between}>
              <Text style={st2.name}>{d.name}</Text>
              <Text style={s.muted}>{d.rate ? `${d.rate}% p.a.` : '0%'}</Text>
            </View>
            <Text style={[s.mid, { marginTop: 6 }]}>{fmt(st.balance, d.currency)}</Text>
            {d.currency !== 'USD' ? <Text style={s.muted}>≈ {fmt(toUSD(st.balance, d.currency, settings.fx), 'USD')}</Text> : null}
            <Bar value={st.progress} color={C.green} />
            <Text style={[s.muted, { marginTop: 6 }]}>
              {Math.round(st.progress * 100)}% paid of {fmt(d.startBalance, d.currency)} since {shortDate(d.startDate)}
            </Text>

            <View style={st2.facts}>
              <Fact label="Paid this month" value={fmt(st.paidThisMonth, d.currency)} />
              {d.rate ? <Fact label="Interest this month" value={fmt(st.interestThisMonth, d.currency)} /> : null}
              <Fact label="Plan" value={`${fmt(d.planned, 'USD')}/mo`} />
            </View>

            <Text style={st2.payoff}>
              {st.balance < 0.5
                ? 'Paid off.'
                : pj.payoffMonth
                  ? `Paid off by ${monthLabel(pj.payoffMonth)}${d.rate ? ` · about ${fmt(pj.futureInterest, d.currency)} more interest` : ''}`
                  : 'The plan payment does not cover the interest. Raise it.'}
            </Text>
            {promo != null && d.promoEnd ? (
              <Text style={[st2.warn, promoRisk && { color: C.red }]}>
                0% ends {shortDate(d.promoEnd)}. Pay {fmt(promo, d.currency)}/mo to clear it a month early
                {promoRisk ? '. At the current plan it will not be cleared in time, and deferred interest would be charged.' : '.'}
              </Text>
            ) : null}

            <View style={st2.actions}>
              <Button label="Log payment" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/add', params: { kind: 'debt', debtId: d.id } })} />
              <Button label="Edit" kind="ghost" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/debt', params: { id: d.id } })} />
            </View>
          </Card>
        );
      })}

      <Button label="Add a debt" kind="ghost" onPress={() => router.push('/debt')} />
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.muted}>{label}</Text>
      <Text style={st2.factVal}>{value}</Text>
    </View>
  );
}

const st2 = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: C.text, fontSize: F.lg, fontWeight: '700' },
  facts: { flexDirection: 'row', marginTop: 14 },
  factVal: { color: C.text, fontSize: F.base, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  payoff: { color: C.text2, fontSize: F.sm, marginTop: 12 },
  warn: { color: C.accent, fontSize: F.sm, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
});
