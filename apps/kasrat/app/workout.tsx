import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExerciseBlock } from '@/components/ExerciseBlock';
import { ExercisePicker } from '@/components/ExercisePicker';
import { RestTimer, restForExercise } from '@/components/RestTimer';
import { ForgedNumber } from '@/components/ui/ForgedNumber';
import { useStore } from '@/store/StoreContext';
import { useMetrics } from '@/store/MetricsContext';
import { makeExerciseBlock } from '@/store/workoutStore';
import { suggestLoad } from '@/engine/progression';
import type { Exercise } from '@/types';
import { C, F, FONT, HEAT } from '@/constants/theme';

function fmtTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function WorkoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    activeWorkout,
    activeVolume,
    history,
    getPhaseSets,
    getBest1RM,
    getBestVolume,
    addExercise,
    removeExercise,
    swapExercise,
    addSet,
    addDropSet,
    removeSet,
    updateSet,
    toggleSet,
    finishWorkout,
    discardWorkout,
  } = useStore();
  const { todayReadiness } = useMetrics();

  const [elapsed, setElapsed] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [restVisible, setRestVisible] = useState(false);
  const [restSeconds, setRestSeconds] = useState(90);
  const [restExercise, setRestExercise] = useState<string | undefined>();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (activeWorkout) {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - activeWorkout.startTime) / 1000));
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeWorkout?.id]);

  if (!activeWorkout) {
    router.back();
    return null;
  }

  function handleToggleSet(exIdx: number, setIdx: number) {
    const ex = activeWorkout!.exercises[exIdx];
    const set = ex.sets[setIdx];
    toggleSet(exIdx, setIdx);
    // No rest if the next set is a drop — you go straight into the drop.
    const nextIsDrop = ex.sets[setIdx + 1]?.drop === true;
    if (!set.done && !nextIsDrop) {
      // show rest only when marking done; auto-set duration per exercise
      setRestSeconds(restForExercise(ex.name, ex.muscle));
      setRestExercise(ex.name);
      setRestVisible(true);
    }
  }

  function handleFinish() {
    const doneSets = activeWorkout!.exercises.flatMap(e => e.sets.filter(s => s.done)).length;
    if (doneSets === 0) {
      Alert.alert('Finish workout?', 'No sets logged. You sure?', [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Finish anyway', onPress: () => { finishWorkout(); router.back(); } },
      ]);
      return;
    }
    finishWorkout();
    router.back();
  }

  function handleDiscard() {
    Alert.alert('Discard workout?', 'All progress will be lost.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { discardWorkout(); router.back(); } },
    ]);
  }

  function handleSelectExercise(ex: Exercise) {
    addExercise(makeExerciseBlock(ex.id, ex.name, ex.muscle));
    setShowPicker(false);
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.workoutName} numberOfLines={1}>{activeWorkout.name}</Text>
          <View style={styles.headerStats}>
            <View style={styles.stat}>
              <ForgedNumber value={fmtTime(elapsed)} size={26} color={C.text2} textStyle={styles.statNum} />
              <Text style={styles.statLabel}>ELAPSED</Text>
            </View>
            {activeVolume > 0 && (
              <View style={styles.stat}>
                <ForgedNumber
                  value={activeVolume.toLocaleString()}
                  size={26}
                  color={C.accent}
                  glow
                  glowColor={HEAT.warm}
                  glowIntensity={0.5}
                  textStyle={styles.statNum}
                />
                <Text style={styles.statLabel}>LB MOVED</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.discardBtn}
            onPress={handleDiscard}
            accessibilityLabel="Discard workout"
          >
            <Text style={styles.discardText}>✕</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.finishBtn} onPress={handleFinish}>
            <Text style={styles.finishText}>Done.</Text>
          </TouchableOpacity>
        </View>
      </View>

      <RestTimer
        visible={restVisible}
        seconds={restSeconds}
        exerciseName={restExercise}
        onDismiss={() => setRestVisible(false)}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {activeWorkout.exercises.length === 0 ? (
          <Text style={styles.emptyHint}>
            No exercises yet.{'\n'}Light it up.
          </Text>
        ) : (
          activeWorkout.exercises.map((ex, ei) => {
            const suggested = suggestLoad({
              history,
              name: ex.name,
              targetReps: parseInt(ex.sets[0]?.reps) || 0,
              week: activeWorkout.week ?? 1,
              waved: !!ex.waved,
              readiness: todayReadiness?.score ?? 0,
            });
            return (
              <ExerciseBlock
                key={`${ex.exId}-${ei}`}
                exercise={ex}
                exIdx={ei}
                previousSets={getPhaseSets(ex.name, activeWorkout.week ?? 1, !!ex.waved)}
                prevBest1RM={getBest1RM(ex.name)}
                prevBestVolume={getBestVolume(ex.name)}
                suggested={suggested}
                onAddSet={() => addSet(ei)}
                onAddDropAfter={si => addDropSet(ei, si)}
                onRemoveSet={si => removeSet(ei, si)}
                onUpdateSet={(si, field, val) => updateSet(ei, si, field, val)}
                onToggleSet={si => handleToggleSet(ei, si)}
                onRemove={() => removeExercise(ei)}
                onSwap={name => swapExercise(ei, name)}
              />
            );
          })
        )}

        <TouchableOpacity style={styles.addExBtn} onPress={() => setShowPicker(true)}>
          <Text style={styles.addExText}>+ Add Exercise</Text>
        </TouchableOpacity>
      </ScrollView>

      <ExercisePicker
        visible={showPicker}
        onSelect={handleSelectExercise}
        onClose={() => setShowPicker(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    backgroundColor: C.bg,
  },
  headerLeft: { flex: 1 },
  workoutName: { color: C.text, fontSize: F.lg, fontFamily: FONT.xbold },
  headerStats: { flexDirection: 'row', alignItems: 'flex-end', gap: 22, marginTop: 6 },
  stat: { alignItems: 'flex-start' },
  statNum: { lineHeight: 28 },
  statLabel: {
    color: C.text3,
    fontSize: F.xs - 1,
    fontFamily: FONT.bold,
    letterSpacing: 1.5,
    marginTop: 1,
  },
  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  discardBtn: { padding: 8, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  discardText: { color: C.text3, fontSize: 16 },
  finishBtn: {
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  finishText: { color: '#1a1206', fontSize: F.sm, fontFamily: FONT.black },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 10, paddingBottom: 120 },
  emptyHint: {
    color: C.text3,
    fontSize: F.base,
    fontFamily: FONT.medium,
    textAlign: 'center',
    marginTop: 60,
    lineHeight: 26,
  },
  addExBtn: {
    marginHorizontal: 16,
    marginTop: 4,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  addExText: { color: C.text2, fontSize: F.base, fontFamily: FONT.semi },
});
