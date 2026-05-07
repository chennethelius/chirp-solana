import { Vibration } from "react-native";

// Lightweight haptic feedback using RN's built-in Vibration API.
// No native module install needed (avoids an EAS rebuild). Durations are
// tuned to feel like an iOS UIImpactFeedbackGenerator — short crisp ticks
// for taps, a longer pulse for payment confirmation.
export const haptic = {
  tap: () => Vibration.vibrate(8),
  press: () => Vibration.vibrate(12),
  success: () => Vibration.vibrate([0, 18, 60, 30]),
  warn: () => Vibration.vibrate([0, 30, 80, 30]),
  error: () => Vibration.vibrate([0, 40, 60, 80]),
};
