import React from 'react';
import { StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { C, FONT } from '@/constants/theme';
import { Glow } from './Glow';

type Props = {
  value: string | number;
  /** Font size in px; the hero numeral. */
  size?: number;
  color?: string;
  glow?: boolean;
  glowColor?: string;
  glowIntensity?: number;
  style?: ViewStyle;
  textStyle?: TextStyle;
};

// The data-as-hero numeral: heavy Archivo, tabular figures, optional ember glow behind.
export function ForgedNumber({
  value,
  size = 48,
  color = C.text,
  glow = false,
  glowColor,
  glowIntensity = 1,
  style,
  textStyle,
}: Props) {
  return (
    <View style={[styles.wrap, style]}>
      {glow && <Glow color={glowColor ?? color} size={size * 3} intensity={glowIntensity} />}
      <Text
        style={[
          { fontFamily: FONT.black, fontSize: size, lineHeight: size * 1.04, color },
          styles.num,
          textStyle,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  num: { fontVariant: ['tabular-nums'], letterSpacing: -0.5, includeFontPadding: false },
});
