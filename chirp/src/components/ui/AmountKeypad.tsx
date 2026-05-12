import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { COLORS } from "../../theme";
import { DISPLAY_FONT } from "../../utils/fonts";
import { haptic } from "../../utils/haptics";
import { PopButton } from "./PopButton";

type Token = "USDC" | "SOL";

const QUICK_USDC = [1, 5, 10, 20];
const QUICK_SOL = [0.05, 0.1, 0.5, 1];

const KEYS: ReadonlyArray<ReadonlyArray<string>> = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "⌫"],
];

/**
 * Cash-App-style amount entry. Big auto-shrinking number, on-screen keypad
 * (no OS keyboard), quick-amount chips. Used when the customer wants to pay
 * a custom amount — tip jar or open terminal with no menu match.
 *
 * Owns no state internally; parent controls `value` (a decimal string like
 * "12.50") and `token`. Backspace removes one character; long-press to clear
 * is intentionally NOT wired up because react-native Pressables don't reliably
 * fire long-press at the responsiveness this UI demands.
 */
export function AmountKeypad({
  value,
  token,
  acceptedTokens,
  onChange,
  onTokenChange,
  onSubmit,
  onCancel,
  submitLabel = "Continue  →",
  title = "Enter amount",
  subtitle,
}: {
  value: string;
  token: Token;
  acceptedTokens: Token[];
  onChange: (v: string) => void;
  onTokenChange: (t: Token) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel?: string;
  title?: string;
  subtitle?: string;
}) {
  const numeric = parseFloat(value || "0");
  const valid = numeric > 0 && Number.isFinite(numeric);

  const display = useMemo(() => {
    if (!value || value === "0") return "0";
    return value;
  }, [value]);

  // Auto-shrink the display font as the number gets longer so it always fits.
  const fontSize = useMemo(() => {
    const len = display.length;
    if (len <= 4) return 88;
    if (len <= 6) return 72;
    if (len <= 8) return 56;
    return 44;
  }, [display.length]);

  const tap = (k: string) => {
    haptic.tap();
    if (k === "⌫") {
      if (value.length <= 1) {
        onChange("0");
        return;
      }
      const next = value.slice(0, -1);
      onChange(next === "" ? "0" : next);
      return;
    }
    if (k === ".") {
      if (value.includes(".")) return;
      onChange(value === "0" ? "0." : value + ".");
      return;
    }
    // Numeric key.
    if (value === "0") {
      onChange(k);
      return;
    }
    // Cap to two decimals.
    const dotIdx = value.indexOf(".");
    if (dotIdx >= 0 && value.length - dotIdx > 2) return;
    onChange(value + k);
  };

  const setQuick = (n: number) => {
    haptic.tap();
    onChange(n.toFixed(token === "SOL" ? 2 : 0).replace(/\.00$/, ""));
  };

  const quick = token === "USDC" ? QUICK_USDC : QUICK_SOL;
  const showTokenSwitch = acceptedTokens.length > 1;

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      {/* Amount display */}
      <View style={styles.amountRow}>
        <Text
          style={[styles.amount, { fontSize, lineHeight: fontSize * 1.08 }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {display}
        </Text>
        <Text style={styles.tokenLabel}>{token}</Text>
      </View>

      {/* Quick chips */}
      <View style={styles.quickRow}>
        {quick.map((n) => (
          <Pressable
            key={n}
            onPress={() => setQuick(n)}
            style={({ pressed }) => [
              styles.quickChip,
              pressed && styles.quickChipPressed,
            ]}
          >
            <Text style={styles.quickChipText}>
              {token === "SOL" ? n.toString() : `$${n}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Token switch (only when there's actually a choice) */}
      {showTokenSwitch && (
        <View style={styles.tokenSwitch}>
          {acceptedTokens.map((t) => (
            <Pressable
              key={t}
              onPress={() => {
                haptic.tap();
                onTokenChange(t);
              }}
              style={[
                styles.tokenSwitchChip,
                token === t && styles.tokenSwitchChipActive,
              ]}
            >
              <Text
                style={[
                  styles.tokenSwitchText,
                  token === t && styles.tokenSwitchTextActive,
                ]}
              >
                {t}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Keypad */}
      <View style={styles.keypad}>
        {KEYS.map((row, r) => (
          <View key={r} style={styles.keypadRow}>
            {row.map((k) => (
              <Pressable
                key={k}
                onPress={() => tap(k)}
                style={({ pressed }) => [
                  styles.key,
                  pressed && styles.keyPressed,
                ]}
              >
                <Text
                  style={[
                    styles.keyText,
                    k === "⌫" && styles.keyTextBackspace,
                  ]}
                >
                  {k}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      {/* CTA */}
      <View style={styles.cta}>
        <PopButton
          label={submitLabel}
          onPress={onSubmit}
          disabled={!valid}
        />
        <View style={{ height: 6 }} />
        <PopButton label="Cancel" variant="ghost" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingTop: 8,
    paddingBottom: 24,
    gap: 14,
  },
  header: {
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.6,
    color: COLORS.inkMuted,
    textTransform: "uppercase",
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.inkSoft,
    letterSpacing: -0.1,
    textAlign: "center",
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 18,
  },
  amount: {
    fontFamily: DISPLAY_FONT,
    color: COLORS.ink,
    fontWeight: "400",
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  tokenLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.inkSoft,
    letterSpacing: 1.4,
  },
  quickRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  quickChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.paperDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  quickChipPressed: {
    backgroundColor: COLORS.paperHigh,
    transform: [{ scale: 0.97 }],
  },
  quickChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.inkSoft,
    letterSpacing: -0.1,
    fontVariant: ["tabular-nums"],
  },
  tokenSwitch: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
  },
  tokenSwitchChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.paperDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  tokenSwitchChipActive: {
    backgroundColor: COLORS.ink,
    borderColor: COLORS.ink,
  },
  tokenSwitchText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.inkSoft,
    letterSpacing: 0.6,
  },
  tokenSwitchTextActive: {
    color: "#0A0A0E",
  },
  keypad: {
    marginTop: 6,
    gap: 8,
  },
  keypadRow: {
    flexDirection: "row",
    gap: 8,
  },
  key: {
    flex: 1,
    height: 64,
    borderRadius: 14,
    backgroundColor: COLORS.paperDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  keyPressed: {
    backgroundColor: COLORS.paperHigh,
    transform: [{ scale: 0.97 }],
  },
  keyText: {
    fontSize: 26,
    fontWeight: "500",
    color: COLORS.ink,
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums"],
  },
  keyTextBackspace: {
    fontSize: 22,
    color: COLORS.inkSoft,
  },
  cta: {
    marginTop: 10,
  },
});
