import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/store/StoreContext';
import type { WorkoutRecord } from '@/types';
import { C, F } from '@/constants/theme';

type Pt = { date: string; maxWeight: number };

function gather(history: WorkoutRecord[], exerciseName: string): Pt[] {
  const pts: Pt[] = [];
  for (const rec of [...history].reverse()) {
    const ex = rec.exerciseData?.find(e => e.name === exerciseName);
    if (!ex) continue;
    const weights = ex.sets
      .filter(s => s.done)
      .map(s => parseFloat(s.weight) || 0)
      .filter(w => w > 0);
    if (weights.length) pts.push({ date: rec.date, maxWeight: Math.max(...weights) });
  }
  return pts;
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Strip program parentheticals like "(heavy wk: 4×4 @80% · …)" for display
export function cleanExName(name: string) {
  return name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim() || name;
}

const CHART_H = 140;
const PX = 16; // horizontal padding inside chart
const PY = 18; // vertical padding inside chart

function LineChart({ pts }: { pts: Pt[] }) {
  const [containerW, setContainerW] = useState(0);

  const coords = useMemo(() => {
    if (!containerW || pts.length < 2) return [];
    const vals = pts.map(p => p.maxWeight);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || 1;
    return pts.map((p, i) => ({
      x: PX + (i / (pts.length - 1)) * (containerW - PX * 2),
      y: PY + (1 - (p.maxWeight - lo) / span) * (CHART_H - PY * 2),
      ...p,
    }));
  }, [containerW, pts]);

  const maxW = pts.length ? Math.max(...pts.map(p => p.maxWeight)) : 0;
  // Last index that achieved the overall max (most recent PR)
  const prIdx = coords.reduce((b, c, i) => (c.maxWeight >= maxW ? i : b), 0);
  const n = coords.length;

  return (
    <View
      style={{ height: CHART_H + 20 }}
      onLayout={e => setContainerW(e.nativeEvent.layout.width)}
    >
      {/* Connecting line segments */}
      {coords.slice(1).map((pt, i) => {
        const prev = coords[i];
        const dx = pt.x - prev.x;
        const dy = pt.y - prev.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: (prev.x + pt.x) / 2 - len / 2,
              top: (prev.y + pt.y) / 2 - 1,
              width: len,
              height: 2,
              backgroundColor: C.accent,
              transform: [{ rotate: `${angle}deg` }],
            }}
          />
        );
      })}

      {/* Data point dots + weight labels */}
      {coords.map((pt, i) => {
        const isPR = i === prIdx;
        const showLabel = i === 0 || i === n - 1 || isPR;
        // PR label goes above dot so it doesn't overlap the dot below the line
        const labelAbove = isPR && i > 0 && i < n - 1;
        return (
          <View key={i} style={{ position: 'absolute', left: pt.x - 4, top: pt.y - 4 }}>
            <View style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: isPR ? C.green : C.accent,
            }} />
            {showLabel && (
              <Text style={{
                position: 'absolute',
                top: labelAbove ? -14 : 10,
                left: -16,
                width: 40,
                textAlign: 'center',
                fontSize: F.xs - 1,
                color: isPR ? C.green : C.text2,
                fontVariant: ['tabular-nums'],
              }}>
                {pt.maxWeight}
              </Text>
            )}
          </View>
        );
      })}

      {/* X-axis date labels: first and last session only */}
      {n > 0 && (
        <>
          <Text style={{ position: 'absolute', left: coords[0].x - 20, top: CHART_H + 3, width: 40, textAlign: 'center', fontSize: F.xs - 1, color: C.text3 }}>
            {shortDate(coords[0].date)}
          </Text>
          {n > 1 && (
            <Text style={{ position: 'absolute', left: coords[n - 1].x - 20, top: CHART_H + 3, width: 40, textAlign: 'center', fontSize: F.xs - 1, color: C.text3 }}>
              {shortDate(coords[n - 1].date)}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

export function ProgressChart({ exerciseName, onClose }: { exerciseName: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { history } = useStore();
  const pts = useMemo(() => gather(history, exerciseName), [history, exerciseName]);
  const best = pts.length ? Math.max(...pts.map(p => p.maxWeight)) : 0;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 16 }]}>
        <View style={s.handle} />
        <View style={s.hdr}>
          <Text style={s.title} numberOfLines={1}>{cleanExName(exerciseName)}</Text>
          {best > 0 && <Text style={s.best}>Best: {best} lb</Text>}
        </View>

        {pts.length < 2
          ? <Text style={s.empty}>{pts.length === 0 ? 'No logged sets yet.' : 'Log one more session to see trend.'}</Text>
          : <LineChart pts={pts} />
        }

        <Text style={s.sub}>{pts.length} session{pts.length !== 1 ? 's' : ''} tracked</Text>
        <TouchableOpacity style={s.closeBtn} onPress={onClose}>
          <Text style={s.closeTxt}>Done</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  hdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  title: { fontSize: F.lg, fontWeight: '700', color: C.text, flex: 1, marginRight: 8 },
  best: { fontSize: F.sm, fontWeight: '700', color: C.green },
  empty: { color: C.text3, fontSize: F.sm, paddingVertical: 32, textAlign: 'center' },
  sub: { color: C.text3, fontSize: F.xs, textAlign: 'center', marginTop: 6 },
  closeBtn: {
    marginTop: 14,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  closeTxt: { color: C.text, fontSize: F.sm, fontWeight: '600' },
});
