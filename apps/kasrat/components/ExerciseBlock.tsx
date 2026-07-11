import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F, FONT, HEAT, heatForFraction, heatForRpe } from '@/constants/theme';
import { ForgedNumber } from '@/components/ui/ForgedNumber';
import { HeatDots } from '@/components/ui/Heat';
import { Surface } from '@/components/ui/Surface';
import { haptics } from '@/components/ui/haptics';
import { PlateCalculator } from '@/components/PlateCalculator';
import { epley1RM } from '@/store/programs';
import type { WorkoutExercise, WorkoutSet } from '@/types';

type Props = {
  exercise: WorkoutExercise;
  exIdx: number;
  previousSets: WorkoutSet[];
  /** Best estimated 1RM ever logged for this lift (the bar to beat), or null if new. */
  prevBest1RM: { orm: number; weight: string; reps: string } | null;
  /** Best single-session volume (lb) ever logged for this lift; 0/undefined if new. */
  prevBestVolume?: number;
  /** Adaptive load pick for the next working set (from the progression engine), or null. */
  suggested?: { weight: number; reason: string } | null;
  onAddSet: () => void;
  onAddDropAfter: (setIdx: number) => void;
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
  prevBest1RM,
  prevBestVolume = 0,
  suggested,
  onAddSet,
  onAddDropAfter,
  onRemoveSet,
  onUpdateSet,
  onToggleSet,
  onRemove,
  onSwap,
}: Props) {
  const [swapping, setSwapping] = useState(false);
  const [swapName, setSwapName] = useState('');
  const [menuSet, setMenuSet] = useState<number | null>(null); // set index whose action menu is open
  const [plateWeight, setPlateWeight] = useState<number | null>(null); // weight whose plate calc is open

  const exerciseVolume =
    exercise.sets
      .filter(s => s.done)
      .reduce((acc, s) => acc + Math.max(0, parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0), 0) *
    (exercise.perSide ? 2 : 1);

  // Best estimated 1RM from this session's logged sets — compared live against the
  // all-time best (prevBest1RM) to flag a new 1RM as you lift.
  const curBest1RM = exercise.sets.reduce((best, s) => {
    if (!s.done) return best;
    const w = Math.max(0, parseFloat(s.weight) || 0);
    const r = parseInt(s.reps) || 0;
    if (w <= 0 || r <= 0) return best;
    return Math.max(best, epley1RM(w, r));
  }, 0);
  const beat1RM = curBest1RM > 0 && curBest1RM > (prevBest1RM?.orm ?? 0);
  // Volume PR: this session's live volume beats the best single session ever logged.
  // Needs a prior best to beat (a brand-new lift can't PR its own baseline).
  const beatVol = prevBestVolume > 0 && exerciseVolume > prevBestVolume + 0.5;
  // "Best yet" fires on EITHER a heavier top single OR more total work — the user's
  // expectation: adding volume is progress even when the top-set e1RM is unchanged.
  const beatAny = beat1RM || beatVol;

  // How hot the e1RM runs: live best as a fraction of the bar to beat (white-hot once passed).
  const ormFraction = prevBest1RM?.orm ? curBest1RM / prevBest1RM.orm : beat1RM ? 1 : 0;
  const ormHeat = beat1RM ? HEAT.white : heatForFraction(ormFraction);
  const heroOrm = beat1RM ? curBest1RM : prevBest1RM?.orm ?? 0;

  // One-shot PR bloom: fires once each time the live session crosses an all-time bar
  // (e1RM or volume).
  const bloom = useRef(new Animated.Value(0)).current;
  const wasBeat = useRef(false);
  useEffect(() => {
    if (beatAny && !wasBeat.current) {
      wasBeat.current = true;
      haptics.pr();
      bloom.setValue(0);
      Animated.sequence([
        Animated.timing(bloom, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.timing(bloom, { toValue: 0, duration: 620, useNativeDriver: true }),
      ]).start();
    } else if (!beatAny) {
      wasBeat.current = false;
    }
  }, [beatAny]);
  const bloomScale = bloom.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });

  // Number only the main (non-drop) sets; drop sets show ↓.
  let mainCount = 0;
  const setLabels = exercise.sets.map(set => (set.drop ? '↓' : String(++mainCount)));

  // Align each set with its matching previous set — k-th working set → k-th previous
  // working set, k-th drop → k-th previous drop — mirroring how the prefill seeds. This
  // lets a drop row show its own previous drop instead of a blank "—".
  const prevMains = previousSets.filter(p => !p.drop);
  const prevDrops = previousSets.filter(p => p.drop);
  let pmIdx = 0;
  let pdIdx = 0;
  const prevForSet = exercise.sets.map(set => (set.drop ? prevDrops[pdIdx++] : prevMains[pmIdx++]));

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

  // Logging a set is the tactile beat of the workout — give it a tap.
  function handleToggle(si: number) {
    haptics.tap();
    onToggleSet(si);
  }

  function openPlates(weight: string) {
    const w = parseFloat(weight) || 0;
    setPlateWeight(w);
  }

  return (
    <Surface style={s.block}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.nameRow}>
            <Text style={s.name}>{exercise.name}</Text>
          </View>
          <Text style={s.muscle}>{exercise.muscle}</Text>
          {(exercise.waved || exercise.target || exercise.perSide || exercise.rpe || suggested) && (
            <View style={s.tagRow}>
              {exercise.waved && (
                <Text style={[s.tag, exercise.heavy ? s.heavyTag : s.lightTag]}>
                  {exercise.heavy ? 'HEAVY' : 'LIGHT'}
                </Text>
              )}
              {exercise.target ? <Text style={[s.tag, s.targetTag]}>{exercise.target}</Text> : null}
              {exercise.perSide ? <Text style={[s.tag, s.sideTag]}>PER SIDE</Text> : null}
              {exercise.rpe ? (
                <View style={[s.tag, s.rpeTag, { borderColor: heatForRpe(exercise.rpe) }]}>
                  <Text style={[s.rpeTagText, { color: heatForRpe(exercise.rpe) }]}>RPE {exercise.rpe}</Text>
                  <HeatDots rpe={exercise.rpe} dotSize={5} gap={2} />
                </View>
              ) : null}
            </View>
          )}

          {/* Suggested load from the progression engine — "↑ {weight}" with a muted reason. */}
          {suggested ? (
            <Pressable
              style={s.suggest}
              onPress={() => openPlates(String(suggested.weight))}
              accessibilityLabel={`Suggested load ${suggested.weight} pounds. ${suggested.reason}. Tap for plates.`}
            >
              <Text style={s.suggestWeight}>↑ {suggested.weight}</Text>
              <Text style={s.suggestReason} numberOfLines={1}>{suggested.reason}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={s.headerActions}>
          <TouchableOpacity
            style={s.iconBtn}
            onPress={() => setSwapping(v => !v)}
            accessibilityLabel="Swap exercise"
          >
            <Text style={s.iconBtnText}>⇄</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.iconBtn}
            onPress={handleRemove}
            accessibilityLabel="Remove exercise"
          >
            <Text style={s.iconBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Estimated 1RM — forged hero numeral; the bar to beat, or white-hot when passed. */}
      {heroOrm > 0 ? (
        <Animated.View style={[s.ormRow, { transform: [{ scale: bloomScale }] }]}>
          <ForgedNumber
            value={Math.round(heroOrm)}
            size={34}
            color={ormHeat}
            glow={beat1RM}
            glowColor={HEAT.white}
            glowIntensity={beat1RM ? 1 : 0}
            textStyle={s.ormNum}
          />
          <View style={s.ormMeta}>
            <Text style={[s.ormLabel, beat1RM && { color: HEAT.white }]}>
              {beat1RM ? 'Hottest yet' : 'Beat'}
            </Text>
            <Text style={s.ormSub}>
              {beat1RM
                ? prevBest1RM
                  ? `was ${Math.round(prevBest1RM.orm)} lb`
                  : 'est. 1RM · lb'
                : prevBest1RM
                ? `${prevBest1RM.weight}×${prevBest1RM.reps} · lb`
                : 'lb'}
            </Text>
          </View>
        </Animated.View>
      ) : null}

      {exerciseVolume > 0 && (
        <Text style={[s.volText, beatVol && s.volTextPR]}>
          {beatVol ? '🔥 ' : ''}
          {exerciseVolume.toLocaleString()} lb volume{exercise.perSide ? ' (both sides)' : ''}
          {beatVol
            ? ` · best yet${prevBestVolume > 0 ? ` (was ${Math.round(prevBestVolume).toLocaleString()})` : ''}`
            : prevBestVolume > 0
            ? ` · best ${Math.round(prevBestVolume).toLocaleString()}`
            : ''}
        </Text>
      )}

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

      {/* Coaching cue from the program */}
      {exercise.note ? <Text style={s.note}>{exercise.note}</Text> : null}

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
        const prev = prevForSet[si];
        const prevLabel = prev
          ? `${prev.weight || '—'}×${prev.reps || '—'}`
          : '—';

        const canPlate = !set.drop && (parseFloat(set.weight) || 0) > 0;

        return (
          <View key={si} style={[s.setRow, set.done && s.setRowDone, set.drop && s.dropRow]}>
            <TouchableOpacity
              style={[s.setNum, set.done && s.setNumDone, set.drop && !set.done && s.dropNum]}
              onPress={() => setMenuSet(si)}
              accessibilityLabel={`Set ${setLabels[si]} options`}
            >
              <Text style={[s.setNumText, set.done && s.setNumTextDone]}>
                {set.done ? '✓' : setLabels[si]}
              </Text>
            </TouchableOpacity>

            <View style={s.prevCell}>
              <Text style={s.prevText}>{prevLabel}</Text>
              {canPlate ? (
                <TouchableOpacity
                  style={s.plateChip}
                  onPress={() => openPlates(set.weight)}
                  hitSlop={8}
                  accessibilityLabel={`Plate breakdown for ${set.weight} pounds`}
                >
                  <Text style={s.plateChipText}>🔩</Text>
                </TouchableOpacity>
              ) : null}
            </View>

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
              onPress={() => handleToggle(si)}
              accessibilityLabel={set.done ? `Unlog set ${setLabels[si]}` : `Log set ${setLabels[si]}`}
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

      {/* Per-set action menu (tap a set's number) */}
      <Modal
        visible={menuSet !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuSet(null)}
      >
        <Pressable style={s.menuOverlay} onPress={() => setMenuSet(null)}>
          <View style={s.menuCard}>
            <Text style={s.menuTitle}>
              {menuSet !== null && exercise.sets[menuSet]?.drop
                ? 'Drop set'
                : `Set ${menuSet !== null ? setLabels[menuSet] : ''}`}
            </Text>
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => {
                if (menuSet !== null) onAddDropAfter(menuSet);
                setMenuSet(null);
              }}
            >
              <Text style={s.menuItemText}>↓ Add drop set</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => {
                if (menuSet !== null) onRemoveSet(menuSet);
                setMenuSet(null);
              }}
            >
              <Text style={[s.menuItemText, s.menuRemove]}>Remove set</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.menuCancel} onPress={() => setMenuSet(null)}>
              <Text style={s.menuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Tactile plate calculator for a tapped set / suggested load */}
      <PlateCalculator
        visible={plateWeight !== null}
        weight={plateWeight ?? 0}
        onClose={() => setPlateWeight(null)}
      />
    </Surface>
  );
}

