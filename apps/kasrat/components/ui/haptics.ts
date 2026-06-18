// Defensive haptics wrapper — never throws if the native module is unavailable,
// so the logging flow is safe even if expo-haptics fails to link.
import * as Haptics from 'expo-haptics';

const safe = (fn: () => Promise<unknown>) => {
  try {
    fn().catch(() => {});
  } catch {
    /* no-op */
  }
};

export const haptics = {
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  press: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  thud: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  done: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  pr: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warn: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
