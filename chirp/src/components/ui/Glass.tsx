import React from "react";
import { Platform, StyleSheet, View, ViewStyle } from "react-native";
import { COLORS } from "../../theme";

// Real BlurView only on iOS — Android's Dimezis blur fails to construct on
// some devices (notably Solana Mobile Seeker), spamming "Couldn't create
// view of type ExpoBlurView" and "Unknown view tag" warnings. The faux
// fallback (layered translucent panel + hairline + inset highlight) reads
// the same on a near-black canvas.
let BlurViewComponent: any = null;
if (Platform.OS === "ios") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("expo-blur");
    BlurViewComponent = mod?.BlurView ?? null;
  } catch {
    BlurViewComponent = null;
  }
}

export function Glass({
  children,
  style,
  intensity = 50,
  tint = "dark",
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  intensity?: number;
  tint?: "dark" | "light" | "default";
}) {
  const radius = (style as any)?.borderRadius ?? 22;

  const fauxFill = (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          backgroundColor: "rgba(21, 21, 27, 0.86)",
          borderRadius: radius,
        },
      ]}
    />
  );

  const innerHighlight = (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: "rgba(255, 255, 255, 0.07)",
        },
      ]}
    />
  );

  const topGleam = (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 1,
        left: 18,
        right: 18,
        height: 1,
        backgroundColor: "rgba(255, 255, 255, 0.06)",
      }}
    />
  );

  const wrap: ViewStyle = {
    overflow: "hidden",
    borderRadius: radius,
    ...style,
  };

  if (BlurViewComponent) {
    const BlurView = BlurViewComponent;
    return (
      <View style={[styles.shadow, wrap]}>
        <BlurView
          intensity={intensity}
          tint={tint}
          style={StyleSheet.absoluteFillObject}
        />
        {fauxFill}
        {topGleam}
        {innerHighlight}
        <View style={{ padding: 22 }}>{children}</View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.shadow,
        wrap,
        { backgroundColor: "rgba(21, 21, 27, 0.92)" },
      ]}
    >
      {topGleam}
      {innerHighlight}
      <View style={{ padding: 22 }}>{children}</View>
    </View>
  );
}

// Tinted variant — used for the BalanceHero. Subtle warm wash of the accent.
export function GlassTinted({
  children,
  style,
  tint = COLORS.accent,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  tint?: string;
}) {
  const radius = (style as any)?.borderRadius ?? 22;
  return (
    <View
      style={[
        styles.shadow,
        { overflow: "hidden", borderRadius: radius, ...style },
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: COLORS.paper },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: hexToRgba(tint, 0.05), borderRadius: radius },
        ]}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 1,
          left: 18,
          right: 18,
          height: 1,
          backgroundColor: "rgba(255, 255, 255, 0.07)",
        }}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            borderRadius: radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: hexToRgba(tint, 0.18),
          },
        ]}
      />
      <View style={{ padding: 22 }}>{children}</View>
    </View>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 14 },
    elevation: 5,
  },
});
