import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { COLORS } from "../../theme";

// A single bone-white disc. The bird is the silhouette; the disc is the
// product. Glow is reserved for the "live" state — a faint warm halo that
// signals the mic is on, never a full color fill.
export function BirdLogo({
  size = 96,
  bg = COLORS.ink,
  glow = false,
}: {
  size?: number;
  bg?: string;
  glow?: boolean;
}) {
  return (
    <View
      style={[
        styles.disc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          shadowColor: glow ? COLORS.accent : "#000",
          shadowOpacity: glow ? 0.6 : 0.4,
          shadowRadius: glow ? size * 0.5 : 14,
          shadowOffset: { width: 0, height: glow ? 0 : 6 },
        },
      ]}
    >
      <Text style={{ fontSize: size * 0.6, color: "#0A0A0E" }}>🐦</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
  },
});
