import { useEffect, useMemo, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/store/StoreContext';
import { C, F, FONT, HEAT, RADIUS, heatForFraction } from '@/constants/theme';
import { ForgedNumber } from '@/components/ui/ForgedNumber';
import { Surface } from '@/components/ui/Surface';
import { HeatStrip } from '@/components/ui/Heat';
import { bestE1RM } from '@/engine/strength';
import { recentPRs } from '@/engine/progression';
import type { PRKind } from '@/engine/progression';
import type { WorkoutRecord } from '@/types';

function fmtTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Strip program parentheticals like "(heavy wk: 4×4 …)" for a cleaner display name.
function cleanExName(name: string) {
  return name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim() || name;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

const STRIP_LEN = 8; // how many recent sessions feed each lift's heat-strip

// Per-lift e1RM trend: session-by-session best e1RM across the whole history,
// oldest→newest, only sessions that contain the lift. Keyed by lower-cased name.
function buildLiftTrends(history: WorkoutRecord[]): Record<string, number[]> {
  const chrono = [...history].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const trends: Record<string, number[]> = {};
  for (const rec of chrono) {
    for (const ex of rec.exerciseData ?? []) {
      const b = bestE1RM(ex.sets);
      if (!b) continue;
      const key = ex.name.toLowerCase();
      (trends[key] ??= []).push(Math.round(b.orm));
    }
  }
  return trends;
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { history } = useStore();

  // Whole-history derivations — recompute only when the log changes.
  const trends = useMemo(() => buildLiftTrends(history), [history]);
  // name|date → PR kind for sessions that set a fresh all-time high (e1RM and/or volume).
  const prKinds = useMemo(() => {
    const m = new Map<string, PRKind>();
    for (const pr of recentPRs(history, 200)) {
      m.set(`${pr.name.toLowerCase()}|${pr.date}`, pr.kind);
    }
    return m;
  }, [history]);

  const totalVolume = useMemo(
    () => history.reduce((sum, w) => sum + (w.volume || 0), 0),
    [history]
  );

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.pageHeader}>
        <Text style={styles.title}>History</Text>
        {history.length > 0 && (
          <Text style={styles.summary} accessibilityRole="text">
            <Text style={styles.summaryNum}>{history.length}</Text>
            {history.length === 1 ? ' session' : ' sessions'}
            <Text style={styles.summaryDot}>  ·  </Text>
            <Text style={styles.summaryNum}>{totalVolume.toLocaleString()}</Text> lb forged
          </Text>
        )}
      </View>

      {history.length === 0 ? (
        <Text style={styles.empty}>Cold. Nothing logged.</Text>
      ) : (
        history.map((w, idx) => (
          <WorkoutCard
            key={w.id}
            workout={w}
            index={idx}
            trends={trends}
            prKinds={prKinds}
          />
        ))
      )}
    </ScrollView>
  );
}

