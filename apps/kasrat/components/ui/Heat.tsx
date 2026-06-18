import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, HEAT, heatForRpe } from '@/constants/theme';

export { heatForRpe };

// RPE as heat pips: 10 dots filled to the (upper-bound) RPE value, in the heat color.
export function HeatDots({
  rpe,
  dotSize = 6,
  gap = 3,
}: {
  rpe?: string | number;
  dotSize?: number;
  gap?: number;
}) {
  const nums = String(rpe ?? '').match(/\d+/g)?.map(Number) ?? [];
  const v = nums.length ? Math.min(10, Math.max(...nums)) : 0;
  const color = heatForRpe(rpe);
  return (
    <View style={[styles.row, { gap }]}>
      {Array.from({ length: 10 }).map((_, i) => (
        <View
          key={i}
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: i < v ? color : C.surface2,
          }}
        />
      ))}
    </View>
  );
}

// Horizontal heat bar (track + gradient fill). pct 0..1.
export function HeatBar({
  pct,
  color = HEAT.warm,
  height = 4,
  track = C.surface2,
  style,
}: {
  pct: number;
  color?: string;
  height?: number;
  track?: string;
  style?: ViewStyle;
}) {
  const w = Math.max(0, Math.min(1, pct));
  return (
    <View style={[{ height, backgroundColor: track, borderRadius: height / 2, overflow: 'hidden' }, style]}>
      <LinearGradient
        colors={[color + '88', color] as const}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ width: `${w * 100}%`, height: '100%' }}
      />
    </View>
  );
}

// Tiny column trend (history heat-strip): values → bars, newest highlighted in heat color.
export function HeatStrip({
  values,
  color = HEAT.warm,
  width = 5,
  gap = 3,
  maxHeight = 22,
}: {
  values: number[];
  color?: string;
  width?: number;
  gap?: number;
  maxHeight?: number;
}) {
  const max = Math.max(1, ...values);
  return (
    <View style={[styles.rowEnd, { gap }]}>
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * maxHeight);
        const last = i === values.length - 1;
        return (
          <View key={i} style={{ width, height: h, borderRadius: 2, backgroundColor: last ? color : C.border }} />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  rowEnd: { flexDirection: 'row', alignItems: 'flex-end' },
});
