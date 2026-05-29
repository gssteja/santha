import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppCard } from '@/components/AppCard';
import { fetchApps } from '@/lib/store';
import type { StoreApp } from '@/types';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; apps: StoreApp[] };

export default function Store() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const apps = await fetchApps();
      setState({ status: 'ready', apps });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.title}>Santha</Text>
      <Text style={styles.subtitle}>Anni apps ikkade.</Text>

      {state.status === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color="#e8b04b" />
          <Text style={styles.muted}>Aagannu.</Text>
        </View>
      )}

      {state.status === 'error' && (
        <View style={styles.center}>
          <Text style={styles.errTitle}>Emi jarigindo.</Text>
          <Text style={styles.muted}>
            Server andatledu. Net chusko, malli try cheyyi.
          </Text>
          <Pressable style={styles.retry} onPress={load}>
            <Text style={styles.retryText}>Malli</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'ready' && (
        <FlatList
          data={state.apps}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => <AppCard app={item} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 16 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#e8b04b"
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.errTitle}>Emee ledu.</Text>
              <Text style={styles.muted}>
                Inka apps deploy cheyyaledu. Khaali store, khaali batuku.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d10', paddingHorizontal: 18 },
  title: { color: '#f5f5f7', fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: '#9a9aa4', fontSize: 15, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 80 },
  muted: { color: '#9a9aa4', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  errTitle: { color: '#f5f5f7', fontSize: 18, fontWeight: '700' },
  retry: {
    marginTop: 12,
    backgroundColor: '#e8b04b',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  retryText: { color: '#0d0d10', fontWeight: '700' },
});
