import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { C } from '@/constants/theme';
import { demoFor } from '@/store/demos';

type Props = { name: string; height?: number };

// Loops an exercise's start and end photos: hold the start, ease into the end position,
// hold, ease back — reads as the rep's range of motion. Renders nothing without a demo.
export function ExerciseDemo({ name, height = 200 }: Props) {
  const frames = demoFor(name);
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!frames) return;
    const ease = { duration: 450, easing: Easing.inOut(Easing.quad), useNativeDriver: true };
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(650),
        Animated.timing(t, { toValue: 1, ...ease }),
        Animated.delay(650),
        Animated.timing(t, { toValue: 0, ...ease }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [frames, t]);

  if (!frames) return null;
  return (
    <View style={[s.box, { height }]} accessibilityLabel={`${name} form demo`}>
      <Animated.Image source={frames[0]} style={s.img} resizeMode="contain" />
      <Animated.Image source={frames[1]} style={[s.img, { opacity: t }]} resizeMode="contain" />
    </View>
  );
}

export function hasDemo(name: string): boolean {
  return !!demoFor(name);
}

const s = StyleSheet.create({
  box: { backgroundColor: C.surface2, borderRadius: 10, overflow: 'hidden' },
  img: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
});
