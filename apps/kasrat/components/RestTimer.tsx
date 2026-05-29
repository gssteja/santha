import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
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
  // Absolute wall-clock end time. Driving off this (not a decrementing counter) keeps
  // the timer accurate across app backgrounding / screen-off, where JS timers throttle.
  const endAtRef = useRef(0);
  const targetRef = useRef(seconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(1)).current; // 1 → 0

  function runProgress(from: number, total: number) {
    progress.setValue(total > 0 ? from / total : 0);
    Animated.timing(progress, {
      toValue: 0,
      duration: Math.max(0, from) * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }

  function secsLeft(): number {
    return Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
  }

  function tick() {
    const left = secsLeft();
    setRemaining(left);
    if (left <= 0) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      Vibration.vibrate(400);
      onDismiss();
    }
  }

  useEffect(() => {
    if (visible) {
      endAtRef.current = Date.now() + seconds * 1000;
      targetRef.current = seconds;
      setTarget(seconds);
      setRemaining(seconds);
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      runProgress(seconds, seconds);
      intervalRef.current = setInterval(tick, 250);
    } else {
      Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible, seconds]);

  // Re-sync the moment the app returns to foreground (catches the count up to wall clock,
  // re-runs the bar from the corrected position, and fires completion if it elapsed away).
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && visible) {
        runProgress(secsLeft(), targetRef.current);
        tick();
      }
    });
    return () => sub.remove();
  }, [visible]);

  function addTime(s: number) {
    endAtRef.current += s * 1000;
    const next = secsLeft();
    const total = Math.max(next, targetRef.current);
    targetRef.current = total;
    setTarget(total);
    setRemaining(next);
    runProgress(next, total);
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
