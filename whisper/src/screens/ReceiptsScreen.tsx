import React from "react";
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { COLORS } from "../theme";
import { Card, PopButton } from "../components/ui/PopButton";
import { useCluster } from "../components/cluster/cluster-data-access";
import { useReceipts, Receipt } from "../utils/receipts";
import { haptic } from "../utils/haptics";
import { DISPLAY_FONT } from "../utils/fonts";

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ReceiptsScreen() {
  const { receipts, loading, refresh, clear } = useReceipts();
  const { getExplorerUrl } = useCluster();

  const onClear = () => {
    haptic.warn();
    Alert.alert(
      "Clear receipt history?",
      "This only removes the on-device record. The transactions are still on Solana.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => clear(),
        },
      ],
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor: COLORS.bg }}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={refresh}
          tintColor={COLORS.accent}
        />
      }
    >
      <View style={styles.hero}>
        <Text style={styles.title}>Receipts</Text>
        <Text style={styles.sub}>
          {receipts.length === 0
            ? "Every payment you sign with Chirp lives here."
            : `${receipts.length} ${receipts.length === 1 ? "payment" : "payments"} on this device.`}
        </Text>
      </View>

      {receipts.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>No receipts yet</Text>
          <Text style={styles.emptyBody}>
            Make your first payment from the Pay tab and it will show up here
            with a one-tap link to its proof on Solana Explorer.
          </Text>
        </Card>
      ) : (
        receipts.map((r) => (
          <ReceiptRow
            key={r.signature}
            r={r}
            onPress={() => {
              haptic.tap();
              Linking.openURL(
                getExplorerUrl(`tx/${r.signature}`),
              ).catch(() => {});
            }}
          />
        ))
      )}

      {receipts.length > 0 && (
        <>
          <View style={{ height: 8 }} />
          <PopButton label="Clear history" variant="ghost" onPress={onClear} />
        </>
      )}
    </ScrollView>
  );
}

function ReceiptRow({ r, onPress }: { r: Receipt; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [pressed && { opacity: 0.85 }]}
    >
      <Card>
        <View style={styles.rowTop}>
          <Text style={styles.emoji}>{r.itemEmoji ?? "💸"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName} numberOfLines={1}>
              {r.itemName ?? "Payment"}
            </Text>
            <Text style={styles.merchant} numberOfLines={1}>
              {r.merchantName ?? "Merchant"}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.amount}>{r.amount}</Text>
            <Text style={styles.time}>{relTime(r.ts)}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.linkRow}>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.proofLabel}>SOLANA · {r.cluster.toUpperCase()}</Text>
            <Text style={styles.sig} numberOfLines={1}>
              {r.signature.slice(0, 14)}…{r.signature.slice(-8)}
            </Text>
          </View>
          <Text style={styles.arrow}>↗</Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 60,
    gap: 14,
  },
  hero: {
    paddingTop: 6,
    paddingBottom: 4,
    gap: 6,
  },
  title: {
    fontSize: 38,
    fontWeight: "400",
    color: COLORS.ink,
    letterSpacing: -1.2,
    fontFamily: DISPLAY_FONT,
    lineHeight: 42,
  },
  sub: {
    fontSize: 14,
    color: COLORS.inkSoft,
    letterSpacing: -0.1,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.ink,
    letterSpacing: -0.4,
  },
  emptyBody: {
    fontSize: 14,
    color: COLORS.inkSoft,
    marginTop: 8,
    lineHeight: 21,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  emoji: {
    fontSize: 30,
    width: 38,
    textAlign: "center",
  },
  itemName: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.ink,
    letterSpacing: -0.2,
  },
  merchant: {
    fontSize: 12,
    color: COLORS.inkSoft,
    marginTop: 2,
  },
  amount: {
    fontSize: 22,
    color: COLORS.ink,
    fontFamily: DISPLAY_FONT,
    letterSpacing: -0.6,
  },
  time: {
    fontSize: 11,
    color: COLORS.inkMuted,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginVertical: 14,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  proofLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: COLORS.accent,
    letterSpacing: 1.6,
    marginBottom: 4,
  },
  sig: {
    fontSize: 12,
    color: COLORS.inkSoft,
    fontFamily: "Courier",
  },
  arrow: {
    fontSize: 16,
    color: COLORS.accent,
    fontWeight: "700",
  },
});
