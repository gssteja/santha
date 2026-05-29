import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C, F } from '@/constants/theme';

type Props = {
  visible: boolean;
  initialSeconds?: number;
  onDismiss: () => void;
};

export function RestTimer({ visible, initialSeconds = 90, onDismiss }: Props) {
  const [remaining, setRemaining] = useState(initialSeconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setRemaining(initialSeconds);
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      intervalRef.current = setInterval(() => {
        setRemaining(r => {
          if (r <= 1) {
            clearInterval(intervalRef.current!);
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

  const addTime = (s: number) => setRemaining(r => r + s);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const display = mins > 0
    ? `${mins}:${secs.toString().padStart(2, '0')}`
    : `${secs}`;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <Animated.View style={[s.overlay, { opacity }]}>
        <View style={s.card}>
          <Text style={s.label}>Aagannu.</Text>
          <View style={s.circle}>
            <Text style={s.countdown}>{display}</Text>
          </View>
          <View style={s.actions}>
            <TouchableOpacity style={s.btn} onPress={() => addTime(15)}>
              <Text style={s.btnText}>+15s</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btn} onPress={() => addTime(30)}>
              <Text style={s.btnText}>+30s</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.skipBtn]} onPress={onDismiss}>
              <Text style={[s.btnText, s.skipText]}>Chaalu</Text>
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
  card: {
    alignItems: 'center',
    gap: 24,
  },
  label: {
    color: C.text2,
    fontSize: F.sm,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
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
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  btn: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  btnText: {
    color: C.text,
    fontSize: F.sm,
    fontWeight: '700',
  },
  skipBtn: {
    backgroundColor: 'transparent',
    borderColor: C.text3,
  },
  skipText: {
    color: C.text3,
  },
});
