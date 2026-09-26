import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Field, Label, Segmented, s } from '@/components/ui';
import { C, F } from '@/constants/theme';
import { isValidISO, parseAmount, todayISO } from '@/lib/money';
import { useFinance } from '@/store/FinanceContext';
import type { Currency } from '@/types/finance';

export default function EditDebt() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { debts, saveDebt, deleteDebt } = useFinance();
  const debt = debts.find(d => d.id === id);

  const [name, setName] = useState(debt?.name ?? '');
  const [currency, setCurrency] = useState<Currency>(debt?.currency ?? 'USD');
  const [balance, setBalance] = useState(debt ? String(debt.startBalance) : '');
  const [startDate, setStartDate] = useState(debt?.startDate ?? todayISO());
  const [rate, setRate] = useState(debt ? String(debt.rate) : '0');
  const [planned, setPlanned] = useState(debt ? String(debt.planned) : '');
  const [promoEnd, setPromoEnd] = useState(debt?.promoEnd ?? '');

  const save = () => {
    const b = parseAmount(balance), r = parseAmount(rate), p = parseAmount(planned || '0');
    if (!name.trim()) return Alert.alert('Give it a name');
    if (!(b >= 0)) return Alert.alert('Enter the balance');
    if (!(r >= 0)) return Alert.alert('Interest rate must be 0 or more');
    if (!(p >= 0)) return Alert.alert('Planned payment must be 0 or more');
    if (!isValidISO(startDate)) return Alert.alert('Balance date must look like 2026-10-11');
    if (promoEnd && !isValidISO(promoEnd)) return Alert.alert('Promo end must look like 2027-03-31, or be empty');
    saveDebt({ id: debt?.id, name: name.trim(), currency, startBalance: b, startDate, rate: r, planned: p, promoEnd: promoEnd || undefined });
    router.back();
  };

  const remove = () => {
    if (!debt) return;
    Alert.alert(`Delete ${debt.name}?`, 'Its logged payments stay in your history.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteDebt(debt.id); router.back(); } },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={st.header}>
        <Text style={s.title}>{debt ? 'Edit debt' : 'New debt'}</Text>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={st.close}>✕</Text></Pressable>
      </View>

      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Amex card" />
      <Label>Currency</Label>
      <Segmented<Currency> value={currency} onChange={setCurrency} options={[{ value: 'USD', label: 'Dollars ($)' }, { value: 'INR', label: 'Rupees (₹)' }]} />
      <Field label={`Balance (${currency === 'INR' ? '₹' : '$'})`} value={balance} onChangeText={setBalance} keyboardType="decimal-pad" />
      <Field label="Balance as of (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} />
      <Field label="Interest rate (% per year)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
      <Field label="Planned monthly payment ($)" value={planned} onChangeText={setPlanned} keyboardType="decimal-pad" />
      <Field label="0% promo ends (optional, YYYY-MM-DD)" value={promoEnd} onChangeText={setPromoEnd} placeholder="leave empty if none" />
      <Text style={[s.muted, { marginBottom: 16 }]}>
        If the bank changes a floating rate, or a statement shows a different balance, update the balance and its date here.
        Payments logged before that date are then ignored for this debt.
      </Text>

      <Button label="Save" onPress={save} />
      {debt ? <Button label="Delete debt" kind="danger" style={{ marginTop: 10 }} onPress={remove} /> : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  close: { color: C.text2, fontSize: F.xl },
});
