import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMetrics } from '@/store/MetricsContext';
import type { BodyMetric } from '@/store/metricsStore';
import { C, F, FONT, HEAT, RADIUS, SHADOW } from '@/constants/theme';
import { ForgedNumber } from '@/components/ui/ForgedNumber';
import { Surface } from '@/components/ui/Surface';
import { HeatStrip } from '@/components/ui/Heat';
import { haptics } from '@/components/ui/haptics';

type Unit = 'kg' | 'lb';

// Optional measurements, in display order, with their glyph + label.
const MEASURES: { key: 'waist' | 'arm' | 'chest' | 'thigh'; label: string }[] = [
  { key: 'waist', label: 'Waist' },
  { key: 'chest', label: 'Chest' },
  { key: 'arm', label: 'Arm' },
  { key: 'thigh', label: 'Thigh' },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

// Parse a loose decimal string → finite positive number, else undefined.
function num(s: string): number | undefined {
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

export default function BodyScreen() {
  const insets = useSafeAreaInsets();
  const { metrics, latestWeight, addMetric, deleteMetric, loaded } = useMetrics();

  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState<Unit>('kg');
  const [open, setOpen] = useState(false); // measurement section expanded
  const [waist, setWaist] = useState('');
  const [chest, setChest] = useState('');
  const [arm, setArm] = useState('');
  const [thigh, setThigh] = useState('');
  const [note, setNote] = useState('');

  const measureInput: Record<string, [string, (s: string) => void]> = {
    waist: [waist, setWaist],
    chest: [chest, setChest],
    arm: [arm, setArm],
    thigh: [thigh, setThigh],
  };

  // Last ~10 weigh-ins, chronological (oldest → newest) so the strip reads left→right.
  const trend = useMemo(() => {
    return metrics
      .filter(m => typeof m.weight === 'number')
      .slice(0, 10)
      .reverse()
      .map(m => m.weight as number);
  }, [metrics]);

  // Heat the hero/strip by latest-vs-prior change: gaining reads hotter than holding.
  const heroColor = useMemo(() => {
    if (trend.length >= 2) {
      const delta = trend[trend.length - 1] - trend[trend.length - 2];
      if (delta > 0) return HEAT.hot;
      if (delta < 0) return HEAT.cool;
    }
    return HEAT.warm;
  }, [trend]);

  // Pulse the hero glow once on a fresh log.
  const pulse = useRef(new Animated.Value(1)).current;
  function bloom() {
    pulse.setValue(1.6);
    Animated.timing(pulse, { toValue: 1, duration: 520, useNativeDriver: true }).start();
  }

  const w = num(weight);
  const hasAnyMeasure = !!(num(waist) || num(chest) || num(arm) || num(thigh));
  const canSave = !!w || hasAnyMeasure;

  function clear() {
    setWeight(''); setWaist(''); setChest(''); setArm(''); setThigh(''); setNote('');
  }

  function handleSave() {
    if (!canSave) return;
    Keyboard.dismiss();
    const entry: Omit<BodyMetric, 'id' | 'date'> = {
      weight: w,
      unit: w ? unit : undefined,
      waist: num(waist),
      chest: num(chest),
      arm: num(arm),
      thigh: num(thigh),
      note: note.trim() || undefined,
    };
    addMetric(entry);
    haptics.done();
    bloom();
    clear();
  }

  function confirmDelete(m: BodyMetric) {
    Alert.alert('Strike this mark', fmtDate(m.date), [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMetric(m.id) },
    ]);
  }

  // Summarize an entry's measurements for the history row.
  function measureSummary(m: BodyMetric): string {
    return MEASURES
      .filter(({ key }) => typeof m[key] === 'number')
      .map(({ key, label }) => `${label} ${m[key]}`)
      .join(' · ');
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <View style={styles.pageHeader}>
        <Text style={styles.title}>Body</Text>
        <Text style={styles.note}>Not counted in training volume.</Text>
      </View>

      {!loaded ? null : (
        <>
          {/* Latest weight hero */}
          <Surface style={styles.hero}>
            {latestWeight?.weight != null ? (
              <>
                <Text style={styles.heroLabel}>LATEST</Text>
                <Animated.View style={{ transform: [{ scale: pulse }] }}>
                  <ForgedNumber
                    value={latestWeight.weight}
                    size={72}
                    color={heroColor}
                    glow
                    glowColor={heroColor}
                    glowIntensity={1.1}
                  />
                </Animated.View>
                <Text style={[styles.heroUnit, { color: heroColor }]}>
                  {(latestWeight.unit ?? 'kg').toUpperCase()}
                </Text>
                <Text style={styles.heroDate}>{fmtDate(latestWeight.date)}</Text>
                {trend.length >= 2 && (
                  <View style={styles.strip}>
                    <HeatStrip values={trend} color={heroColor} maxHeight={28} />
                    <Text style={styles.stripLabel}>last {trend.length} weigh-ins</Text>
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.heroEmpty}>No marks yet.</Text>
            )}
          </Surface>

          {/* Log entry */}
          <Surface style={styles.logCard}>
            <Text style={styles.cardLabel}>NEW MARK</Text>

            <View style={styles.weightRow}>
              <TextInput
                style={styles.weightInput}
                value={weight}
                onChangeText={setWeight}
                placeholder="0.0"
                placeholderTextColor={C.text3}
                keyboardType="decimal-pad"
                returnKeyType="done"
                accessibilityLabel="Bodyweight"
                maxLength={6}
              />
              <View style={styles.unitToggle} accessibilityRole="radiogroup">
                {(['kg', 'lb'] as Unit[]).map(u => {
                  const active = unit === u;
                  return (
                    <TouchableOpacity
                      key={u}
                      style={[styles.unitBtn, active && styles.unitBtnActive]}
                      onPress={() => { setUnit(u); haptics.tap(); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Unit ${u}`}
                    >
                      <Text style={[styles.unitText, active && styles.unitTextActive]}>{u}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Optional measurements */}
            <TouchableOpacity
              style={styles.disclosure}
              onPress={() => { setOpen(o => !o); haptics.tap(); }}
              accessibilityRole="button"
              accessibilityLabel={open ? 'Hide measurements' : 'Add measurements'}
              accessibilityState={{ expanded: open }}
            >
              <Text style={styles.disclosureText}>Measurements</Text>
              <Text style={styles.disclosureChevron}>{open ? '−' : '+'}</Text>
            </TouchableOpacity>

            {open && (
              <View style={styles.measureGrid}>
                {MEASURES.map(({ key, label }) => {
                  const [val, set] = measureInput[key];
                  return (
                    <View key={key} style={styles.measureCell}>
                      <Text style={styles.measureLabel}>{label}</Text>
                      <TextInput
                        style={styles.measureInput}
                        value={val}
                        onChangeText={set}
                        placeholder="—"
                        placeholderTextColor={C.text3}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        accessibilityLabel={label}
                        maxLength={6}
                      />
                    </View>
                  );
                })}
                <View style={styles.noteCell}>
                  <Text style={styles.measureLabel}>Note</Text>
                  <TextInput
                    style={styles.noteInput}
                    value={note}
                    onChangeText={setNote}
                    placeholder="—"
                    placeholderTextColor={C.text3}
                    returnKeyType="done"
                    accessibilityLabel="Note"
                    maxLength={120}
                  />
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[styles.logBtn, !canSave && styles.logBtnDisabled]}
              onPress={handleSave}
              disabled={!canSave}
              accessibilityRole="button"
              accessibilityLabel="Log it"
              accessibilityState={{ disabled: !canSave }}
            >
              <Text style={[styles.logBtnText, !canSave && styles.logBtnTextDisabled]}>Log it.</Text>
            </TouchableOpacity>
          </Surface>

          {/* History */}
          <Text style={styles.sectionLabel}>Log</Text>
          {metrics.length === 0 ? (
            <Text style={styles.empty}>No marks yet.</Text>
          ) : (
            metrics.map(m => {
              const summary = measureSummary(m);
              return (
                <Surface key={m.id} style={styles.histRow}>
                  <View style={styles.histMain}>
                    <View style={styles.histTop}>
                      <Text style={styles.histDate}>{fmtDate(m.date)}</Text>
                      {m.weight != null && (
                        <Text style={styles.histWeight}>
                          {m.weight}
                          <Text style={styles.histUnit}> {(m.unit ?? 'kg')}</Text>
                        </Text>
                      )}
                    </View>
                    {!!summary && <Text style={styles.histMeasures}>{summary}</Text>}
                    {!!m.note && <Text style={styles.histNote}>{m.note}</Text>}
                  </View>
                  <TouchableOpacity
                    style={styles.delBtn}
                    onPress={() => confirmDelete(m)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete mark from ${fmtDate(m.date)}`}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Text style={styles.delGlyph}>✕</Text>
                  </TouchableOpacity>
                </Surface>
              );
            })
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { paddingBottom: 100 },
  pageHeader: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: F.xxxl, fontFamily: FONT.black, color: C.text },
  note: { fontSize: F.xs, color: C.text3, marginTop: 4, letterSpacing: 0.3 },

  // Hero
  hero: { marginHorizontal: 16, marginBottom: 12, paddingVertical: 24, alignItems: 'center', ...SHADOW.ember },
  heroLabel: { fontSize: F.xs, fontFamily: FONT.bold, letterSpacing: 1.5, color: C.text3, marginBottom: 4 },
  heroUnit: { fontSize: F.base, fontFamily: FONT.xbold, letterSpacing: 1, marginTop: 2 },
  heroDate: { fontSize: F.xs, color: C.text2, marginTop: 6 },
  heroEmpty: { fontSize: F.lg, fontFamily: FONT.bold, color: C.text3, paddingVertical: 16 },
  strip: { alignItems: 'center', marginTop: 16, gap: 6 },
  stripLabel: { fontSize: F.xs, color: C.text3, letterSpacing: 0.3 },

  // Log card
  logCard: { marginHorizontal: 16, marginBottom: 8, padding: 16, gap: 14 },
  cardLabel: { fontSize: F.xs, fontFamily: FONT.bold, letterSpacing: 1.5, color: C.text3 },
  weightRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  weightInput: {
    flex: 1,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 16,
    height: 64,
    color: C.text,
    fontSize: F.xxxl,
    fontFamily: FONT.black,
    fontVariant: ['tabular-nums'],
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: RADIUS.md,
    padding: 3,
    gap: 3,
  },
  unitBtn: {
    minWidth: 46,
    height: 46,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unitBtnActive: { backgroundColor: C.accent },
  unitText: { fontSize: F.base, fontFamily: FONT.bold, color: C.text2 },
  unitTextActive: { color: '#0e0c09' },

  // Disclosure
  disclosure: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  disclosureText: { fontSize: F.sm, fontFamily: FONT.semi, color: C.text2 },
  disclosureChevron: { fontSize: F.xl, fontFamily: FONT.bold, color: C.accent, width: 24, textAlign: 'center' },

  measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  measureCell: { width: '47%' },
  measureLabel: { fontSize: F.xs, fontFamily: FONT.medium, color: C.text3, marginBottom: 5, letterSpacing: 0.3 },
  measureInput: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 12,
    height: 46,
    color: C.text,
    fontSize: F.lg,
    fontFamily: FONT.semi,
    fontVariant: ['tabular-nums'],
  },
  noteCell: { width: '100%' },
  noteInput: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 12,
    height: 46,
    color: C.text,
    fontSize: F.base,
    fontFamily: FONT.regular,
  },

  // Log button
  logBtn: {
    backgroundColor: C.accent,
    borderRadius: RADIUS.md,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.ember,
  },
  logBtnDisabled: { backgroundColor: C.surface2, shadowOpacity: 0, elevation: 0 },
  logBtnText: { color: '#0e0c09', fontSize: F.lg, fontFamily: FONT.xbold, letterSpacing: 0.3 },
  logBtnTextDisabled: { color: C.text3 },

  // History
  sectionLabel: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
    fontSize: F.xs,
    fontFamily: FONT.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: C.text3,
  },
  empty: { paddingHorizontal: 20, color: C.text3, fontSize: F.base, lineHeight: 24 },
  histRow: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  histMain: { flex: 1 },
  histTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  histDate: { color: C.text2, fontSize: F.sm, fontFamily: FONT.semi },
  histWeight: { color: C.text, fontSize: F.xl, fontFamily: FONT.xbold, fontVariant: ['tabular-nums'] },
  histUnit: { color: C.text3, fontSize: F.xs, fontFamily: FONT.semi },
  histMeasures: { color: C.text2, fontSize: F.xs, marginTop: 5, fontVariant: ['tabular-nums'] },
  histNote: { color: C.text3, fontSize: F.xs, marginTop: 4, fontStyle: 'italic' },
  delBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    marginRight: -8,
  },
  delGlyph: { color: C.text3, fontSize: F.base, fontFamily: FONT.bold },
});
