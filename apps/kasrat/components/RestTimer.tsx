import * as Notifications from 'expo-notifications';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { C, F } from '@/constants/theme';

// Play the rest-end sound when foregrounded but suppress the banner — the inline
// timer strip already shows progress, so a popup on top of it would be redundant.
// Sound rides the Android channel + iOS sound:'default' from the scheduled notif.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: false,
  }),
});

const REST_CHANNEL = 'rest-timer';
// Fixed identifier so a new schedule replaces the prior one in the system tray
// (both pending and any already-delivered banner share the same slot).
const REST_NOTIF_ID = 'rest-timer-end';

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
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `0:${s.toString().padStart(2, '0')}`;
}

export function RestTimer({ visible, seconds, exerciseName, onDismiss }: Props) {
  const [remaining, setRemaining] = useState(seconds);
  const [target, setTarget] = useState(seconds);
  // Absolute wall-clock end time. Driving off this (not a decrementing counter) keeps
  // the timer accurate across app backgrounding / screen-off, where JS timers throttle.
  const endAtRef = useRef(0);
  const targetRef = useRef(seconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedRef = useRef(false); // true once the timer naturally completed (let the ding stand)
  const opacity = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(1)).current; // 1 → 0

  // One-time: notification permission + Android channel (HIGH importance so it sounds).
  useEffect(() => {
    (async () => {
      try {
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowSound: true, allowBadge: false },
        } as any);
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync(REST_CHANNEL, {
            name: 'Rest timer',
            importance: Notifications.AndroidImportance.HIGH,
            sound: 'default',
            vibrationPattern: [0, 250, 150, 250],
            enableVibrate: true,
          });
        }
      } catch {}
    })();
  }, []);

  async function clearDing() {
    // Clear both pending (not yet fired) and delivered (already in tray) under our fixed id.
    try { await Notifications.cancelScheduledNotificationAsync(REST_NOTIF_ID); } catch {}
    try { await Notifications.dismissNotificationAsync(REST_NOTIF_ID); } catch {}
  }

  // Schedule the rest-end ding at `secs` from now (OS fires it even backgrounded/locked).
  // Uses a fixed identifier so a re-schedule replaces any prior banner instead of stacking.
  async function scheduleDing(secs: number) {
    await clearDing();
    if (secs <= 0) return;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: REST_NOTIF_ID,
        content: {
          title: 'Rest done',
          body: 'Time for your next set.',
          sound: 'default',
          // iOS: bypass Focus, ring even in silent (Time Sensitive entitlement).
          interruptionLevel: 'timeSensitive',
        } as any,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: secs,
          channelId: REST_CHANNEL,
        },
      });
    } catch {}
  }

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
      firedRef.current = true; // completed naturally — let the scheduled ding stand
      Vibration.vibrate(400);
      onDismiss();
    }
  }

  useEffect(() => {
    if (visible) {
      endAtRef.current = Date.now() + seconds * 1000;
      targetRef.current = seconds;
      firedRef.current = false;
      setTarget(seconds);
      setRemaining(seconds);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      runProgress(seconds, seconds);
      scheduleDing(seconds);
      intervalRef.current = setInterval(tick, 250);
    } else {
      Animated.timing(opacity, { toValue: 0, duration: 120, useNativeDriver: true }).start();
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      // Cancel any pending/delivered ding unless the timer actually completed (let ding stand).
      if (!firedRef.current) clearDing();
    };
  }, [visible, seconds]);

  // Re-sync when the app returns to foreground (timer is wall-clock based, but the bar/text need a nudge).
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
    scheduleDing(next); // move the ding to the new end time
  }

  function handleSkip() {
    clearDing();
    onDismiss();
  }

  const widthPct = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  if (!visible) return null;

  return (
    <Animated.View style={[s.bar, { opacity }]} pointerEvents="box-none">
      <View style={s.row}>
        <View style={s.left}>
          <Text style={s.label}>REST</Text>
          {exerciseName ? (
            <Text style={s.exName} numberOfLines={1}>{exerciseName}</Text>
          ) : null}
        </View>
        <Text style={s.countdown}>{fmt(remaining)}</Text>
        <View style={s.actions}>
          <TouchableOpacity style={s.btn} onPress={() => addTime(-15)}>
            <Text style={s.btnText}>−15</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btn} onPress={() => addTime(15)}>
            <Text style={s.btnText}>+15</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.btn, s.skipBtn]} onPress={handleSkip}>
            <Text style={[s.btnText, s.skipText]}>Skip</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={s.track}>
        <Animated.View style={[s.fill, { width: widthPct }]} />
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bar: {
    backgroundColor: C.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 0,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  left: { flex: 1, minWidth: 0 },
  label: {
    color: C.accent,
    fontSize: F.xs,
    fontWeight: '800',
    letterSpacing: 2,
  },
  exName: { color: C.text3, fontSize: F.xs, marginTop: 1 },
  countdown: {
    color: C.text,
    fontSize: F.xl,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    minWidth: 56,
    textAlign: 'right',
  },
  actions: { flexDirection: 'row', gap: 6 },
  btn: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 9,
  },
  btnText: { color: C.text, fontSize: F.xs, fontWeight: '700' },
  skipBtn: { backgroundColor: 'transparent', borderColor: C.text3 },
  skipText: { color: C.text3 },
  track: {
    height: 3,
    backgroundColor: C.surface2,
    marginTop: 8,
    marginHorizontal: -14,
    overflow: 'hidden',
  },
  fill: { height: 3, backgroundColor: C.accent },
});
