import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Bar, Button, Card, Screen, s } from '@/components/ui';
import { C, F } from '@/constants/theme';
import { debtStatus, isCard, project, promoMonthly, statementDue } from '@/lib/debt';
import { fmt, monthKey, monthLabel, relDays, shortDate, todayISO, toUSD } from '@/lib/money';
import { useFinance } from '@/store/FinanceContext';

export default function Debts() {
  const router = useRouter();
  const { txns, debts, settings } = useFinance();
  const rows = useMemo(() => debts.map(d => {
    const st = debtStatus(d, txns, settings.fx);
    return { d, st, pj: project(d, st, settings.fx), promo: promoMonthly(d, st), sd: statementDue(d, st), card: isCard(d) };
  }), [debts, txns, settings.fx]);

  const today = todayISO();
  const totalUSD = rows.reduce((a, r) => a + toUSD(r.st.balance, r.d.currency, settings.fx), 0);
  const dueUSD = rows.reduce((a, r) => a + (r.sd ? toUSD(r.sd.left, r.d.currency, settings.fx) : 0), 0);
  // Cards are cleared statement by statement, so only planned debts set the payoff date.
  const planRows = rows.filter(r => !r.card);
  const lastPayoff = planRows.every(r => r.st.balance < 0.5 || r.pj.payoffMonth)
    ? planRows.map(r => r.pj.payoffMonth).filter((k): k is string => !!k).sort().pop()
    : undefined;

  return (
    <Screen title="Debts">
      <Card>
        <Text style={s.muted}>Total owed</Text>
        <Text style={s.big}>{fmt(totalUSD, 'USD')}</Text>
        <Text style={s.muted}>
          {lastPayoff ? `Planned debts clear by ${monthLabel(lastPayoff)}` : planRows.length ? 'Set a plan payment on each debt to see a payoff date' : rows.length ? '' : 'No debts'}
        </Text>
        {dueUSD > 0.005 ? <Text style={[s.muted, { marginTop: 2 }]}>{fmt(dueUSD, 'USD')} of card statements still to pay</Text> : null}
      </Card>

      {rows.map(({ d, st, pj, promo, sd, card }) => {
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
              {card ? null : <Fact label="Plan" value={`${fmt(d.planned, 'USD')}/mo`} />}
            </View>

            {sd ? (
              <Text style={[st2.stmt, sd.overdue && { color: C.red }, sd.left < 0.005 && { color: C.green }]}>
                {sd.left < 0.005
                  ? `Statement of ${fmt(sd.amount, d.currency)} paid.`
                  : `Statement ${fmt(sd.amount, d.currency)} ${sd.overdue ? 'was due' : 'due'} ${shortDate(sd.due)} (${relDays(sd.due)})`
                    + (sd.left < sd.amount - 0.005 ? `. ${fmt(sd.left, d.currency)} left to pay.` : '')}
              </Text>
            ) : null}
            {d.statementDate ? (
              <Text style={[st2.payoff, sd && { marginTop: 4 }]}>
                {d.statementDate >= today
                  ? `Next statement closes ${shortDate(d.statementDate)} (${relDays(d.statementDate)}).`
                  : `A statement closed ${shortDate(d.statementDate)}. Enter it under Edit.`}
              </Text>
            ) : null}
            {card ? null : (
            <Text style={st2.payoff}>
              {st.balance < 0.5
                ? 'Paid off.'
                : pj.payoffMonth
                  ? `Paid off by ${monthLabel(pj.payoffMonth)}${d.rate ? ` · about ${fmt(pj.futureInterest, d.currency)} more interest` : ''}`
                  : 'The plan payment does not cover the interest. Raise it.'}
            </Text>
            )}
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
  stmt: { color: C.text, fontSize: F.sm, fontWeight: '600', marginTop: 12 },
  warn: { color: C.accent, fontSize: F.sm, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
});
