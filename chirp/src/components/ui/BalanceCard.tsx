import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS } from "../../theme";
import { Glass } from "./Glass";
import { Balance } from "../../utils/useBalance";
import { haptic } from "../../utils/haptics";
import { DISPLAY_FONT } from "../../utils/fonts";

function fmt(n: number | null, places: number): string {
  if (n === null) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

// Apple-Wallet-style balance card. Two columns of huge bone-white numerals.
// The accent is reserved for the small "live" pulse dot — that's the only
// place color appears.
export function BalanceHero({ balance }: { balance: Balance }) {
  const onTap = () => {
    haptic.tap();
    balance.refresh();
  };
  return (
    <Pressable onPress={onTap}>
      <Glass style={{ borderRadius: 22 }}>
        <View style={styles.headerRow}>
          <Text style={styles.label}>BALANCE</Text>
          <View style={styles.statusRow}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>DEVNET</Text>
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.amount}>{fmt(balance.sol, 4)}</Text>
            <Text style={styles.unit}>SOL</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.col}>
            <Text style={styles.amount}>{fmt(balance.usdc, 2)}</Text>
            <Text style={styles.unit}>USDC</Text>
          </View>
        </View>
        {balance.error && (
          <Text style={styles.err} numberOfLines={1}>
            {balance.error}
          </Text>
        )}
      </Glass>
    </Pressable>
  );
}

export function BalancePill({ balance }: { balance: Balance }) {
  return (
    <View style={styles.pill}>
      <View style={styles.pillDot} />
      <Text style={styles.pillText}>
        {fmt(balance.sol, 3)}
        <Text style={styles.pillUnit}> SOL</Text>
        <Text style={styles.pillSep}>   </Text>
        {fmt(balance.usdc, 2)}
        <Text style={styles.pillUnit}> USDC</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    color: COLORS.inkSoft,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.accent,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: COLORS.inkMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    marginTop: 18,
  },
  col: {
    flex: 1,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginHorizontal: 16,
  },
  amount: {
    fontSize: 42,
    fontWeight: "400",
    color: COLORS.ink,
    letterSpacing: -1.2,
    lineHeight: 44,
    fontFamily: DISPLAY_FONT,
  },
  unit: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.inkMuted,
    letterSpacing: 1.6,
    marginTop: 6,
  },
  err: {
    fontSize: 11,
    color: COLORS.red,
    marginTop: 10,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(21, 21, 27, 0.9)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.accent,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.ink,
    letterSpacing: 0.2,
  },
  pillUnit: {
    color: COLORS.inkMuted,
    fontWeight: "600",
    fontSize: 11,
  },
  pillSep: {
    color: COLORS.inkMuted,
  },
});
