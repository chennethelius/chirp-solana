import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { COLORS } from "../theme";
import { BirdLogo } from "../components/ui/BirdLogo";
import { Card, PopButton } from "../components/ui/PopButton";
import { useAuthorization } from "../utils/useAuthorization";
import { useMobileWallet } from "../utils/useMobileWallet";
import { alertAndLog } from "../utils/alertAndLog";
import { ellipsify } from "../utils/ellipsify";
import { haptic } from "../utils/haptics";
import { useBalance } from "../utils/useBalance";
import { BalanceHero } from "../components/ui/BalanceCard";
import { DISPLAY_FONT } from "../utils/fonts";

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const { selectedAccount } = useAuthorization();
  const { connect, disconnect } = useMobileWallet();
  const balance = useBalance();
  const [busy, setBusy] = useState(false);

  const handleConnect = async () => {
    if (busy) return;
    haptic.press();
    setBusy(true);
    try {
      await connect();
      haptic.success();
    } catch (err: any) {
      haptic.error();
      alertAndLog("Couldn't connect", err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    haptic.tap();
    setBusy(true);
    try {
      await disconnect();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: COLORS.bg }}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <Hero connected={Boolean(selectedAccount)} />

      {!selectedAccount ? (
        <Card>
          <Text style={styles.cardTitle}>Welcome.</Text>
          <Text style={styles.cardBody}>
            Connect a wallet to send and receive payments by sound.
          </Text>
          <View style={{ height: 22 }} />
          <PopButton
            label={busy ? "Opening Phantom…" : "Connect Phantom"}
            onPress={handleConnect}
            disabled={busy}
          />
        </Card>
      ) : (
        <>
          <BalanceHero balance={balance} />
          <Card>
            <Text style={styles.eyebrow}>WALLET</Text>
            <Text style={styles.walletAddr}>
              {ellipsify(selectedAccount.publicKey.toBase58())}
            </Text>
            <View style={{ height: 18 }} />
            <PopButton
              label="Listen for a payment"
              onPress={() => {
                haptic.tap();
                navigation.navigate("Pay");
              }}
            />
            <View style={{ height: 6 }} />
            <PopButton
              label="Disconnect"
              variant="ghost"
              onPress={handleDisconnect}
            />
          </Card>
        </>
      )}

      <View style={{ height: 32 }} />
      <Text style={styles.footer}>Chirp · pay by sound</Text>
    </ScrollView>
  );
}

function Hero({ connected }: { connected: boolean }) {
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [float]);
  const ty = float.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  return (
    <View style={styles.hero}>
      <Animated.View style={{ transform: [{ translateY: ty }] }}>
        <BirdLogo size={88} bg={COLORS.ink} glow={connected} />
      </Animated.View>
      <Text style={styles.title}>Chirp</Text>
      <Text style={styles.subtitle}>Pay by sound. No NFC. No QR.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 60,
    gap: 16,
  },
  hero: {
    alignItems: "center",
    paddingTop: 22,
    paddingBottom: 14,
    gap: 18,
  },
  title: {
    fontSize: 56,
    fontWeight: "400",
    letterSpacing: -1.4,
    color: COLORS.ink,
    fontFamily: DISPLAY_FONT,
    lineHeight: 60,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: "400",
    color: COLORS.inkSoft,
    textAlign: "center",
    letterSpacing: -0.1,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.6,
    color: COLORS.inkMuted,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.ink,
    letterSpacing: -0.6,
  },
  cardBody: {
    fontSize: 15,
    color: COLORS.inkSoft,
    marginTop: 10,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  walletAddr: {
    fontSize: 18,
    fontWeight: "500",
    color: COLORS.ink,
    fontFamily: "Courier",
    letterSpacing: 0.4,
  },
  footer: {
    fontSize: 11,
    color: COLORS.inkMuted,
    textAlign: "center",
    fontWeight: "500",
    letterSpacing: 1.2,
  },
});
