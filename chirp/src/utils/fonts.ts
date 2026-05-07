import { Platform } from "react-native";

// Editorial display font — uses iOS's New York (a Charter-style serif) and
// Android's bundled serif (Noto Serif). No expo-font registration needed
// since these come from the OS itself.
export const DISPLAY_FONT = Platform.select({
  ios: "New York",
  android: "serif",
  default: "serif",
});

// Tight UI sans — the system default on each platform. Apple uses SF Pro,
// Android uses Roboto. Both produce Apple-like results when paired with
// careful weight + letter-spacing.
export const SANS_FONT = Platform.select({
  ios: "System",
  android: undefined, // RN default
  default: undefined,
});

// Mono — used for the verify code, mono numerals, signatures.
export const MONO_FONT = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});
