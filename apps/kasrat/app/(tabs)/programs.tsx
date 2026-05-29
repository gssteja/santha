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
import { PROGRAMS } from '@/store/programs';
import { makeExerciseBlock } from '@/store/workoutStore';
import { C, F } from '@/constants/theme';

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export default function ProgramsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { startWorkout, addExercise } = useStore();
  const [openProgram, setOpenProgram] = useState<string | null>(PROGRAMS[0]?.id ?? null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  function handleStartDay(programId: string, dayName: string, exercises: { name: string; sets: number; reps: string; muscle?: string }[]) {
    startWorkout(dayName);
    for (const ex of exercises) {
      addExercise(makeExerciseBlock(slugify(ex.name), ex.name, ex.muscle ?? ''));
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
        <Text style={styles.subtitle}>Nippard Programs</Text>
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
                <Text style={styles.programName}>{program.name}</Text>
                <Text style={styles.programMeta}>
                  {program.split} · {program.daysPerCycle}-day cycle · {program.author}
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
                          {day.exercises.map((ex, i) => (
                            <View key={i} style={styles.exRow}>
                              <View style={styles.exLeft}>
                                <Text style={styles.exName}>{ex.name}</Text>
                                {ex.muscle && (
                                  <Text style={styles.exMuscle}>{ex.muscle}</Text>
                                )}
                                {ex.note && (
                                  <Text style={styles.exNote}>{ex.note}</Text>
                                )}
                              </View>
                              <Text style={styles.exSetsReps}>
                                {ex.sets}×{ex.reps}
                              </Text>
                            </View>
                          ))}
                          <TouchableOpacity
                            style={styles.startBtn}
                            onPress={() => handleStartDay(program.id, day.name, day.exercises)}
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
  programName: { color: C.text, fontSize: F.base, fontWeight: '700' },
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
