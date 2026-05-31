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
import { useStore } from '@/store/StoreContext';
import { makeExerciseBlock } from '@/store/workoutStore';
import type { Exercise } from '@/types';
import { C, F } from '@/constants/theme';

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
    getPreviousSets,
    isProgressiveOverload,
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
          <Text style={styles.workoutName}>{activeWorkout.name}</Text>
          <View style={styles.headerStats}>
            <Text style={styles.timer}>{fmtTime(elapsed)}</Text>
            {activeVolume > 0 && (
              <Text style={styles.volume}>{activeVolume.toLocaleString()} lb</Text>
            )}
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.discardBtn} onPress={handleDiscard}>
            <Text style={styles.discardText}>✕</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.finishBtn} onPress={handleFinish}>
            <Text style={styles.finishText}>Done.</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {activeWorkout.exercises.length === 0 ? (
          <Text style={styles.emptyHint}>
            No exercises yet.{'\n'}Add one below.
          </Text>
        ) : (
          activeWorkout.exercises.map((ex, ei) => (
            <ExerciseBlock
              key={`${ex.exId}-${ei}`}
              exercise={ex}
              exIdx={ei}
              previousSets={getPreviousSets(ex.name)}
              isOverload={isProgressiveOverload(ex.name, ex.sets)}
              onAddSet={() => addSet(ei)}
              onAddDropSet={() => addDropSet(ei)}
              onRemoveSet={si => removeSet(ei, si)}
              onUpdateSet={(si, field, val) => updateSet(ei, si, field, val)}
              onToggleSet={si => handleToggleSet(ei, si)}
              onRemove={() => removeExercise(ei)}
              onSwap={name => swapExercise(ei, name)}
            />
          ))
        )}

        <TouchableOpacity style={styles.addExBtn} onPress={() => setShowPicker(true)}>
          <Text style={styles.addExText}>+ Add Exercise</Text>
        </TouchableOpacity>
      </ScrollView>

      <RestTimer
        visible={restVisible}
        seconds={restSeconds}
        exerciseName={restExercise}
        onDismiss={() => setRestVisible(false)}
      />

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
  workoutName: { color: C.text, fontSize: F.lg, fontWeight: '700' },
  headerStats: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  timer: { color: C.text2, fontSize: F.sm, fontVariant: ['tabular-nums'] },
  volume: { color: C.accent, fontSize: F.sm, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  discardBtn: { padding: 8 },
  discardText: { color: C.text3, fontSize: 16 },
  finishBtn: {
    backgroundColor: C.green,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  finishText: { color: '#000', fontSize: F.sm, fontWeight: '800' },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 10, paddingBottom: 120 },
  emptyHint: {
    color: C.text3,
    fontSize: F.base,
    textAlign: 'center',
    marginTop: 60,
    lineHeight: 24,
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
  addExText: { color: C.text2, fontSize: F.base, fontWeight: '600' },
});
