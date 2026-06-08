import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/store/StoreContext';
import { ProgressChart, cleanExName } from '@/components/ProgressChart';
import { C, F } from '@/constants/theme';

function fmtTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { history } = useStore();
  const [chartExercise, setChartExercise] = useState<string | null>(null);

  return (
    <>
    {chartExercise && (
      <ProgressChart exerciseName={chartExercise} onClose={() => setChartExercise(null)} />
    )}
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.pageHeader}>
        <Text style={styles.title}>History</Text>
      </View>

      {history.length === 0 ? (
        <Text style={styles.empty}>No workouts yet.</Text>
      ) : (
        history.map(w => (
          <View key={w.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardName}>{w.name}</Text>
              <Text style={styles.cardDate}>{fmtDate(w.date)}</Text>
            </View>

            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statVal}>{fmtTime(w.duration)}</Text>
                <Text style={styles.statLabel}>Duration</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statVal}>{w.sets}</Text>
                <Text style={styles.statLabel}>Sets</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statVal}>{w.volume.toLocaleString()}</Text>
                <Text style={styles.statLabel}>lb volume</Text>
              </View>
            </View>

            {/* Per-exercise breakdown — tap name to see progression chart */}
            {w.exerciseData && w.exerciseData.length > 0 && (
              <View style={styles.breakdown}>
                {w.exerciseData.map((ex, i) => (
                  <View key={i} style={styles.exRow}>
                    <TouchableOpacity onPress={() => setChartExercise(ex.name)}>
                      <Text style={styles.exName}>{cleanExName(ex.name)}</Text>
                    </TouchableOpacity>
                    <Text style={styles.exSets}>
                      {ex.sets.map(s => `${s.weight}×${s.reps}`).join('  ')}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {!w.exerciseData && (
              <View style={styles.exTags}>
                {w.exercises.map(e => (
                  <View key={e} style={styles.exTag}>
                    <Text style={styles.exTagText}>{e}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ))
      )}
    </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { paddingBottom: 100 },
  pageHeader: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: F.xxxl, fontWeight: '700', color: C.text },
  empty: { paddingHorizontal: 20, color: C.text3, fontSize: F.base, lineHeight: 24 },
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 16,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  cardName: { color: C.text, fontSize: F.base, fontWeight: '700', flex: 1 },
  cardDate: { color: C.text2, fontSize: F.xs, marginLeft: 8 },
  stats: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { color: C.text, fontSize: F.xl, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLabel: { color: C.text3, fontSize: F.xs, marginTop: 2 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 32, backgroundColor: C.border },
  breakdown: { gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 10 },
  exRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  exName: { color: C.text2, fontSize: F.xs, fontWeight: '600', flex: 1 },
  exSets: { color: C.text3, fontSize: F.xs, fontVariant: ['tabular-nums'] },
  exTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  exTag: {
    backgroundColor: C.surface2,
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  exTagText: { color: C.text2, fontSize: F.xs, fontWeight: '600' },
});
