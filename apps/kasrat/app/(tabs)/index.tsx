import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/store/StoreContext';
import { makeProgramExerciseBlock } from '@/store/workoutStore';
import { PROGRAMS, isHeavyWeek, isWaved, resolveReps, repsToInput, repSequence } from '@/store/programs';
import { C, F } from '@/constants/theme';

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

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

function fmtAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeWorkout, history, startWorkout, addExercise, getPhaseSets, syncing, lastSyncedAt } = useStore();
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

  const activeProgram = PROGRAMS[0];

  // Derive the next program day from logged history (not a local pointer that's lost on
  // reinstall): find the most recent workout matching a program day, suggest the next one.
  const { dayIndex, week } = useMemo(() => {
    const days = activeProgram?.days ?? [];
    if (!days.length) return { dayIndex: 0, week: 1 };
    for (const rec of history) {
      const idx = days.findIndex(d => d.name === rec.name);
      if (idx >= 0) {
        const lastWeek = rec.week ?? 1;
        const nextIdx = (idx + 1) % days.length;
        return { dayIndex: nextIdx, week: nextIdx === 0 ? lastWeek + 1 : lastWeek };
      }
    }
    return { dayIndex: 0, week: 1 };
  }, [history, activeProgram]);

  const nextDay = activeProgram?.days[dayIndex];
  const heavy = isHeavyWeek(week);

  function handleStartNextDay() {
    if (!nextDay) return handleStart();
    startWorkout(nextDay.name, week);
    for (const ex of nextDay.exercises) {
      const waved = isWaved(ex.reps);
      const perSide = !!ex.perSide || /\/\s*side/i.test(ex.reps);
      const target = `${ex.sets}×${resolveReps(ex.reps, week)}`;
      const drops = ex.dropSet ? repSequence(ex.reps, week).slice(1) : [];
      addExercise(
        makeProgramExerciseBlock(
          slugify(ex.name),
          ex.name,
          ex.muscle ?? '',
          ex.sets,
          repsToInput(ex.reps, week),
          getPhaseSets(ex.name, week, waved),
          { perSide, target, waved, heavy: waved && heavy, note: ex.note, drops },
        ),
      );
    }
    router.push('/workout');
  }

  function handleStart() {
    startWorkout('Workout');
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
        <View style={styles.syncRow}>
          <View style={[styles.syncDot, syncing ? styles.syncDotBusy : lastSyncedAt ? styles.syncDotOk : styles.syncDotIdle]} />
          <Text style={styles.syncText}>
            {syncing ? 'Syncing…' : lastSyncedAt ? `Synced ${fmtAgo(lastSyncedAt)}` : 'Not synced yet'}
          </Text>
        </View>
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

      {/* Next program day */}
      {!activeWorkout && (
        <View style={styles.startCard}>
          {nextDay && (
            <View style={styles.nextHeader}>
              <Text style={styles.nextLabel}>Next up</Text>
              <Text style={styles.weekChip}>
                Week {week} · {heavy ? 'Heavy' : 'Light'}
              </Text>
            </View>
          )}
          {nextDay && <Text style={styles.nextDayName}>{nextDay.name}</Text>}
          {nextDay && (
            <View style={styles.exList}>
              {nextDay.exercises.map((ex, i) => (
                <View key={i} style={styles.exRow}>
                  <Text style={styles.exName} numberOfLines={1}>{ex.name}</Text>
                  <View style={styles.exTarget}>
                    {isWaved(ex.reps) && (
                      <Text style={styles.waveTag}>{heavy ? 'HEAVY' : 'LIGHT'}</Text>
                    )}
                    <Text style={styles.exSetsReps}>
                      {ex.sets}×{resolveReps(ex.reps, week)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
          <TouchableOpacity style={styles.btnPrimary} onPress={handleStartNextDay}>
            <Text style={styles.btnPrimaryText}>
              {nextDay ? 'Start' : 'Start workout'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={handleStart}>
            <Text style={styles.btnSecondaryText}>Empty workout</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Recent */}
      <Text style={styles.sectionLabel}>Recent</Text>
      {recent.length === 0 ? (
        <Text style={styles.empty}>No workouts yet.</Text>
      ) : (
        recent.map(w => (
          <View key={w.id} style={styles.historyRow}>
            <View>
              <Text style={styles.historyName}>{w.name}</Text>
              <Text style={styles.historyMeta}>
                {fmtDate(w.date)} · {fmtTime(w.duration)} · {w.sets} sets · {w.volume.toLocaleString()} lb
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
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  syncDot: { width: 7, height: 7, borderRadius: 4 },
  syncDotBusy: { backgroundColor: C.accent },
  syncDotOk: { backgroundColor: C.green },
  syncDotIdle: { backgroundColor: C.text3 },
  syncText: { fontSize: F.xs, color: C.text3 },
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
  nextHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nextLabel: {
    fontSize: F.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: C.text3,
  },
  weekChip: { fontSize: F.xs, fontWeight: '700', color: C.accent },
  nextDayName: { fontSize: F.lg, fontWeight: '700', color: C.text, marginTop: -2 },
  exList: { gap: 6, marginBottom: 2 },
  exRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  exName: { color: C.text2, fontSize: F.xs, flex: 1, marginRight: 8 },
  exTarget: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  waveTag: {
    fontSize: F.xs - 2,
    fontWeight: '800',
    color: C.accent,
    letterSpacing: 0.5,
  },
  exSetsReps: { color: C.text3, fontSize: F.xs, fontVariant: ['tabular-nums'] },
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
