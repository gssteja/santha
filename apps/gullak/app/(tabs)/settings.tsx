import { useEffect, useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { Button, Card, Field, Screen, s } from '@/components/ui';
import { C } from '@/constants/theme';
import { parseAmount } from '@/lib/money';
import { useFinance } from '@/store/FinanceContext';

function ago(ms: number): string {
  const sec = Math.round((Date.now() - ms) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  return `${Math.round(sec / 3600)} h ago`;
}

export default function Settings() {
  const { settings, saveSettings, sync, syncNow, data, txns } = useFinance();
  const [fx, setFx] = useState(String(settings.fx));
  const [budget, setBudget] = useState(String(settings.budget));

  useEffect(() => {
    setFx(String(settings.fx));
    setBudget(String(settings.budget));
  }, [settings.fx, settings.budget]);

  const save = () => {
    const f = parseAmount(fx), b = parseAmount(budget);
    if (!(f > 0) || !(b >= 0)) {
      Alert.alert('Check the numbers', 'The exchange rate and budget must be positive numbers.');
      return;
    }
    saveSettings({ fx: f, budget: b });
    Alert.alert('Saved');
  };

  const exportData = () => {
    Share.share({ message: JSON.stringify(data, null, 2), title: 'Gullak backup' }).catch(() => {});
  };

  const syncText =
    sync.status === 'syncing' ? 'Syncing…'
      : sync.status === 'ok' && sync.at ? `Backed up ${ago(sync.at)}`
        : sync.status === 'error' ? `Not backed up: ${sync.message ?? 'error'}${sync.at ? ` (last ok ${ago(sync.at)})` : ''}`
          : 'Not synced yet';

  return (
    <Screen title="Settings">
      <Card>
        <Field label="Exchange rate (₹ per $1)" value={fx} onChangeText={setFx} keyboardType="decimal-pad" />
        <Field label="Monthly spending budget ($)" value={budget} onChangeText={setBudget} keyboardType="decimal-pad" />
        <Text style={[s.muted, { marginBottom: 14 }]}>
          The rate converts rupee entries into dollars for monthly totals, and dollar payments into rupees for the loan when you don't enter the credited amount.
        </Text>
        <Button label="Save" onPress={save} />
      </Card>

      <Card>
        <Text style={s.rowLeft}>Backup</Text>
        <Text style={[s.muted, { marginTop: 4, color: sync.status === 'error' ? C.red : C.text3 }]}>{syncText}</Text>
        <Text style={[s.muted, { marginTop: 4 }]}>{txns.length} entries. Everything is stored on this phone and synced to your Santha server.</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          <Button label="Sync now" kind="ghost" style={{ flex: 1 }} onPress={syncNow} />
          <Button label="Export JSON" kind="ghost" style={{ flex: 1 }} onPress={exportData} />
        </View>
      </Card>
    </Screen>
  );
}
