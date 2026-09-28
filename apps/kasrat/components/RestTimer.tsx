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
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, FONT, HEAT, heatForFraction } from '@/constants/theme';
import { haptics } from '@/components/ui/haptics';

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

// Science-backed rest durations (Schoenfeld et al. 2016, Grgic et al. meta-analysis):
// longer rests benefit both strength and hypertrophy; scale with exercise demand.
export function restForExercise(name: string, _muscle?: string): number {
  // Strip program parentheticals like "(heavy wk: 4×4 @80%…)" before matching
  const n = name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

  // 3 min — heavy barbell compounds: CNS + ATP recovery critical for next set quality
  if (/(squat|deadlift|bench press|incline press|overhead press|barbell overhead|barbell row)/.test(n)) return 180;

  // 2.5 min — moderate / bodyweight compounds: demanding but less systemically taxing
  if (/(pull.?up|weighted dip|\bdip\b|romanian deadlift|hip thrust|bulgarian|hack squat)/.test(n)) return 150;

  // 2 min — machine compounds, unilateral pressing, moderate back work
  if (/(lat pulldown|seated cable row|cable row|chest.supported row|kroc row|leg press(?! calf)|larsen press|incline dumbbell press|arnold press|shoulder press)/.test(n)) return 120;

  // 90s — heavier isolation or demanding bodyweight finishers
  if (/(upright row|lying leg curl|unilateral lat|push.?up)/.test(n)) return 90;

  // 60s — standard isolation: curls, raises, flyes, pressdowns, core
  if (/(curl|lateral raise|y.raise|front raise|fl[iy]|pushdown|pressdown|extension|crunch|leg raise|face pull|shrug|calf raise|glute bridge|plank|ab rollout|hanging leg|cable overhead|rope face)/.test(n)) return 60;

  return 90;
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
          title: 'Rested',
          body: 'Hot — next set.',
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
      haptics.done();
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

  // The ember cools as you rest: hot at the start of the set, dull as time burns down.
  const frac = target > 0 ? remaining / target : 0;
  const ember = heatForFraction(frac);

  return (
    <Animated.View style={[s.bar, { opacity }]} pointerEvents="box-none">
      <View style={s.row}>
        <View style={s.left}>
          <Text style={[s.label, { color: ember }]}>COOLING</Text>
          {exerciseName ? (
            <Text style={s.exName} numberOfLines={1}>{exerciseName}</Text>
          ) : null}
        </View>
        <Text style={[s.countdown, { color: ember }]}>{fmt(remaining)}</Text>
        <View style={s.actions}>
          <TouchableOpacity style={s.btn} onPress={() => addTime(-15)} accessibilityLabel="Subtract 15 seconds">
            <Text style={s.btnText}>−15</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btn} onPress={() => addTime(15)} accessibilityLabel="Add 15 seconds">
            <Text style={s.btnText}>+15</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.btn, s.skipBtn]} onPress={handleSkip} accessibilityLabel="Skip rest">
            <Text style={[s.btnText, s.skipText]}>Skip</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={s.track}>
        <Animated.View style={[s.fill, { width: widthPct, shadowColor: ember }]}>
          <LinearGradient
            colors={[ember + '66', ember] as const}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.fillGrad}
          />
        </Animated.View>
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
    fontFamily: FONT.black,
    letterSpacing: 2.5,
  },
  exName: { color: C.text3, fontSize: F.xs, fontFamily: FONT.medium, marginTop: 1 },
  countdown: {
    color: C.text,
    fontSize: F.xxl,
    fontFamily: FONT.black,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
    minWidth: 64,
    textAlign: 'right',
  },
  actions: { flexDirection: 'row', gap: 6 },
  btn: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  btnText: { color: C.text, fontSize: F.xs, fontFamily: FONT.bold },
  skipBtn: { backgroundColor: 'transparent', borderColor: C.text3 },
  skipText: { color: C.text3 },
  track: {
    height: 4,
    backgroundColor: C.surface2,
    marginTop: 8,
    marginHorizontal: -14,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  fillGrad: { flex: 1 },
});
