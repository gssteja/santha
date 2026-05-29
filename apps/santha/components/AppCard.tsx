import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { installApk, openPwa } from '@/lib/store';
import type { StoreApp } from '@/types';

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export function AppCard({ app }: { app: StoreApp }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const isApk = app.type === 'apk';

  async function onPress() {
    if (busy) return;
    try {
      if (isApk) {
        setBusy(true);
        setProgress(0);
        await installApk(app, setProgress);
      } else {
        await openPwa(app);
      }
    } catch (e) {
      Alert.alert('Emi jarigindo.', 'Very on-brand. Malli try cheyyi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.icon}>
        <Ionicons
          name={isApk ? 'cube' : 'globe-outline'}
          size={24}
          color="#e8b04b"
        />
      </View>

      <View style={styles.body}>
        <Text style={styles.name}>{app.name}</Text>
        {!!app.description && (
          <Text style={styles.desc} numberOfLines={2}>
            {app.description}
          </Text>
        )}
        <Text style={styles.meta}>
          {[
            isApk ? 'APK' : 'Web app',
            app.version ? `v${app.version}` : null,
            isApk ? formatSize(app.size) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>

      <Pressable
        style={[styles.btn, busy && styles.btnBusy]}
        onPress={onPress}
        disabled={busy}
      >
        {busy ? (
          <View style={styles.btnBusyInner}>
            <ActivityIndicator size="small" color="#0d0d10" />
            {isApk && progress > 0 && (
              <Text style={styles.btnText}>{Math.round(progress * 100)}%</Text>
            )}
          </View>
        ) : (
          <Text style={styles.btnText}>{isApk ? 'Install' : 'Open'}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16161b',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#222229',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  name: { color: '#f5f5f7', fontSize: 16, fontWeight: '700' },
  desc: { color: '#9a9aa4', fontSize: 13, marginTop: 2 },
  meta: { color: '#6a6a74', fontSize: 11, marginTop: 4 },
  btn: {
    backgroundColor: '#e8b04b',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    minWidth: 72,
    alignItems: 'center',
  },
  btnBusy: { opacity: 0.85 },
  btnBusyInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btnText: { color: '#0d0d10', fontWeight: '700', fontSize: 14 },
});
