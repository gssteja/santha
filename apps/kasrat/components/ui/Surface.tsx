import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { C, RADIUS, SHADOW } from '@/constants/theme';

type Props = {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Drop the warm card shadow (e.g. for nested surfaces). */
  flat?: boolean;
};

// Cast-iron surface card: iron fill, machined hairline border, warm drop shadow.
export function Surface({ children, style, flat = false }: Props) {
  return <View style={[styles.base, !flat && SHADOW.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: RADIUS.lg,
  },
});
