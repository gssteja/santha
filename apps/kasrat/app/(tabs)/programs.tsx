import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/store/StoreContext';
import {
  ACTIVE_PROGRAM_ID,
  PROGRAMS,
  isHeavyWeek,
  isWaved,
  repSequence,
  repsToInput,
  resolveReps,
} from '@/store/programs';
import type { Program, ProgramDay } from '@/store/programs';
import { makeProgramExerciseBlock } from '@/store/workoutStore';
import { C, F } from '@/constants/theme';
import { ExerciseDemo, hasDemo } from '@/components/ExerciseDemo';

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export default function ProgramsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { startWorkout, addExercise, getPhaseSets, getSeedSets, history } = useStore();
  const [openProgram, setOpenProgram] = useState<string | null>(ACTIVE_PROGRAM_ID);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [openDemo, setOpenDemo] = useState<string | null>(null); // `${dayKey}::${i}` whose demo is showing

  // Week for a hand-started day: carry on from that program's own last logged session.
  // The stored rotation pointer can't be trusted here — it tracks the active program, so
  // starting a retired program's day off it would stamp the wrong week (and, for waved
  // lifts, pull the wrong heavy/light previous weights).
  function weekFor(prog: Program) {
    const last = history.find(rec =>
      rec.programId ? rec.programId === prog.id : prog.days.some(d => d.name === rec.name)
    );
    return last?.week ?? 1;
  }

  // Starting a day by hand builds the same blocks as the home screen's next-up button:
  // prescribed sets/reps, per-side and drop-set flags, cues, and last session's weights.
  function handleStartDay(prog: Program, day: ProgramDay) {
    const week = weekFor(prog);
    startWorkout(day.name, week, prog.id);
    for (const ex of day.exercises) {
      const waved = isWaved(ex.reps);
      const perSide = !!ex.perSide || /\/\s*side/i.test(ex.reps);
      const target = `${ex.sets}×${resolveReps(ex.reps, week)}`;
      const drops = ex.dropSet ? repSequence(ex.reps, week).slice(1) : [];
      const repsNum = parseInt(repsToInput(ex.reps, week) || '0') || 0;
      const phaseSets = getPhaseSets(ex.name, week, waved);
      const seedSets = phaseSets.length ? phaseSets : getSeedSets(ex.name, ex.sets, waved, repsNum);
      addExercise(
        makeProgramExerciseBlock(
          slugify(ex.name),
          ex.name,
          ex.muscle ?? '',
          ex.sets,
          repsToInput(ex.reps, week),
          seedSets,
          {
            perSide,
            target,
            waved,
            heavy: waved && isHeavyWeek(week),
            note: ex.note,
            drops,
            rpe: ex.rpe,
          },
        ),
      );
    }
    router.push('/workout');
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.pageHeader}>
        <Text style={styles.title}>Programs</Text>
        <Text style={styles.subtitle}>Your Library</Text>
      </View>

      {PROGRAMS.map(program => {
        const isOpen = openProgram === program.id;
        return (
          <View key={program.id} style={styles.programCard}>
            <TouchableOpacity
              style={styles.programHeader}
              onPress={() => setOpenProgram(isOpen ? null : program.id)}
              activeOpacity={0.7}
            >
              <View style={styles.programHeaderLeft}>
                <View style={styles.programNameRow}>
                  <Text style={styles.programName}>{program.name}</Text>
                  {program.id === ACTIVE_PROGRAM_ID && (
                    <View style={styles.activeChip}>
                      <Text style={styles.activeChipText}>ACTIVE</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.programMeta}>
                  {program.split} · {program.daysPerCycle}-day cycle{program.perWeek ? ` · ${program.perWeek}×/wk` : ''} · {program.author}
                </Text>
              </View>
              <Text style={[styles.chevron, isOpen && styles.chevronOpen]}>›</Text>
            </TouchableOpacity>

            {isOpen && (
              <View>
                <Text style={styles.programDesc}>{program.description}</Text>
                {program.days.map(day => {
                  const dayKey = `${program.id}::${day.name}`;
                  const isDayOpen = openDay === dayKey;
                  return (
                    <View key={day.name} style={styles.dayBlock}>
                      <TouchableOpacity
                        style={styles.dayHeader}
                        onPress={() => setOpenDay(isDayOpen ? null : dayKey)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.dayName}>{day.name}</Text>
                        <View style={styles.dayHeaderRight}>
                          <View style={styles.exCountChip}>
                            <Text style={styles.exCountText}>{day.exercises.length}</Text>
                          </View>
                          <Text style={[styles.chevron, isDayOpen && styles.chevronOpen]}>›</Text>
                        </View>
                      </TouchableOpacity>

                      {isDayOpen && (
                        <View>
                          {day.exercises.map((ex, i) => {
                            const demoKey = `${dayKey}::${i}`;
                            const demo = hasDemo(ex.name);
                            const demoOpen = openDemo === demoKey;
                            return (
                            <TouchableOpacity
                              key={i}
                              style={styles.exRow}
                              activeOpacity={demo ? 0.7 : 1}
                              disabled={!demo}
                              onPress={() => setOpenDemo(demoOpen ? null : demoKey)}
                            >
                              <View style={styles.exLeft}>
                                <Text style={styles.exName}>
                                  {ex.name}
                                  {demo ? <Text style={[styles.demoMark, demoOpen && styles.demoMarkOn]}>  ▶</Text> : null}
                                </Text>
                                {ex.muscle && (
                                  <Text style={styles.exMuscle}>{ex.muscle}</Text>
                                )}
                                {demoOpen ? (
                                  <View style={styles.demo}>
                                    <ExerciseDemo name={ex.name} height={180} />
                                  </View>
                                ) : null}
                                {ex.note && (
                                  <Text style={styles.exNote}>{ex.note}</Text>
                                )}
                              </View>
                              <Text style={styles.exSetsReps}>
                                {ex.sets}×{ex.reps}
                              </Text>
                            </TouchableOpacity>
                            );
                          })}
                          <TouchableOpacity
                            style={styles.startBtn}
                            onPress={() => handleStartDay(program, day)}
                          >
                            <Text style={styles.startBtnText}>Start</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { paddingBottom: 100 },
  pageHeader: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: F.xxxl, fontWeight: '700', color: C.text },
  subtitle: { fontSize: F.xs, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: C.text3, marginTop: 4 },
  programCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    overflow: 'hidden',
  },
  programHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  programHeaderLeft: { flex: 1 },
  programNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  programName: { color: C.text, fontSize: F.base, fontWeight: '700' },
  activeChip: {
    backgroundColor: C.accent,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  activeChipText: { color: '#fff', fontSize: F.xs - 2, fontWeight: '800', letterSpacing: 0.6 },
  programMeta: { color: C.text2, fontSize: F.xs, marginTop: 3 },
  programDesc: {
    color: C.text3,
    fontSize: F.xs,
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  chevron: { color: C.text3, fontSize: 22, fontWeight: '300' },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  dayBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dayName: { color: C.text, fontSize: F.sm, fontWeight: '600', flex: 1 },
  dayHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exCountChip: {
    backgroundColor: C.surface2,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  exCountText: { color: C.text3, fontSize: F.xs, fontWeight: '700' },
  exRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    backgroundColor: C.surface2,
  },
  exLeft: { flex: 1 },
  exName: { color: C.text2, fontSize: F.xs, fontWeight: '600' },
  exMuscle: { color: C.accent, fontSize: F.xs - 1, marginTop: 1 },
  demoMark: { color: C.text3, fontSize: F.xs - 2 },
  demoMarkOn: { color: C.accent },
  demo: { marginTop: 8 },
  exNote: { color: C.text3, fontSize: F.xs - 1, lineHeight: 16, marginTop: 4, fontStyle: 'italic', paddingRight: 8 },
  exSetsReps: { color: C.text3, fontSize: F.xs, fontVariant: ['tabular-nums'] },
  startBtn: {
    margin: 12,
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  startBtnText: { color: '#fff', fontSize: F.sm, fontWeight: '700' },
});
