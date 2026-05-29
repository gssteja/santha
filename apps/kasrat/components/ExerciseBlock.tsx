import React, { useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F } from '@/constants/theme';
import type { WorkoutExercise, WorkoutSet } from '@/types';

type Props = {
  exercise: WorkoutExercise;
  exIdx: number;
  previousSets: WorkoutSet[];
  isOverload: boolean;
  onAddSet: () => void;
  onRemoveSet: (setIdx: number) => void;
  onUpdateSet: (setIdx: number, field: 'weight' | 'reps', value: string) => void;
  onToggleSet: (setIdx: number) => void;
  onRemove: () => void;
  onSwap: (newName: string) => void;
};

export function ExerciseBlock({
  exercise,
  exIdx,
  previousSets,
  isOverload,
  onAddSet,
  onRemoveSet,
  onUpdateSet,
  onToggleSet,
  onRemove,
  onSwap,
}: Props) {
  const [swapping, setSwapping] = useState(false);
  const [swapName, setSwapName] = useState('');

  const exerciseVolume =
    exercise.sets
      .filter(s => s.done)
      .reduce((acc, s) => acc + (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0), 0) *
    (exercise.perSide ? 2 : 1);

  function handleRemove() {
    Alert.alert('Remove exercise?', exercise.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: onRemove },
    ]);
  }

  function confirmSwap() {
    if (swapName.trim()) {
      onSwap(swapName.trim());
      setSwapping(false);
      setSwapName('');
    }
  }

  return (
    <View style={s.block}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.nameRow}>
            <Text style={s.name}>{exercise.name}</Text>
            {isOverload && (
              <View style={s.poBadge}>
                <Text style={s.poBadgeText}>↑ PR</Text>
              </View>
            )}
          </View>
          <Text style={s.muscle}>{exercise.muscle}</Text>
          {(exercise.waved || exercise.target || exercise.perSide) && (
            <View style={s.tagRow}>
              {exercise.waved && (
                <Text style={[s.tag, exercise.heavy ? s.heavyTag : s.lightTag]}>
                  {exercise.heavy ? 'HEAVY' : 'LIGHT'}
                </Text>
              )}
              {exercise.target ? <Text style={[s.tag, s.targetTag]}>{exercise.target}</Text> : null}
              {exercise.perSide ? <Text style={[s.tag, s.sideTag]}>PER SIDE</Text> : null}
            </View>
          )}
          {exerciseVolume > 0 && (
            <Text style={s.volText}>
              {exerciseVolume.toLocaleString()} lb volume{exercise.perSide ? ' (both sides)' : ''}
            </Text>
          )}
        </View>
        <View style={s.headerActions}>
          <TouchableOpacity style={s.iconBtn} onPress={() => setSwapping(v => !v)}>
            <Text style={s.iconBtnText}>⇄</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={handleRemove}>
            <Text style={s.iconBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Swap input */}
      {swapping && (
        <View style={s.swapRow}>
          <TextInput
            style={s.swapInput}
            placeholder="Exercise name..."
            placeholderTextColor={C.text3}
            value={swapName}
            onChangeText={setSwapName}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={confirmSwap}
          />
          <TouchableOpacity style={s.swapBtn} onPress={confirmSwap}>
            <Text style={s.swapBtnText}>Swap</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.cancelBtn} onPress={() => setSwapping(false)}>
            <Text style={s.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Column headers */}
      <View style={s.colHeader}>
        <Text style={[s.colText, s.colSet]}>Set</Text>
        <Text style={[s.colText, s.colPrev]}>Previous</Text>
        <Text style={[s.colText, s.colInput]}>lb</Text>
        <Text style={[s.colText, s.colInput]}>{exercise.perSide ? 'Reps/side' : 'Reps'}</Text>
        <Text style={[s.colText, s.colLog]}></Text>
      </View>

      {/* Sets */}
      {exercise.sets.map((set, si) => {
        const prev = previousSets[si];
        const prevLabel = prev
          ? `${prev.weight || '—'}×${prev.reps || '—'}`
          : si === 0 && previousSets.length > 0
          ? `${previousSets[0].weight || '—'}×${previousSets[0].reps || '—'}`
          : '—';

        return (
          <View key={si} style={[s.setRow, set.done && s.setRowDone]}>
            <TouchableOpacity
              style={[s.setNum, set.done && s.setNumDone]}
              onLongPress={() => onRemoveSet(si)}
              delayLongPress={500}
            >
              <Text style={[s.setNumText, set.done && s.setNumTextDone]}>
                {set.done ? '✓' : si + 1}
              </Text>
            </TouchableOpacity>
            <Text style={s.prevText}>{prevLabel}</Text>
            <TextInput
              style={[s.input, set.done && s.inputDone]}
              keyboardType="decimal-pad"
              value={set.weight}
              onChangeText={v => onUpdateSet(si, 'weight', v)}
              placeholder="—"
              placeholderTextColor={C.text3}
              editable={!set.done}
            />
            <TextInput
              style={[s.input, set.done && s.inputDone]}
              keyboardType="number-pad"
              value={set.reps}
              onChangeText={v => onUpdateSet(si, 'reps', v)}
              placeholder="—"
              placeholderTextColor={C.text3}
              editable={!set.done}
            />
            <TouchableOpacity
              style={[s.logBtn, set.done && s.logBtnDone]}
              onPress={() => onToggleSet(si)}
            >
              <Text style={[s.logBtnText, set.done && s.logBtnTextDone]}>
                {set.done ? '✓' : 'Log'}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}

      <TouchableOpacity style={s.addSetBtn} onPress={onAddSet}>
        <Text style={s.addSetText}>+ Add Set</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  block: {
    marginHorizontal: 14,
    marginBottom: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 14,
    paddingBottom: 10,
  },
  headerLeft: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { color: C.text, fontSize: F.base, fontWeight: '700', flexShrink: 1 },
  muscle: { color: C.accent, fontSize: F.xs, fontWeight: '600', marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 5 },
  tag: {
    fontSize: F.xs - 1,
    fontWeight: '800',
    letterSpacing: 0.5,
    borderRadius: 5,
    paddingVertical: 2,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  heavyTag: { color: C.accent, backgroundColor: 'rgba(99,102,241,0.15)' },
  lightTag: { color: C.text3, backgroundColor: C.surface2 },
  targetTag: { color: C.text2, backgroundColor: C.surface2, fontVariant: ['tabular-nums'] },
  sideTag: { color: C.green, backgroundColor: 'rgba(34,197,94,0.13)' },
  volText: { color: C.text3, fontSize: F.xs, marginTop: 4 },
  poBadge: {
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  poBadgeText: { color: C.green, fontSize: F.xs, fontWeight: '700' },
  headerActions: { flexDirection: 'row', gap: 4 },
  iconBtn: { padding: 6 },
  iconBtnText: { color: C.text3, fontSize: 14 },
  swapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  swapInput: {
    flex: 1,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: C.text,
    fontSize: F.sm,
  },
  swapBtn: {
    backgroundColor: C.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  swapBtnText: { color: '#fff', fontSize: F.sm, fontWeight: '700' },
  cancelBtn: { paddingHorizontal: 8, paddingVertical: 7 },
  cancelBtnText: { color: C.text3, fontSize: F.sm },
  colHeader: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingBottom: 4,
    gap: 6,
  },
  colText: { color: C.text3, fontSize: F.xs, fontWeight: '700', textTransform: 'uppercase' },
  colSet: { width: 28 },
  colPrev: { flex: 1.2, textAlign: 'center' },
  colInput: { flex: 1, textAlign: 'center' },
  colLog: { width: 48 },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 5,
    gap: 6,
  },
  setRowDone: { backgroundColor: 'rgba(34,197,94,0.05)' },
  setNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  setNumDone: { backgroundColor: C.green },
  setNumText: { color: C.text2, fontSize: F.xs, fontWeight: '700' },
  setNumTextDone: { color: '#000' },
  prevText: {
    flex: 1.2,
    color: C.text3,
    fontSize: F.xs,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  input: {
    flex: 1,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 7,
    color: C.text,
    fontSize: F.sm,
    fontWeight: '600',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  inputDone: { opacity: 0.5 },
  logBtn: {
    width: 48,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  logBtnDone: {
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderColor: 'rgba(34,197,94,0.3)',
  },
  logBtnText: { color: C.text2, fontSize: F.xs, fontWeight: '700' },
  logBtnTextDone: { color: C.green },
  addSetBtn: {
    margin: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  addSetText: { color: C.text3, fontSize: F.sm, fontWeight: '600' },
});
