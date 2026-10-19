import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Field, s } from '@/components/ui';
import { C, F } from '@/constants/theme';
import { isValidISO, parseAmount, todayISO } from '@/lib/money';
import { useFinance } from '@/store/FinanceContext';

export default function EditAccount() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { accounts, saveAccount, deleteAccount } = useFinance();
  const acct = accounts.find(a => a.id === id);

  const [name, setName] = useState(acct?.name ?? '');
  const [balance, setBalance] = useState(acct ? String(acct.balance) : '');
  // Editing the balance usually means checking it today.
  const [asOf, setAsOf] = useState(todayISO());

  const save = () => {
    const b = parseAmount(balance);
    if (!name.trim()) return Alert.alert('Give it a name');
    if (!Number.isFinite(b)) return Alert.alert('Enter the balance');
    if (!isValidISO(asOf)) return Alert.alert('Date must look like 2026-10-18');
    saveAccount({ id: acct?.id, name: name.trim(), balance: b, asOf });
    router.back();
  };

  const remove = () => {
    if (!acct) return;
    Alert.alert(`Remove ${acct.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { deleteAccount(acct.id); router.back(); } },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={st.header}>
        <Text style={s.title}>{acct ? 'Edit account' : 'New account'}</Text>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={st.close}>✕</Text></Pressable>
      </View>

      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Citizens checking" />
      <Field label="Balance ($)" value={balance} onChangeText={setBalance} keyboardType="decimal-pad" />
      <Field label="Balance as of (YYYY-MM-DD)" value={asOf} onChangeText={setAsOf} />
      <Text style={[s.muted, { marginBottom: 16 }]}>
        Logged expenses don't change this number. Update it when you check the bank.
      </Text>

      <Button label="Save" onPress={save} />
      {acct ? <Button label="Remove account" kind="danger" style={{ marginTop: 10 }} onPress={remove} /> : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  close: { color: C.text2, fontSize: F.xl },
});
