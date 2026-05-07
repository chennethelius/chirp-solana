import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { COLORS } from "../../theme";
import { haptic } from "../../utils/haptics";
import { Glass } from "./Glass";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT: Record<
  Variant,
  { bg: string; under: string; fg: string; border?: string; pressBg?: string }
> = {
  // Primary = ink-white pill, black text — Apple Pay button language.
  primary: {
    bg: COLORS.ink,
    under: "transparent",
    fg: "#0A0A0E",
  },
  secondary: {
    bg: COLORS.paperHigh,
    under: "transparent",
    fg: COLORS.ink,
    border: COLORS.borderSoft,
  },
  danger: {
    bg: COLORS.red,
    under: "transparent",
    fg: "#FFFFFF",
  },
  ghost: {
    bg: "transparent",
    under: "transparent",
    fg: COLORS.inkSoft,
  },
};

export function PopButton({
  label,
  onPress,
  variant = "primary",
  disabled,
  style,
  textStyle,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}) {
  const v = VARIANT[variant];
  const handlePress = () => {
    if (disabled) return;
    haptic.press();
    onPress();
  };
  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.wrap,
        {
          backgroundColor: v.bg,
          borderColor: v.border ?? "transparent",
          borderWidth: v.border ? 1 : 0,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !disabled ? 0.985 : 1 }],
        },
        style,
      ]}
    >
      <Text style={[styles.label, { color: v.fg }, textStyle]}>{label}</Text>
    </Pressable>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <Glass style={style}>{children}</Glass>;
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
});