const s = StyleSheet.create({
  block: {
    marginHorizontal: 14,
    marginBottom: 12,
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
  name: { color: C.text, fontSize: F.base, fontFamily: FONT.xbold, flexShrink: 1 },
  muscle: { color: C.accent, fontSize: F.xs, fontFamily: FONT.semi, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' },
  tag: {
    fontSize: F.xs - 1,
    fontFamily: FONT.bold,
    letterSpacing: 0.5,
    borderRadius: 5,
    paddingVertical: 2,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  heavyTag: { color: HEAT.hot, backgroundColor: 'rgba(255,94,26,0.15)' },
  lightTag: { color: C.text3, backgroundColor: C.surface2 },
  targetTag: { color: C.text2, backgroundColor: C.surface2, fontVariant: ['tabular-nums'] },
  rpeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    backgroundColor: 'rgba(245,158,11,0.08)',
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  rpeTagText: { fontSize: F.xs - 1, fontFamily: FONT.bold, letterSpacing: 0.5, fontVariant: ['tabular-nums'] },
  sideTag: { color: C.green, backgroundColor: 'rgba(34,197,94,0.13)' },
  suggest: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    alignSelf: 'flex-start',
    marginTop: 8,
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  suggestWeight: { color: C.accent, fontSize: F.sm, fontFamily: FONT.black, fontVariant: ['tabular-nums'] },
  suggestReason: { color: C.text3, fontSize: F.xs, fontFamily: FONT.regular, flexShrink: 1 },
  ormRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  ormNum: { lineHeight: 36 },
  ormMeta: { justifyContent: 'center' },
  ormLabel: { color: C.text2, fontSize: F.xs, fontFamily: FONT.bold, letterSpacing: 1, textTransform: 'uppercase' },
  ormSub: { color: C.text3, fontSize: F.xs, fontFamily: FONT.regular, marginTop: 1, fontVariant: ['tabular-nums'] },
  volText: { color: C.text3, fontSize: F.xs, fontFamily: FONT.regular, paddingHorizontal: 14, paddingBottom: 4 },
  volTextPR: { color: HEAT.white, fontFamily: FONT.bold },
  note: {
    color: C.text3,
    fontSize: F.xs,
    lineHeight: 16,
    fontStyle: 'italic',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  headerActions: { flexDirection: 'row', gap: 4 },
  iconBtn: { padding: 6, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { color: C.text3, fontSize: 16 },
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
    fontFamily: FONT.medium,
  },
  swapBtn: {
    backgroundColor: C.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  swapBtnText: { color: '#1a1206', fontSize: F.sm, fontFamily: FONT.bold },
  cancelBtn: { paddingHorizontal: 8, paddingVertical: 7 },
  cancelBtnText: { color: C.text3, fontSize: F.sm, fontFamily: FONT.medium },
  colHeader: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingBottom: 4,
    gap: 6,
  },
  colText: { color: C.text3, fontSize: F.xs, fontFamily: FONT.bold, textTransform: 'uppercase' },
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
  setRowDone: { backgroundColor: 'rgba(245,158,11,0.06)' },
  dropRow: { paddingLeft: 30 },
  setNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  setNumDone: { backgroundColor: C.accent },
  dropNum: { backgroundColor: 'rgba(245,158,11,0.18)' },
  setNumText: { color: C.text2, fontSize: F.xs, fontFamily: FONT.bold },
  setNumTextDone: { color: '#1a1206' },
  prevCell: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  prevText: {
    color: C.text3,
    fontSize: F.xs,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    fontFamily: FONT.medium,
  },
  plateChip: {
    paddingHorizontal: 2,
    minHeight: 28,
    justifyContent: 'center',
  },
  plateChipText: { fontSize: 12 },
  input: {
    flex: 1,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 7,
    color: C.text,
    fontSize: F.sm,
    fontFamily: FONT.semi,
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
    backgroundColor: 'rgba(245,158,11,0.18)',
    borderColor: 'rgba(245,158,11,0.4)',
  },
  logBtnText: { color: C.text2, fontSize: F.xs, fontFamily: FONT.bold },
  logBtnTextDone: { color: C.accent },
  addSetBtn: {
    margin: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  addSetText: { color: C.text3, fontSize: F.sm, fontFamily: FONT.semi },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  menuCard: {
    width: '100%',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingVertical: 8,
  },
  menuTitle: {
    color: C.text3,
    fontSize: F.xs,
    fontFamily: FONT.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 6,
  },
  menuItem: { paddingVertical: 14, paddingHorizontal: 18 },
  menuItemText: { color: C.text, fontSize: F.base, fontFamily: FONT.semi },
  menuRemove: { color: C.red },
  menuCancel: { paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', marginTop: 2 },
  menuCancelText: { color: C.text3, fontSize: F.sm, fontFamily: FONT.semi },
});
