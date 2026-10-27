import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { C, mono } from './theme';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Btn(p: {
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  primary?: boolean;
  danger?: boolean;
  active?: boolean;
  small?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      onLongPress={p.onLongPress}
      disabled={p.disabled}
      hitSlop={4}
      style={({ pressed }) => [
        s.btn,
        p.small && s.btnSmall,
        p.primary && { backgroundColor: C.accent, borderColor: C.accent },
        p.danger && { borderColor: C.danger },
        p.active && { borderColor: C.accent, backgroundColor: C.accentDim },
        (pressed || p.disabled) && { opacity: 0.55 },
        p.style,
      ]}>
      <Text style={[s.btnText, p.small && { fontSize: 13 }, p.primary && { color: C.bg }, p.danger && { color: C.danger }, p.textStyle]}>
        {p.label}
      </Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress, color = C.accent }: { label: string; on: boolean; onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && { backgroundColor: color, borderColor: color }]}>
      <Text style={[s.chipText, on && { color: C.bg }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ text, color = C.amber }: { text: string; color?: string }) {
  return (
    <View style={[s.badge, { borderColor: color }]}>
      <Text style={[s.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

export function Stepper(p: { name: string; value: string; onMinus: () => void; onPlus: () => void; extra?: ReactNode }) {
  return (
    <View style={s.stepper}>
      <Text style={s.stepName}>{p.name}</Text>
      <Btn label="−" small onPress={p.onMinus} style={s.stepBtn} />
      <Text style={s.stepValue}>{p.value}</Text>
      <Btn label="+" small onPress={p.onPlus} style={s.stepBtn} />
      {p.extra}
    </View>
  );
}

/** Horizontal signal meter with an optional squelch threshold tick (both in dB, 0-40). */
export function Meter({ db, squelch, open, color = C.accent }: { db: number; squelch?: number; open: boolean; color?: string }) {
  const pct = (v: number) => `${Math.max(0, Math.min(1, v / 40)) * 100}%` as const;
  return (
    <View style={s.meterRow}>
      <View style={[s.light, open && { backgroundColor: C.ok }]} />
      <View style={s.meter}>
        <View style={[s.meterFill, { width: pct(db), backgroundColor: color }]} />
        {squelch ? <View style={[s.meterTick, { left: pct(squelch) }]} /> : null}
      </View>
      <Text style={s.meterText}>{`${db.toFixed(0)} dB`}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={s.h2}>{children}</Text>;
}

export const s = StyleSheet.create({
  card: { backgroundColor: C.panel, marginHorizontal: 12, marginTop: 10, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.line },
  btn: {
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panel2,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSmall: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  btnText: { color: C.text, fontWeight: '600', fontSize: 14 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: C.panel2 },
  chipText: { color: C.text, fontSize: 13, fontWeight: '500' },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  stepName: { color: C.muted, width: 68, fontSize: 13 },
  stepBtn: { minWidth: 40 },
  stepValue: { color: C.text, flex: 1, textAlign: 'center', fontFamily: mono, fontSize: 14 },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  light: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.line },
  meter: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.panel2, overflow: 'hidden' },
  meterFill: { height: 8 },
  meterTick: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: C.amber },
  meterText: { color: C.muted, width: 46, textAlign: 'right', fontFamily: mono, fontSize: 12 },
  h2: { color: C.text, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  muted: { color: C.muted },
  text: { color: C.text },
  row: { flexDirection: 'row', alignItems: 'center' },
});
