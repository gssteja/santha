import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/store/StoreContext';
import { makeExerciseBlock } from '@/store/workoutStore';
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

const PUSH_DAY_TEMPLATE = [
  makeExerciseBlock('bench', 'Bench Press', 'Chest'),
  makeExerciseBlock('ohp', 'Overhead Press', 'Shoulders'),
  makeExerciseBlock('tricep-push', 'Tricep Pushdown', 'Triceps'),
];

export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeWorkout, history, startWorkout, addExercise } = useStore();
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (activeWorkout) {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - activeWorkout.startTime) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeWorkout?.id]);

  function handleStart() {
    startWorkout('Workout');
    router.push('/workout');
  }

  function handleTemplate() {
    startWorkout('Push Day');
    for (const ex of PUSH_DAY_TEMPLATE) addExercise(ex);
    router.push('/workout');
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const recent = history.slice(0, 3);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.pageHeader}>
        <Text style={styles.title}>Today</Text>
        <Text style={styles.date}>{today}</Text>
      </View>

      {/* Active workout banner */}
      {activeWorkout && (
        <TouchableOpacity style={styles.activeBanner} onPress={() => router.push('/workout')}>
          <View>
            <Text style={styles.bannerName}>{activeWorkout.name}</Text>
            <Text style={styles.bannerTimer}>{fmtTime(elapsed)}</Text>
          </View>
          <Text style={styles.bannerResume}>Resume →</Text>
        </TouchableOpacity>
      )}

      {/* Start cards */}
      {!activeWorkout && (
        <View style={styles.startCard}>
          <TouchableOpacity style={styles.btnPrimary} onPress={handleStart}>
            <Text style={styles.btnPrimaryText}>Finally.</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={handleTemplate}>
            <Text style={styles.btnSecondaryText}>Push Day Template</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Recent */}
      <Text style={styles.sectionLabel}>Recent</Text>
      {recent.length === 0 ? (
        <Text style={styles.empty}>No history. Acchi baat hai — nothing to be ashamed of yet.</Text>
      ) : (
        recent.map(w => (
          <View key={w.id} style={styles.historyRow}>
            <View>
              <Text style={styles.historyName}>{w.name}</Text>
              <Text style={styles.historyMeta}>
                {fmtDate(w.date)} · {fmtTime(w.duration)} · {w.sets} sets · {w.volume.toLocaleString()} kg
              </Text>
              <View style={styles.exTags}>
                {w.exercises.slice(0, 3).map(e => (
                  <View key={e} style={styles.exTag}>
                    <Text style={styles.exTagText}>{e}</Text>
                  </View>
                ))}
                {w.exercises.length > 3 && (
                  <Text style={styles.exTagMore}>+{w.exercises.length - 3}</Text>
                )}
              </View>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { paddingBottom: 100 },
  pageHeader: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: F.xxxl, fontWeight: '700', color: C.text },
  date: { fontSize: F.sm, color: C.text2, marginTop: 2 },
  activeBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: C.accent2,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bannerName: { color: '#fff', fontSize: F.sm, fontWeight: '600' },
  bannerTimer: { color: '#fff', fontSize: F.xxxl, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bannerResume: { color: 'rgba(255,255,255,0.7)', fontSize: F.sm },
  startCard: {
    marginHorizontal: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    marginBottom: 8,
  },
  btnPrimary: {
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: F.lg, fontWeight: '700' },
  btnSecondary: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnSecondaryText: { color: C.text, fontSize: F.sm, fontWeight: '600' },
  sectionLabel: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
    fontSize: F.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: C.text3,
  },
  empty: { paddingHorizontal: 20, color: C.text3, fontSize: F.sm, lineHeight: 20 },
  historyRow: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
  },
  historyName: { color: C.text, fontSize: F.base, fontWeight: '700' },
  historyMeta: { color: C.text2, fontSize: F.xs, marginTop: 3 },
  exTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  exTag: {
    backgroundColor: C.surface2,
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  exTagText: { color: C.text2, fontSize: F.xs, fontWeight: '600' },
  exTagMore: { color: C.text3, fontSize: F.xs, alignSelf: 'center' },
});
