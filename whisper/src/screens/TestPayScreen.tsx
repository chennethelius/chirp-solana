import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PublicKey } from "@solana/web3.js";

import { COLORS } from "../theme";
import { Card, PopButton } from "../components/ui/PopButton";
import { useAuthorization } from "../utils/useAuthorization";
import { useMobileWallet } from "../utils/useMobileWallet";
import { useConnection } from "../utils/ConnectionProvider";
import {
  buildPaymentTx,
  confirmSignature,
  USDC_DEVNET_MINT,
} from "../services/payment";
import { PaymentIntent } from "../services/relay";
import { haptic } from "../utils/haptics";

type Stage = "idle" | "build" | "sign" | "submit" | "done" | "error";
type Token = "SOL" | "USDC";

// Dev tool: send a payment without involving the chirp protocol. Useful for
// isolating wallet/RPC issues from audio decoding issues.
export function TestPayScreen() {
  const { selectedAccount } = useAuthorization();
  const wallet = useMobileWallet();
  const { connection } = useConnection();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.001");
  const [token, setToken] = useState<Token>("SOL");
  const [stage, setStage] = useState<Stage>("idle");
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    haptic.press();
    if (!selectedAccount) {
      haptic.error();
      setError("Connect a wallet first (Settings tab).");
      setStage("error");
      return;
    }
    setError(null);
    setSignature(null);

    let recipientKey: PublicKey;
    try {
      recipientKey = new PublicKey(recipient.trim());
    } catch {
      haptic.error();
      setError("Invalid Solana address.");
      setStage("error");
      return;
    }

    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) {
      haptic.error();
      setError("Enter a valid amount.");
      setStage("error");
      return;
    }

    const div = token === "SOL" ? 1_000_000_000 : 1_000_000;
    const intent: PaymentIntent = {
      type: "intent",
      requestId: `manual-${Date.now()}`,
      recipient: recipientKey.toBase58(),
      amountMicros: BigInt(Math.round(parsed * div)).toString(),
      tokenMint: token === "SOL" ? null : USDC_DEVNET_MINT.toBase58(),
      memo: "Standalone test payment",
      createdAt: Date.now(),
    };

    try {
      setStage("build");
      const { tx, minContextSlot } = await buildPaymentTx(
        connection,
        new PublicKey(selectedAccount.publicKey.toBase58()),
        intent,
      );

      setStage("sign");
      const sig = await wallet.signAndSendTransaction(tx, minContextSlot);
      setSignature(sig);

      setStage("submit");
      const ok = await confirmSignature(connection, sig);
      if (!ok) {
        haptic.error();
        setError("Transaction failed to confirm.");
        setStage("error");
        return;
      }
      haptic.success();
      setStage("done");
    } catch (e: any) {
      haptic.error();
      setError(String(e?.message ?? e));
      setStage("error");
    }
  };

  const busy = stage === "build" || stage === "sign" || stage === "submit";

  return (
    <ScrollView
      style={{ backgroundColor: COLORS.bg }}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <Text style={styles.title}>🧪  Test Pay</Text>
        <Text style={styles.sub}>
          Send a payment without the chirp protocol. Useful for isolating
          wallet/RPC issues.
        </Text>
      </View>

      <Card>
        <Text style={styles.label}>RECIPIENT WALLET</Text>
        <TextInput
          value={recipient}
          onChangeText={setRecipient}
          placeholder="Solana address (devnet)"
          placeholderTextColor={COLORS.inkMuted}
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={COLORS.green}
          style={styles.input}
        />

        <Text style={styles.label}>AMOUNT</Text>
        <View style={styles.row}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            selectionColor={COLORS.green}
            placeholderTextColor={COLORS.inkMuted}
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
          />
          <View style={{ flexDirection: "row", gap: 6 }}>
            {(["SOL", "USDC"] as Token[]).map((t) => (
              <Pressable
                key={t}
                onPress={() => {
                  haptic.tap();
                  setToken(t);
                }}
                style={[
                  styles.chip,
                  token === t && {
                    backgroundColor: COLORS.green,
                    borderColor: COLORS.green,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    token === t && { color: "#0A0D11" },
                  ]}
                >
                  {t}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ height: 16 }} />
        <PopButton
          label={busy ? "Working…" : "Send payment"}
          onPress={send}
          disabled={busy}
        />
      </Card>

      {busy && (
        <Card>
          <View style={styles.statusRow}>
            <ActivityIndicator color={COLORS.greenBright} />
            <Text style={styles.body}>
              {stage === "build"
                ? "Building transaction…"
                : stage === "sign"
                ? "Sign in your wallet…"
                : "Submitting to Solana…"}
            </Text>
          </View>
        </Card>
      )}

      {stage === "done" && signature && (
        <Card style={{ borderColor: COLORS.green, borderWidth: 1.5 }}>
          <Text style={[styles.label, { color: COLORS.greenBright }]}>
            ✓ CONFIRMED
          </Text>
          <Text style={styles.sig} selectable>
            {signature}
          </Text>
        </Card>
      )}

      {stage === "error" && (
        <Card style={{ borderColor: COLORS.red, borderWidth: 1.5 }}>
          <Text style={[styles.label, { color: COLORS.red }]}>ERROR</Text>
          <Text style={styles.body}>{error}</Text>
        </Card>
      )}
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
    paddingTop: 6,
    gap: 6,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: COLORS.ink,
    letterSpacing: -0.4,
  },
  sub: {
    fontSize: 13,
    color: COLORS.inkSoft,
    lineHeight: 18,
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
    color: COLORS.inkMuted,
    marginBottom: 8,
    marginTop: 6,
  },
  input: {
    backgroundColor: COLORS.paperDeep,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: COLORS.paperDeep,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipText: {
    color: COLORS.inkSoft,
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.3,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  body: {
    fontSize: 14,
    color: COLORS.inkSoft,
    lineHeight: 21,
    flex: 1,
  },
  sig: {
    fontFamily: "Courier",
    fontSize: 11,
    color: COLORS.ink,
    marginTop: 8,
  },
});
