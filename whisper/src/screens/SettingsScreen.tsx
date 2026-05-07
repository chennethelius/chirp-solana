import React from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { COLORS } from "../theme";
import { Card, PopButton } from "../components/ui/PopButton";
import { BirdLogo } from "../components/ui/BirdLogo";
import { useAuthorization } from "../utils/useAuthorization";
import { useMobileWallet } from "../utils/useMobileWallet";
import {
  useCluster,
  ClusterNetwork,
} from "../components/cluster/cluster-data-access";
import { ellipsify } from "../utils/ellipsify";
import { haptic } from "../utils/haptics";
import { useBalance } from "../utils/useBalance";
import { BalanceHero } from "../components/ui/BalanceCard";

export function SettingsScreen() {
  const { selectedAccount } = useAuthorization();
  const { connect, disconnect } = useMobileWallet();
  const { selectedCluster, clusters, setSelectedCluster, getExplorerUrl } =
    useCluster();
  const balance = useBalance();

  const copyAddress = async () => {
    if (!selectedAccount) return;
    haptic.tap();
    await Clipboard.setStringAsync(selectedAccount.publicKey.toBase58());
  };

  const openExplorer = () => {
    if (!selectedAccount) return;
    haptic.tap();
    Linking.openURL(
      getExplorerUrl(`account/${selectedAccount.publicKey.toBase58()}`),
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor: COLORS.bg }}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <BirdLogo size={68} bg={COLORS.ink} glow={false} />
        <Text style={styles.title}>Settings</Text>
      </View>

      {selectedAccount && <BalanceHero balance={balance} />}

      <Card>
        <Text style={styles.section}>WALLET</Text>
        {selectedAccount ? (
          <>
            <View style={styles.connectedRow}>
              <View style={styles.dot} />
              <Text style={styles.connectedLabel}>Connected</Text>
            </View>
            <Text style={styles.address}>
              {ellipsify(selectedAccount.publicKey.toBase58())}
            </Text>
            <View style={{ height: 14 }} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <PopButton
                label="Copy"
                variant="secondary"
                onPress={copyAddress}
                style={{ flex: 1 }}
              />
              <PopButton
                label="Explorer"
                variant="secondary"
                onPress={openExplorer}
                style={{ flex: 1 }}
              />
            </View>
            <View style={{ height: 10 }} />
            <PopButton
              label="Disconnect"
              variant="danger"
              onPress={() => {
                haptic.warn();
                disconnect();
              }}
            />
          </>
        ) : (
          <>
            <Text style={styles.body}>
              Connect a Solana wallet to sign payments. Chirp never holds
              funds — they go straight from your wallet to merchants.
            </Text>
            <View style={{ height: 14 }} />
            <PopButton
              label="👻  Connect with Phantom"
              onPress={() => {
                haptic.press();
                connect();
              }}
            />
          </>
        )}
      </Card>

      <Card>
        <Text style={styles.section}>NETWORK</Text>
        {clusters.map((c) => {
          const active = c.network === selectedCluster.network;
          return (
            <Pressable
              key={c.network}
              onPress={() => {
                haptic.tap();
                setSelectedCluster(c);
              }}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: COLORS.paperHigh },
              ]}
            >
              <View
                style={[
                  styles.radio,
                  active && {
                    borderColor: COLORS.green,
                    backgroundColor: COLORS.greenSoft,
                  },
                ]}
              >
                {active && <View style={styles.radioInner} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {c.network === ClusterNetwork.Devnet ? "Devnet" : "Testnet"}
                </Text>
                <Text style={styles.rowSub}>{c.endpoint}</Text>
              </View>
            </Pressable>
          );
        })}
      </Card>

      <Card>
        <Text style={styles.section}>ABOUT</Text>
        <Text style={styles.body}>
          Chirp · pay anyone in earshot. Built for the Easy A "dApp Store"
          hackathon. Solana Mobile Seeker + ultrasonic FSK chirps + Mobile
          Wallet Adapter.
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 22,
    gap: 18,
    paddingBottom: 50,
  },
  hero: {
    alignItems: "center",
    gap: 10,
    paddingTop: 8,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: COLORS.ink,
    letterSpacing: -0.6,
  },
  section: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
    color: COLORS.inkMuted,
    marginBottom: 12,
  },
  connectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.green,
    shadowColor: COLORS.green,
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  connectedLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.green,
    letterSpacing: 1.5,
  },
  address: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.ink,
    fontFamily: "Courier",
    marginTop: 6,
    letterSpacing: 0.3,
  },
  body: {
    fontSize: 14,
    color: COLORS.inkSoft,
    lineHeight: 21,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 14,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.borderSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.green,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.ink,
  },
  rowSub: {
    fontSize: 12,
    color: COLORS.inkMuted,
    marginTop: 2,
    fontFamily: "Courier",
  },
});
