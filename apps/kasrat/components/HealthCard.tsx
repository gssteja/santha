import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useHealth } from '@/store/HealthContext';
import { openHealthSettings } from '@/store/health';
import type { DailyHealth } from '@/store/health';
import { C, F, FONT, HEAT, RADIUS } from '@/constants/theme';
import { Surface } from '@/components/ui/Surface';
import { haptics } from '@/components/ui/haptics';

function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function fmtAgo(ts: number) {
  const min = Math.round((Date.now() - ts) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** Newest day (today backwards) that has the field. */
function latest<K extends keyof DailyHealth>(days: DailyHealth[], key: K): DailyHealth[K] | undefined {
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i][key] !== undefined) return days[i][key];
  }
  return undefined;
}

// Body-tab card for Health Connect: connect prompt, or what the watch and other apps reported.
export function HealthCard() {
  const { status, days, today, lastNight, recovery, lastSyncAt, syncing, sync, connect } = useHealth();
  if (!status || status === 'unsupported') return null;

  if (status !== 'connected') {
    const needsUpdate = status === 'needs-update';
    return (
      <Surface style={styles.card}>
        <Text style={styles.kicker}>HEALTH CONNECT</Text>
        <Text style={styles.body}>
          {needsUpdate
            ? 'Update Health Connect from the Play Store to link Samsung Health and your watch.'
            : 'Pull sleep, heart rate, HRV and weigh-ins from Samsung Health and your watch. Workouts get their heart rate and calories, and Kasrat shares sessions you didn’t track there.'}
        </Text>
        {!needsUpdate && (
          <TouchableOpacity
            style={styles.btn}
            onPress={() => { haptics.tap(); connect(); }}
            accessibilityRole="button"
            accessibilityLabel="Connect Health Connect"
          >
            <Text style={styles.btnText}>Connect</Text>
          </TouchableOpacity>
        )}
      </Surface>
    );
  }

  const tiles: { label: string; value: string; sub?: string }[] = [];
  if (lastNight) {
    const stages = [lastNight.deep != null && `${lastNight.deep}m deep`, lastNight.rem != null && `${lastNight.rem}m REM`]
      .filter(Boolean)
      .join(' · ');
    tiles.push({ label: 'Sleep', value: fmtMinutes(lastNight.minutes), sub: stages || undefined });
  }
  const rhr = latest(days, 'restingHr');
  if (rhr !== undefined) tiles.push({ label: 'Resting HR', value: `${rhr}`, sub: 'bpm' });
  const hrv = latest(days, 'hrv');
  if (hrv !== undefined) tiles.push({ label: 'HRV', value: `${Math.round(hrv)}`, sub: 'ms' });
  if (today?.steps !== undefined) tiles.push({ label: 'Steps', value: today.steps.toLocaleString(), sub: 'today' });
  if (today?.activeKcal !== undefined) tiles.push({ label: 'Active', value: `${today.activeKcal}`, sub: 'kcal today' });
  const spo2 = latest(days, 'spo2');
  if (spo2 !== undefined) tiles.push({ label: 'SpO₂', value: `${Math.round(spo2)}%` });
  const vo2 = latest(days, 'vo2max');
  if (vo2 !== undefined) tiles.push({ label: 'VO₂ max', value: `${vo2}` });
  const fat = latest(days, 'bodyFatPct');
  if (fat !== undefined) tiles.push({ label: 'Body fat', value: `${fat}%` });
  if (today?.food?.proteinG) tiles.push({ label: 'Protein', value: `${today.food.proteinG} g`, sub: 'today' });

  return (
    <Surface style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.kicker}>HEALTH CONNECT</Text>
        <TouchableOpacity
          onPress={() => { haptics.tap(); sync(); }}
          disabled={syncing}
          accessibilityRole="button"
          accessibilityLabel="Sync Health Connect now"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.sync}>{syncing ? 'Syncing…' : lastSyncAt ? `Synced ${fmtAgo(lastSyncAt)} ↻` : 'Sync ↻'}</Text>
        </TouchableOpacity>
      </View>

      {tiles.length ? (
        <View style={styles.grid}>
          {tiles.map(t => (
            <View key={t.label} style={styles.tile}>
              <Text style={styles.tileLabel}>{t.label}</Text>
              <Text style={styles.tileValue}>{t.value}</Text>
              {!!t.sub && <Text style={styles.tileSub}>{t.sub}</Text>}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.body}>{syncing ? 'Reading…' : 'Nothing from your watch yet. Wear it overnight and check back.'}</Text>
      )}

      {recovery && recovery.flag !== 0 && (
        <Text style={[styles.recovery, { color: recovery.flag < 0 ? HEAT.cool : HEAT.white }]}>{recovery.note}</Text>
      )}

      <TouchableOpacity
        onPress={() => { haptics.tap(); openHealthSettings(); }}
        accessibilityRole="button"
        accessibilityLabel="Manage Health Connect permissions"
      >
        <Text style={styles.manage}>Manage permissions</Text>
      </TouchableOpacity>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 12, padding: 16, gap: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { fontSize: F.xs, fontFamily: FONT.bold, letterSpacing: 1.5, color: C.text3 },
  sync: { fontSize: F.xs, fontFamily: FONT.semi, color: C.text2 },
  body: { fontSize: F.sm, color: C.text2, lineHeight: 19 },
  btn: {
    backgroundColor: C.accent,
    borderRadius: RADIUS.md,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: '#0e0c09', fontSize: F.base, fontFamily: FONT.xbold, letterSpacing: 0.3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '31.5%',
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: RADIUS.sm,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  tileLabel: { fontSize: F.xs, fontFamily: FONT.medium, color: C.text3, letterSpacing: 0.3 },
  tileValue: { fontSize: F.lg, fontFamily: FONT.xbold, color: C.text, marginTop: 3, fontVariant: ['tabular-nums'] },
  tileSub: { fontSize: 10, color: C.text3, marginTop: 1 },
  recovery: { fontSize: F.sm, fontFamily: FONT.semi },
  manage: { fontSize: F.xs, fontFamily: FONT.semi, color: C.accent },
});
