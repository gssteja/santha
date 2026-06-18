import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/store/StoreContext';
import { useMetrics } from '@/store/MetricsContext';
import { makeProgramExerciseBlock } from '@/store/workoutStore';
import { PROGRAMS, isHeavyWeek, isWaved, resolveReps, repsToInput, repSequence } from '@/store/programs';
import { suggestLoad, detectDeload, recentPRs } from '@/engine/progression';
import { C, F, FONT, HEAT, RADIUS, SHADOW, heatForFraction } from '@/constants/theme';
import { ForgedNumber } from '@/components/ui/ForgedNumber';
import { Surface } from '@/components/ui/Surface';
import { Glow } from '@/components/ui/Glow';
import { haptics } from '@/components/ui/haptics';

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

// Relative date for an ISO timestamp (PR feed): "today" / "Nd" / "Nw".
function fmtAgoDate(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

// readiness score → forged badge spec.
const READINESS_META: Record<number, { label: string; color: string }> = {
  [-1]: { label: 'Beat up', color: HEAT.cool },
  [0]: { label: 'Normal', color: HEAT.warm },
  [1]: { label: 'Fresh', color: HEAT.white },
};

const PICKERS = [
  { key: 'sleep' as const, label: 'Sleep', lo: 'poor', hi: 'great' },
  { key: 'soreness' as const, label: 'Soreness', lo: 'wrecked', hi: 'fresh' },
  { key: 'stress' as const, label: 'Stress', lo: 'high', hi: 'low' },
];

export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeWorkout, history, startWorkout, addExercise, getPhaseSets, getSeedSets, syncing, lastSyncedAt } = useStore();
  const { todayReadiness, setReadiness } = useMetrics();
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

  const { streakWeeks, thisWeekCount } = useMemo(() => {
    const TARGET = 5;
    const weekCounts = new Map<string, number>();
    for (const rec of history) {
      const d = new Date(rec.date);
      const day = d.getDay();
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
    }
    const now = new Date();
    const nowDay = now.getDay();
    const thisMonday = new Date(now);
    thisMonday.setDate(now.getDate() - (nowDay === 0 ? 6 : nowDay - 1));
    thisMonday.setHours(0, 0, 0, 0);
    const thisWeekKey = thisMonday.toISOString().slice(0, 10);
    const thisWeekCount = weekCounts.get(thisWeekKey) ?? 0;

    // Count consecutive complete weeks ending at the most recent complete week
    const complete = [...weekCounts.entries()]
      .filter(([, c]) => c >= TARGET)
      .map(([k]) => k)
      .sort((a, b) => b.localeCompare(a));
    let streakWeeks = 0;
    for (let i = 0; i < complete.length; i++) {
      if (i === 0) { streakWeeks = 1; continue; }
      const prev = new Date(complete[i - 1]);
      const curr = new Date(complete[i]);
      if (Math.round((prev.getTime() - curr.getTime()) / 86_400_000) === 7) {
        streakWeeks++;
      } else break;
    }
    return { streakWeeks, thisWeekCount };
  }, [history]);

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
  const readyScore = todayReadiness?.score ?? 0;

  // Per-exercise load suggestions for the next day (read-only over the frozen program).
  const suggestions = useMemo(() => {
    if (!nextDay) return [] as (string | null)[];
    return nextDay.exercises.map(ex => {
      const s = suggestLoad({
        history,
        name: ex.name,
        targetReps: parseInt(repsToInput(ex.reps, week)) || 0,
        week,
        waved: isWaved(ex.reps),
        readiness: readyScore,
      });
      return s ? `${s.weight}` : null;
    });
  }, [nextDay, history, week, readyScore]);

  // One gentle deload nudge: the first next-day lift that has stalled 3 sessions.
  const deload = useMemo(() => {
    if (!nextDay) return null;
    for (const ex of nextDay.exercises) {
      const d = detectDeload(history, ex.name);
      if (d) {
        const short = ex.name.split(/[(—]/)[0].trim();
        return `${short}: 3 sessions flat. Back off a week?`;
      }
    }
    return null;
  }, [nextDay, history]);

  const prs = useMemo(() => recentPRs(history, 5), [history]);

  function handleStartNextDay() {
    if (!nextDay) return handleStart();
    startWorkout(nextDay.name, week);
    for (const ex of nextDay.exercises) {
      const waved = isWaved(ex.reps);
      const perSide = !!ex.perSide || /\/\s*side/i.test(ex.reps);
      const target = `${ex.sets}×${resolveReps(ex.reps, week)}`;
      const drops = ex.dropSet ? repSequence(ex.reps, week).slice(1) : [];
      const repsNum = parseInt(repsToInput(ex.reps, week) || '0') || 0;
      const phaseSets = getPhaseSets(ex.name, week, waved);
      // Phase-aware log wins; otherwise seed (1RM scale for waved, starter for new lifts).
      const seedSets = phaseSets.length ? phaseSets : getSeedSets(ex.name, ex.sets, waved, repsNum);
      addExercise(
        makeProgramExerciseBlock(
          slugify(ex.name),
          ex.name,
          ex.muscle ?? '',
          ex.sets,
          repsToInput(ex.reps, week),
          seedSets,
          { perSide, target, waved, heavy: waved && heavy, note: ex.note, drops, rpe: ex.rpe },
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
        <Text style={styles.title}>TODAY</Text>
        <Text style={styles.date}>{today}</Text>
        <View style={styles.syncRow}>
          <View style={[styles.syncDot, syncing ? styles.syncDotBusy : lastSyncedAt ? styles.syncDotOk : styles.syncDotIdle]} />
          <Text style={styles.syncText}>
            {syncing ? 'Syncing…' : lastSyncedAt ? `Synced ${fmtAgo(lastSyncedAt)}` : 'Not synced yet'}
          </Text>
        </View>
        {(streakWeeks > 0 || thisWeekCount > 0) && (
          <View style={styles.streakRow}>
            {streakWeeks > 0 && (
              <Text style={styles.streakBadge}>
                <Text style={styles.streakNum}>{streakWeeks}</Text> weeks. Still hot.
              </Text>
            )}
            <Text style={styles.streakWeek}>{thisWeekCount}/5 this week</Text>
          </View>
        )}
      </View>

      {/* Readiness pulse */}
      <ReadinessCard
        readiness={todayReadiness}
        onSet={(sl, so, st) => setReadiness(sl, so, st)}
      />

      {/* Active workout banner */}
      {activeWorkout && (
        <TouchableOpacity
          style={styles.activeBanner}
          onPress={() => router.push('/workout')}
          accessibilityLabel={`Resume ${activeWorkout.name}, ${fmtTime(elapsed)} elapsed`}
        >
          <Glow color={HEAT.hot} size={220} intensity={0.5} style={styles.bannerGlow} />
          <View>
            <Text style={styles.bannerName}>{activeWorkout.name}</Text>
            <ForgedNumber
              value={fmtTime(elapsed)}
              size={34}
              color={HEAT.white}
              style={styles.bannerTimer}
            />
          </View>
          <Text style={styles.bannerResume}>Resume →</Text>
        </TouchableOpacity>
      )}

      {/* Next program day */}
      {!activeWorkout && (
        <Surface style={styles.startCard}>
          {nextDay && (
            <View style={styles.heroBlock}>
              <Glow color={HEAT.warm} size={180} intensity={0.45} style={styles.heroGlow} />
              <View style={styles.nextHeader}>
                <Text style={styles.nextLabel}>NEXT UP</Text>
                <Text style={[styles.weekChip, { color: heavy ? HEAT.hot : HEAT.warm }]}>
                  Week {week} · {heavy ? 'Heavy' : 'Light'}
                </Text>
              </View>
              <Text style={styles.nextDayName}>{nextDay.name}</Text>
            </View>
          )}

          {deload && (
            <Surface flat style={styles.deloadBanner}>
              <Text style={styles.deloadText}>{deload}</Text>
            </Surface>
          )}

          {nextDay && (
            <View style={styles.exList}>
              {nextDay.exercises.map((ex, i) => (
                <View key={i} style={styles.exRow}>
                  <Text style={styles.exName} numberOfLines={1}>{ex.name}</Text>
                  <View style={styles.exTarget}>
                    {suggestions[i] != null && (
                      <Text style={styles.suggest}>↑ {suggestions[i]}</Text>
                    )}
                    {isWaved(ex.reps) && (
                      <Text style={[styles.waveTag, { color: heavy ? HEAT.hot : HEAT.warm }]}>
                        {heavy ? 'HEAVY' : 'LIGHT'}
                      </Text>
                    )}
                    <Text style={styles.exSetsReps}>
                      {ex.sets}×{resolveReps(ex.reps, week)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={() => { haptics.press(); handleStartNextDay(); }}
            accessibilityLabel={nextDay ? `Start ${nextDay.name}` : 'Start workout'}
          >
            <Text style={styles.btnPrimaryText}>
              {nextDay ? 'START' : 'START WORKOUT'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnSecondary}
            onPress={handleStart}
            accessibilityLabel="Start an empty workout"
          >
            <Text style={styles.btnSecondaryText}>Empty workout</Text>
          </TouchableOpacity>
        </Surface>
      )}

      {/* Recent PRs */}
      {prs.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>RECENT HEAT</Text>
          <Surface style={styles.prCard}>
            {prs.map((pr, i) => (
              <View key={`${pr.name}-${pr.date}-${i}`} style={[styles.prRow, i > 0 && styles.prRowBorder]}>
                <View style={styles.prInfo}>
                  <Text style={styles.prName} numberOfLines={1}>{pr.name}</Text>
                  <Text style={styles.prMeta}>
                    {pr.weight}×{pr.reps} · {fmtAgoDate(pr.date)}
                  </Text>
                </View>
                <View style={styles.prOrm}>
                  <ForgedNumber value={Math.round(pr.orm)} size={26} color={HEAT.white} />
                  <Text style={styles.prUnit}>e1RM</Text>
                </View>
              </View>
            ))}
          </Surface>
        </>
      )}

      {/* Recent */}
      <Text style={styles.sectionLabel}>RECENT</Text>
      {recent.length === 0 ? (
        <Text style={styles.empty}>Cold. Nothing logged.</Text>
      ) : (
        recent.map(w => (
          <Surface key={w.id} style={styles.historyRow}>
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
          </Surface>
        ))
      )}
    </ScrollView>
  );
}

// ── Readiness pulse ─────────────────────────────────────────────────────────
// Compact card: shows a heat-colored, gently pulsing badge once today's check-in
// exists; otherwise a prompt that opens a three-dial 1–5 modal → setReadiness.
function ReadinessCard({
  readiness,
  onSet,
}: {
  readiness: { sleep: number; soreness: number; stress: number; score: number } | null;
  onSet: (sleep: number, soreness: number, stress: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<{ sleep: number; soreness: number; stress: number }>({
    sleep: 3, soreness: 3, stress: 3,
  });
  const pulse = useRef(new Animated.Value(0)).current;

  const meta = readiness ? READINESS_META[readiness.score] : null;

  useEffect(() => {
    if (!readiness) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [readiness?.score]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  function submit() {
    haptics.done();
    onSet(vals.sleep, vals.soreness, vals.stress);
    setOpen(false);
  }

  return (
    <>
      {readiness && meta ? (
        <Surface flat style={styles.readyCard}>
          <Text style={styles.readyKicker}>READINESS</Text>
          <Animated.View style={[styles.readyBadge, { borderColor: meta.color, transform: [{ scale }] }]}>
            <Animated.View style={[styles.readyDot, { backgroundColor: meta.color, opacity: dotOpacity }]} />
            <Text style={[styles.readyLabel, { color: meta.color }]}>{meta.label}</Text>
          </Animated.View>
        </Surface>
      ) : (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => { haptics.tap(); setOpen(true); }}
          accessibilityLabel="Log today's readiness"
        >
          <Surface flat style={styles.readyCard}>
            <Text style={styles.readyKicker}>READINESS</Text>
            <Text style={styles.readyPrompt}>How ready? →</Text>
          </Surface>
        </TouchableOpacity>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalKicker}>HOW READY?</Text>
            {PICKERS.map(p => (
              <View key={p.key} style={styles.dialRow}>
                <View style={styles.dialHead}>
                  <Text style={styles.dialLabel}>{p.label}</Text>
                  <Text style={styles.dialEnds}>{p.lo} → {p.hi}</Text>
                </View>
                <View style={styles.dial}>
                  {[1, 2, 3, 4, 5].map(n => {
                    const active = vals[p.key] === n;
                    const color = heatForFraction((n - 1) / 4);
                    return (
                      <TouchableOpacity
                        key={n}
                        style={[
                          styles.pip,
                          active && { borderColor: color, backgroundColor: color + '26' },
                        ]}
                        onPress={() => { haptics.tap(); setVals(v => ({ ...v, [p.key]: n })); }}
                        accessibilityLabel={`${p.label} ${n} of 5`}
                      >
                        <Text style={[styles.pipText, active && { color }]}>{n}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.modalBtn} onPress={submit} accessibilityLabel="Save readiness">
              <Text style={styles.modalBtnText}>LOG IT</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { paddingBottom: 100 },
  pageHeader: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: F.xxxl, fontFamily: FONT.black, color: C.text, letterSpacing: -0.5 },
  date: { fontSize: F.sm, color: C.text2, marginTop: 2, fontFamily: FONT.medium },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  syncDot: { width: 7, height: 7, borderRadius: 4 },
  syncDotBusy: { backgroundColor: HEAT.warm },
  syncDotOk: { backgroundColor: C.green },
  syncDotIdle: { backgroundColor: C.text3 },
  syncText: { fontSize: F.xs, color: C.text3, fontFamily: FONT.medium },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' },
  streakBadge: { fontSize: F.xs, fontFamily: FONT.semi, color: C.text2 },
  streakNum: { fontFamily: FONT.black, color: HEAT.hot, fontVariant: ['tabular-nums'] },
  streakWeek: { fontSize: F.xs, color: C.text3, fontFamily: FONT.medium, fontVariant: ['tabular-nums'] },

  // Readiness
  readyCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface2,
  },
  readyKicker: { color: C.text3, fontSize: F.xs, fontFamily: FONT.bold, letterSpacing: 1.5 },
  readyPrompt: { color: HEAT.warm, fontSize: F.sm, fontFamily: FONT.bold },
  readyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: RADIUS.pill,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  readyDot: { width: 8, height: 8, borderRadius: 4 },
  readyLabel: { fontSize: F.sm, fontFamily: FONT.bold, letterSpacing: 0.3 },

  // Active banner
  activeBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: HEAT.hot + '55',
    borderRadius: RADIUS.lg,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    overflow: 'hidden',
    ...SHADOW.ember,
  },
  bannerGlow: { right: -40, left: undefined, top: -20, bottom: undefined },
  bannerName: { color: C.text2, fontSize: F.sm, fontFamily: FONT.semi },
  bannerTimer: { alignItems: 'flex-start', marginTop: 2 },
  bannerResume: { color: HEAT.warm, fontSize: F.sm, fontFamily: FONT.bold },

  // Next up card
  startCard: { marginHorizontal: 16, padding: 16, gap: 12, marginBottom: 8, overflow: 'hidden' },
  heroBlock: { gap: 4 },
  heroGlow: { left: -30, right: undefined, top: -50, bottom: undefined },
  nextHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nextLabel: { fontSize: F.xs, fontFamily: FONT.bold, letterSpacing: 2, color: C.text3 },
  weekChip: { fontSize: F.xs, fontFamily: FONT.bold, letterSpacing: 0.3 },
  nextDayName: { fontSize: F.xl, fontFamily: FONT.xbold, color: C.text, letterSpacing: -0.3 },
  deloadBanner: {
    backgroundColor: HEAT.cool + '1a',
    borderColor: HEAT.cool + '55',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  deloadText: { color: HEAT.warm, fontSize: F.xs, fontFamily: FONT.semi, lineHeight: 17 },
  exList: { gap: 7 },
  exRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  exName: { color: C.text2, fontSize: F.xs, flex: 1, marginRight: 8, fontFamily: FONT.medium },
  exTarget: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  suggest: { fontSize: F.xs, color: C.text3, fontFamily: FONT.semi, fontVariant: ['tabular-nums'] },
  waveTag: { fontSize: F.xs - 2, fontFamily: FONT.xbold, letterSpacing: 0.5 },
  exSetsReps: { color: C.text, fontSize: F.xs, fontFamily: FONT.semi, fontVariant: ['tabular-nums'] },
  btnPrimary: {
    backgroundColor: C.accent,
    borderRadius: RADIUS.md,
    paddingVertical: 15,
    alignItems: 'center',
    ...SHADOW.ember,
  },
  btnPrimaryText: { color: '#1a1206', fontSize: F.lg, fontFamily: FONT.black, letterSpacing: 0.5 },
  btnSecondary: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: RADIUS.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnSecondaryText: { color: C.text2, fontSize: F.sm, fontFamily: FONT.semi },

  // Section labels
  sectionLabel: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
    fontSize: F.xs,
    fontFamily: FONT.bold,
    letterSpacing: 2,
    color: C.text3,
  },
  empty: { paddingHorizontal: 20, color: C.text3, fontSize: F.sm, lineHeight: 20, fontFamily: FONT.medium },

  // PR feed
  prCard: { marginHorizontal: 16, paddingHorizontal: 16 },
  prRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  prRowBorder: { borderTopWidth: 1, borderTopColor: C.border },
  prInfo: { flex: 1, marginRight: 12 },
  prName: { color: C.text, fontSize: F.sm, fontFamily: FONT.bold },
  prMeta: { color: C.text3, fontSize: F.xs, marginTop: 2, fontFamily: FONT.medium, fontVariant: ['tabular-nums'] },
  prOrm: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  prUnit: { color: C.text3, fontSize: F.xs, fontFamily: FONT.medium },

  // Recent history
  historyRow: { marginHorizontal: 16, marginBottom: 8, padding: 14 },
  historyName: { color: C.text, fontSize: F.base, fontFamily: FONT.bold },
  historyMeta: { color: C.text2, fontSize: F.xs, marginTop: 3, fontFamily: FONT.medium, fontVariant: ['tabular-nums'] },
  exTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  exTag: { backgroundColor: C.surface2, borderRadius: RADIUS.sm, paddingVertical: 2, paddingHorizontal: 7 },
  exTagText: { color: C.text2, fontSize: F.xs, fontFamily: FONT.semi },
  exTagMore: { color: C.text3, fontSize: F.xs, alignSelf: 'center', fontFamily: FONT.medium },

  // Readiness modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  modalCard: {
    width: '100%',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: RADIUS.lg,
    paddingVertical: 22,
    paddingHorizontal: 20,
    ...SHADOW.card,
  },
  modalKicker: {
    color: C.text3,
    fontSize: F.xs,
    fontFamily: FONT.bold,
    letterSpacing: 2,
    marginBottom: 18,
    textAlign: 'center',
  },
  dialRow: { marginBottom: 18 },
  dialHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  dialLabel: { color: C.text, fontSize: F.sm, fontFamily: FONT.bold },
  dialEnds: { color: C.text3, fontSize: F.xs, fontFamily: FONT.medium },
  dial: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  pip: {
    flex: 1,
    height: 46,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipText: { color: C.text2, fontSize: F.base, fontFamily: FONT.black, fontVariant: ['tabular-nums'] },
  modalBtn: {
    backgroundColor: C.accent,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    ...SHADOW.ember,
  },
  modalBtnText: { color: '#1a1206', fontSize: F.base, fontFamily: FONT.black, letterSpacing: 0.5 },
});