function WorkoutCard({
  workout: w,
  index,
  trends,
  prKinds,
}: {
  workout: WorkoutRecord;
  index: number;
  trends: Record<string, number[]>;
  prKinds: Map<string, PRKind>;
}) {
  // Subtle staggered fade + lift-in as cards mount.
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 320,
      delay: Math.min(index, 8) * 45,
      useNativeDriver: true,
    }).start();
  }, [anim, index]);

  const cardAnim = {
    opacity: anim,
    transform: [
      { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
    ],
  };

  return (
    <Animated.View style={[styles.cardWrap, cardAnim]}>
      <Surface style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardName} numberOfLines={1}>{w.name}</Text>
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
          <View style={[styles.stat, styles.volStat]}>
            <ForgedNumber
              value={w.volume.toLocaleString()}
              size={22}
              color={HEAT.white}
              glow
              glowColor={HEAT.hot}
              glowIntensity={0.55}
            />
            <Text style={styles.statLabel}>lb volume</Text>
          </View>
        </View>

        {/* Per-exercise breakdown: sets · session e1RM · trend heat-strip · PR mark */}
        {w.exerciseData && w.exerciseData.length > 0 && (
          <View style={styles.breakdown}>
            {w.exerciseData.map((ex, i) => {
              const best = bestE1RM(ex.sets);
              const series = trends[ex.name.toLowerCase()] ?? [];
              const strip = series.slice(-STRIP_LEN);
              const allTimeBest = series.length ? Math.max(...series) : 0;
              const latest = best ? Math.round(best.orm) : 0;
              const frac = allTimeBest > 0 ? latest / allTimeBest : 0;
              const stripColor = heatForFraction(frac);
              const kind = prKinds.get(`${ex.name.toLowerCase()}|${w.date}`);
              const isPR = !!kind;
              const strengthPR = kind === 'strength' || kind === 'both';
              const marker = kind === 'volume' ? '📈 ' : isPR ? '🔥 ' : '';
              const display = cleanExName(ex.name);

              return (
                <View
                  key={i}
                  style={styles.exRow}
                  accessibilityRole="text"
                  accessibilityLabel={
                    `${display}, ${ex.sets.map(s => `${s.weight} by ${s.reps}`).join(', ')}` +
                    (best ? `, e1RM ${latest} pounds` : '') +
                    (kind ? `, ${kind === 'volume' ? 'volume' : kind === 'both' ? 'e1RM and volume' : 'e1RM'} record` : '')
                  }
                >
                  <View style={styles.exHead}>
                    <Text style={[styles.exName, isPR && styles.exNamePR]} numberOfLines={1}>
                      {marker}{display}
                    </Text>
                    {strip.length > 1 && (
                      <HeatStrip values={strip} color={stripColor} width={4} gap={2} maxHeight={16} />
                    )}
                  </View>
                  <View style={styles.exData}>
                    <Text style={styles.exSets}>
                      {ex.sets.map(s => `${s.weight}×${s.reps}`).join('  ')}
                    </Text>
                    {best && (
                      <Text style={[styles.exOrm, strengthPR && styles.exOrmPR]}>
                        {latest}
                        <Text style={styles.exOrmUnit}> e1RM</Text>
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
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
      </Surface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { paddingBottom: 100 },
  pageHeader: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: F.xxxl, fontFamily: FONT.black, color: C.text, letterSpacing: -0.5 },
  summary: { marginTop: 6, color: C.text3, fontSize: F.xs, fontFamily: FONT.medium },
  summaryNum: { color: C.text2, fontFamily: FONT.bold, fontVariant: ['tabular-nums'] },
  summaryDot: { color: C.text3 },
  empty: { paddingHorizontal: 20, color: C.text3, fontSize: F.base, fontFamily: FONT.medium, lineHeight: 24 },

  cardWrap: { marginHorizontal: 16, marginBottom: 12 },
  card: { padding: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  cardName: { color: C.text, fontSize: F.base, fontFamily: FONT.xbold, flex: 1, letterSpacing: -0.2 },
  cardDate: { color: C.text2, fontSize: F.xs, fontFamily: FONT.medium, marginLeft: 8 },

  stats: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  stat: { flex: 1, alignItems: 'center' },
  volStat: { justifyContent: 'center' },
  statVal: { color: C.text, fontSize: F.xl, fontFamily: FONT.bold, fontVariant: ['tabular-nums'] },
  statLabel: { color: C.text3, fontSize: F.xs, fontFamily: FONT.medium, marginTop: 2 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: C.border },

  breakdown: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 12 },
  exRow: { gap: 2 },
  exHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  exName: { color: C.text2, fontSize: F.xs, fontFamily: FONT.semi, flex: 1 },
  exNamePR: { color: HEAT.white, fontFamily: FONT.bold },
  exData: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  exSets: { color: C.text3, fontSize: F.xs, fontFamily: FONT.regular, fontVariant: ['tabular-nums'], flex: 1 },
  exOrm: { color: HEAT.warm, fontSize: F.sm, fontFamily: FONT.bold, fontVariant: ['tabular-nums'] },
  exOrmPR: { color: HEAT.white },
  exOrmUnit: { color: C.text3, fontSize: F.xs, fontFamily: FONT.medium },

  exTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  exTag: {
    backgroundColor: C.surface2,
    borderRadius: RADIUS.sm,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  exTagText: { color: C.text2, fontSize: F.xs, fontFamily: FONT.semi },
});
