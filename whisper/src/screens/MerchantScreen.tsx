import React from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { COLORS } from "../theme";
import { BirdLogo } from "../components/ui/BirdLogo";
import { Card, PopButton } from "../components/ui/PopButton";
import { haptic } from "../utils/haptics";

const TERMINAL_URL = "https://localhost:3000";

export function MerchantScreen() {
  return (
    <ScrollView
      style={{ backgroundColor: COLORS.bg }}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <BirdLogo size={88} bg={COLORS.ink} glow={false} />
        <Text style={styles.title}>Merchant terminal</Text>
        <Text style={styles.sub}>
          Chirp's terminal lives on the web — same way Square and Toast do
          it. Open it on a laptop or tablet by the register.
        </Text>
      </View>

      <Card>
        <Text style={styles.section}>HOW TO RUN A SHOP</Text>
        <Step
          n={1}
          icon="💻"
          title="Open the web terminal"
          body="On a laptop or tablet on the same wifi as this phone, navigate to your local Chirp terminal."
        />
        <Step
          n={2}
          icon="📡"
          title="Build menu and broadcast"
          body="Add items + prices, hit broadcast, and the terminal chirps the menu over ultrasonic audio every 5 seconds."
        />
        <Step
          n={3}
          icon="🎧"
          title="Customers tap to pay"
          body="Their phone (running the Chirp Customer tab) picks up the chirp, shows the menu, and signs payments straight to your wallet."
        />
        <View style={{ height: 14 }} />
        <PopButton
          label="Open terminal in browser"
          onPress={() => {
            haptic.tap();
            Linking.openURL(TERMINAL_URL);
          }}
        />
      </Card>

      <Card>
        <Text style={styles.section}>WHY ON THE WEB?</Text>
        <Text style={styles.body}>
          Web speakers reach further than phone speakers, the cashier already
          has a screen at the register, and customers don't need to be looking
          at the right device — they just need to be in earshot.
        </Text>
      </Card>
    </ScrollView>
  );
}

function Step({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepBadgeText}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>
          {icon}  {title}
        </Text>
        <Text style={styles.stepBody}>{body}</Text>
      </View>
    </View>
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
    paddingTop: 8,
    gap: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: COLORS.ink,
    letterSpacing: -0.4,
  },
  sub: {
    fontSize: 14,
    color: COLORS.inkSoft,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  section: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
    color: COLORS.inkMuted,
    marginBottom: 12,
  },
  body: {
    fontSize: 14,
    color: COLORS.inkSoft,
    lineHeight: 21,
  },
  step: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingVertical: 8,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.greenSoft,
    borderWidth: 1.5,
    borderColor: COLORS.green,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBadgeText: {
    color: COLORS.greenBright,
    fontWeight: "900",
    fontSize: 13,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.ink,
  },
  stepBody: {
    fontSize: 13,
    color: COLORS.inkSoft,
    marginTop: 4,
    lineHeight: 19,
  },
});
