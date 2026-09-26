import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chip, Field, Label, Segmented, s } from '@/components/ui';
import { C, F, RADIUS } from '@/constants/theme';
import { convert, fmt, iso, isValidISO, parseAmount, todayISO } from '@/lib/money';
import { useFinance } from '@/store/FinanceContext';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, type Currency, type TxnKind } from '@/types/finance';

type Params = { kind?: string; id?: string; debtId?: string };

export default function AddTxn() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<Params>();
  const { txns, debts, settings, addTxn, updateTxn, deleteTxn } = useFinance();
  const editing = useMemo(() => txns.find(t => t.id === params.id), [txns, params.id]);

  const initialKind: TxnKind = editing?.kind ?? (params.kind === 'income' || params.kind === 'debt' ? params.kind : 'expense');
  const lastSalary = useMemo(() => txns.find(t => t.kind === 'income' && t.category === 'Salary'), [txns]);

  const [kind, setKind] = useState<TxnKind>(initialKind);
  const [amount, setAmount] = useState(
    editing ? String(editing.amount) : initialKind === 'income' && lastSalary ? String(lastSalary.amount) : '',
  );
  const [currency, setCurrency] = useState<Currency>(editing?.currency ?? 'USD');
  const [category, setCategory] = useState(editing?.category ?? (initialKind === 'income' ? 'Salary' : ''));
  const [debtId, setDebtId] = useState(editing?.debtId ?? params.debtId ?? debts[0]?.id ?? '');
  const [credited, setCredited] = useState(editing?.credited ? String(editing.credited) : '');
  const [date, setDate] = useState(editing?.date ?? todayISO());
  const [note, setNote] = useState(editing?.note ?? '');

  const debt = debts.find(d => d.id === debtId);
  const amt = parseAmount(amount);
  const crossCurrency = kind === 'debt' && debt && debt.currency !== currency;
  const categories = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const switchKind = (k: TxnKind) => {
    setKind(k);
    if (k === 'income') {
      setCategory('Salary');
      if (!editing && !amount && lastSalary) setAmount(String(lastSalary.amount));
    } else if (k === 'expense') {
      setCategory('');
    }
  };

  const save = () => {
    if (!(amt > 0)) return Alert.alert('Enter an amount');
    if (!isValidISO(date)) return Alert.alert('Date must look like 2026-10-16');
    if (kind === 'debt' && !debt) return Alert.alert('Pick which debt this pays');
    if (kind !== 'debt' && !category) return Alert.alert('Pick a category');
    const cr = parseAmount(credited);
    const rec = {
      kind,
      amount: amt,
      currency,
      date,
      category: kind === 'debt' ? 'Debt payment' : category,
      note: note.trim(),
      debtId: kind === 'debt' ? debtId : undefined,
      credited: crossCurrency && cr > 0 ? cr : undefined,
    };
    if (editing) updateTxn(editing.id, rec);
    else addTxn(rec);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.back();
  };

  const remove = () => {
    if (!editing) return;
    Alert.alert('Delete this entry?', `${fmt(editing.amount, editing.currency)} on ${editing.date}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteTxn(editing.id); router.back(); } },
    ]);
  };

  const yesterday = iso(new Date(Date.now() - 86400000));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={st.header}>
          <Text style={s.title}>{editing ? 'Edit entry' : 'New entry'}</Text>
          <Pressable onPress={() => router.back()} hitSlop={12}><Text style={st.close}>✕</Text></Pressable>
        </View>

        <Segmented<TxnKind>
          value={kind}
          onChange={switchKind}
          options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'debt', label: 'Debt payment' }]}
        />

        <View style={st.amountRow}>
          <Pressable onPress={() => setCurrency(c => (c === 'USD' ? 'INR' : 'USD'))} style={st.curBtn}>
            <Text style={st.curText}>{currency === 'USD' ? '$' : '₹'}</Text>
            <Text style={st.curHint}>{currency}</Text>
          </Pressable>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            placeholderTextColor={C.text3}
            keyboardType="decimal-pad"
            style={st.amount}
            autoFocus={!editing}
          />
        </View>
        <Text style={[s.muted, { marginBottom: 16 }]}>Tap the symbol to switch between dollars and rupees.</Text>

        {kind === 'debt' ? (
          <>
            <Label>Pays off</Label>
            <View style={st.wrap}>
              {debts.map(d => <Chip key={d.id} label={d.name} active={debtId === d.id} onPress={() => setDebtId(d.id)} />)}
            </View>
            {crossCurrency && debt ? (
              <Field
                label={`Credited to ${debt.name} (${debt.currency === 'INR' ? '₹' : '$'}, optional)`}
                value={credited}
                onChangeText={setCredited}
                keyboardType="decimal-pad"
                placeholder={amt > 0 ? `about ${fmt(convert(amt, currency, debt.currency, settings.fx), debt.currency)} at ${settings.fx}` : 'what the lender received'}
              />
            ) : null}
          </>
        ) : (
          <>
            <Label>Category</Label>
            <View style={st.wrap}>
              {categories.map(c => <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />)}
            </View>
          </>
        )}

        <Label>Date</Label>
        <View style={[st.wrap, { alignItems: 'center' }]}>
          <Chip label="Today" active={date === todayISO()} onPress={() => setDate(todayISO())} />
          <Chip label="Yesterday" active={date === yesterday} onPress={() => setDate(yesterday)} />
          <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={C.text3} style={[s.input, st.dateInput]} />
        </View>

        <Field label="Note" value={note} onChangeText={setNote} placeholder="optional" />

        <Button label={editing ? 'Save changes' : 'Save'} onPress={save} />
        {editing ? <Button label="Delete" kind="danger" style={{ marginTop: 10 }} onPress={remove} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  close: { color: C.text2, fontSize: F.xl },
  amountRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, paddingHorizontal: 12, marginBottom: 6 },
  curBtn: { alignItems: 'center', paddingRight: 12, marginRight: 8, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: C.border },
  curText: { color: C.accent, fontSize: F.xxl, fontWeight: '800' },
  curHint: { color: C.text3, fontSize: F.xs, fontWeight: '600' },
  amount: { flex: 1, color: C.text, fontSize: 38, fontWeight: '800', paddingVertical: 14, fontVariant: ['tabular-nums'] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  dateInput: { flex: 1, minWidth: 130, marginBottom: 8, paddingVertical: 7 },
});
