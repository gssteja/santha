import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { HEAT } from '@/constants/theme';

type Props = {
  color?: string;
  /** Diameter of the outermost bloom. */
  size?: number;
  /** 0..1 brightness multiplier. */
  intensity?: number;
  style?: ViewStyle;
};

// Soft ember bloom — layered translucent circles (no SVG / native dep). Decorative;
// place as the first child of a relatively-positioned parent, behind content.
export function Glow({ color = HEAT.hot, size = 160, intensity = 1, style }: Props) {
  return (
    <View pointerEvents="none" style={[styles.wrap, style]}>
      <View
        style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: 0.1 * intensity }}
      />
      <View
        style={{ position: 'absolute', width: size * 0.62, height: size * 0.62, borderRadius: size * 0.31, backgroundColor: color, opacity: 0.16 * intensity }}
      />
      <View
        style={{ position: 'absolute', width: size * 0.32, height: size * 0.32, borderRadius: size * 0.16, backgroundColor: color, opacity: 0.22 * intensity }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
