import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, RADIUS } from '@/constants/theme';
import { addMonths, monthLabel } from '@/lib/money';

export function Screen({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 110 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.header}>
        <Text style={s.title}>{title}</Text>
        {right}
      </View>
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

export function Bar({ value, color = C.accent }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={s.barTrack}>
      <View style={[s.barFill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && s.chipActive]} hitSlop={4}>
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <View style={s.seg}>
      {options.map(o => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.segItem, value === o.value && s.segActive]}>
          <Text style={[s.segText, value === o.value && s.segTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Button({ label, onPress, kind = 'primary', style }: {
  label: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.btn, kind === 'primary' ? s.btnPrimary : kind === 'danger' ? s.btnDanger : s.btnGhost, pressed && { opacity: 0.75 }, style]}
    >
      <Text style={[s.btnText, kind === 'primary' && { color: C.accentInk }, kind === 'danger' && { color: C.red }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Label>{label}</Label>
      <TextInput placeholderTextColor={C.text3} {...props} style={[s.input, props.style]} />
    </View>
  );
}

export function MonthSwitcher({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  return (
    <View style={s.month}>
      <Pressable onPress={() => onChange(addMonths(value, -1))} hitSlop={12} style={s.monthBtn}>
        <Text style={s.monthArrow}>‹</Text>
      </Pressable>
      <Text style={s.monthText}>{monthLabel(value)}</Text>
      <Pressable onPress={() => onChange(addMonths(value, 1))} hitSlop={12} style={s.monthBtn}>
        <Text style={s.monthArrow}>›</Text>
      </Pressable>
    </View>
  );
}

export function Row({ left, sub, right, rightColor, onPress }: {
  left: string; sub?: string; right: string; rightColor?: string; onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && onPress && { opacity: 0.6 }]}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={s.rowLeft} numberOfLines={1}>{left}</Text>
        {sub ? <Text style={s.rowSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      <Text style={[s.rowRight, rightColor ? { color: rightColor } : null]}>{right}</Text>
    </Pressable>
  );
}

export const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { color: C.text, fontSize: F.xxl, fontWeight: '800' },
  card: { backgroundColor: C.surface, borderColor: C.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS.lg, padding: 16, marginBottom: 12 },
  label: { color: C.text2, fontSize: F.sm, marginBottom: 6 },
  barTrack: { height: 6, backgroundColor: C.surface2, borderRadius: 3, overflow: 'hidden', marginTop: 8 },
  barFill: { height: 6, borderRadius: 3 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.pill, backgroundColor: C.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, marginRight: 8, marginBottom: 8 },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.text2, fontSize: F.sm, fontWeight: '600' },
  chipTextActive: { color: C.accentInk },
  seg: { flexDirection: 'row', backgroundColor: C.surface2, borderRadius: RADIUS.md, padding: 3, marginBottom: 16 },
  segItem: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: RADIUS.sm },
  segActive: { backgroundColor: C.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  segText: { color: C.text3, fontWeight: '600', fontSize: F.sm },
  segTextActive: { color: C.text },
  btn: { paddingVertical: 13, borderRadius: RADIUS.md, alignItems: 'center' },
  btnPrimary: { backgroundColor: C.accent },
  btnGhost: { backgroundColor: C.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  btnDanger: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: C.red },
  btnText: { color: C.text, fontWeight: '700', fontSize: F.base },
  input: { backgroundColor: C.surface2, color: C.text, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 11, fontSize: F.base },
  month: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  monthBtn: { paddingHorizontal: 18, paddingVertical: 4 },
  monthArrow: { color: C.text2, fontSize: 26, lineHeight: 28 },
  monthText: { color: C.text, fontSize: F.lg, fontWeight: '700', minWidth: 110, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomColor: C.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLeft: { color: C.text, fontSize: F.base, fontWeight: '600' },
  rowSub: { color: C.text3, fontSize: F.sm, marginTop: 2 },
  rowRight: { color: C.text, fontSize: F.base, fontWeight: '700', fontVariant: ['tabular-nums'] },
  muted: { color: C.text3, fontSize: F.sm },
  big: { color: C.text, fontSize: F.hero, fontWeight: '800', fontVariant: ['tabular-nums'] },
  mid: { color: C.text, fontSize: F.xl, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sectionTitle: { color: C.text2, fontSize: F.sm, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, marginTop: 8 },
});
