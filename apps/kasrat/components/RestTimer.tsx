import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { C, F } from '@/constants/theme';

type Props = {
  visible: boolean;
  seconds: number;          // auto-set per exercise
  exerciseName?: string;
  onDismiss: () => void;
};

// Auto rest duration per exercise: heavy compounds rest longest, isolation shortest.
export function restForExercise(name: string, muscle?: string): number {
  const n = name.toLowerCase();
  if (/(squat|deadlift|bench|overhead press|barbell.*press|arnold press|weighted pull|weighted dip|\bdip\b|bent-over row|pull-?up)/.test(n)) {
    return 180;
  }
  if (/(curl|lateral raise|leg raise|fly|flye|pushdown|pressdown|extension|crunch|face pull|shrug|push-?up|calf|leg curl|cable crunch)/.test(n)) {
    return 75;
  }
  // Rows, machine presses, pulldowns, leg press, RDL — moderate
  return 120;
}

function fmt(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}`;
}

export function RestTimer({ visible, seconds, exerciseName, onDismiss }: Props) {
  const [remaining, setRemaining] = useState(seconds);
  const [target, setTarget] = useState(seconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(1)).current; // 1 → 0

  function runProgress(from: number, total: number) {
    progress.setValue(from / total);
    Animated.timing(progress, {
      toValue: 0,
      duration: from * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }

  useEffect(() => {
    if (visible) {
      setTarget(seconds);
      setRemaining(seconds);
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      runProgress(seconds, seconds);
      intervalRef.current = setInterval(() => {
        setRemaining(r => {
          if (r <= 1) {
            clearInterval(intervalRef.current!);
            Vibration.vibrate(400);
            onDismiss();
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    } else {
      Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible]);

  function addTime(s: number) {
    setRemaining(r => {
      const next = Math.max(0, r + s);
      const total = Math.max(next, target);
      setTarget(total);
      runProgress(next, total);
      return next;
    });
  }

  const widthPct = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <Animated.View style={[s.overlay, { opacity }]}>
        <View style={s.card}>
          <Text style={s.label}>Rest</Text>
          {exerciseName ? <Text style={s.exName} numberOfLines={1}>{exerciseName}</Text> : null}
          <View style={s.circle}>
            <Text style={s.countdown}>{fmt(remaining)}</Text>
            <Text style={s.targetText}>of {fmt(target)}</Text>
          </View>
          <View style={s.track}>
            <Animated.View style={[s.fill, { width: widthPct }]} />
          </View>
          <View style={s.actions}>
            <TouchableOpacity style={s.btn} onPress={() => addTime(-15)}>
              <Text style={s.btnText}>−15s</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btn} onPress={() => addTime(15)}>
              <Text style={s.btnText}>+15s</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.skipBtn]} onPress={onDismiss}>
              <Text style={[s.btnText, s.skipText]}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: { alignItems: 'center', gap: 18, paddingHorizontal: 24 },
  label: {
    color: C.text2,
    fontSize: F.sm,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  exName: { color: C.text3, fontSize: F.sm, maxWidth: 280, textAlign: 'center' },
  circle: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 3,
    borderColor: C.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdown: {
    color: C.text,
    fontSize: 56,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  targetText: { color: C.text3, fontSize: F.xs, marginTop: 2, fontVariant: ['tabular-nums'] },
  track: {
    width: 220,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.surface2,
    overflow: 'hidden',
  },
  fill: { height: 6, borderRadius: 3, backgroundColor: C.accent },
  actions: { flexDirection: 'row', gap: 12 },
  btn: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  btnText: { color: C.text, fontSize: F.sm, fontWeight: '700' },
  skipBtn: { backgroundColor: 'transparent', borderColor: C.text3 },
  skipText: { color: C.text3 },
});
