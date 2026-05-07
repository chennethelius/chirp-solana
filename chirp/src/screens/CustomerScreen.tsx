import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PublicKey } from "@solana/web3.js";

import { COLORS } from "../theme";
import { BirdLogo } from "../components/ui/BirdLogo";
import { Card, PopButton } from "../components/ui/PopButton";
import { useAuthorization } from "../utils/useAuthorization";
import { useMobileWallet } from "../utils/useMobileWallet";
import { useConnection } from "../utils/ConnectionProvider";
import { useCluster } from "../components/cluster/cluster-data-access";
import { getChirpChannel } from "../services/chirpProvider";
import {
  AudioChirpChannel,
  ChirpDebugEvent,
} from "../services/audio/audioChirpChannel";
import { newRequestId } from "../services/chirp";
import {
  Lookup,
  MenuItem,
  PaymentIntent,
  RelayClient,
  Session,
} from "../services/relay";
import {
  buildPaymentTx,
  confirmSignature,
  formatAmount,
  USDC_DEVNET_MINT,
} from "../services/payment";
import { CHIRP_CONFIG } from "../config";
import { haptic } from "../utils/haptics";
import { useBalance } from "../utils/useBalance";
import { BalancePill } from "../components/ui/BalanceCard";
import { DISPLAY_FONT } from "../utils/fonts";
import { recordReceipt } from "../utils/receipts";

type Token = "USDC" | "SOL";

type IncomingFlow = { kind: "menu"; session: Session };
type ReviewFlow = {
  kind: "review";
  intent: PaymentIntent;
  sessionCode?: string;
  pickedItem?: MenuItem;
};
type ChirpingFlow = { kind: "chirping" };
type SigningFlow = { kind: "signing" };
type SubmittingFlow = { kind: "submitting" };
type ConfirmedFlow = { kind: "confirmed"; signature: string; amount: string };
type ErrorFlow = { kind: "error"; message: string };

type Status =
  | { kind: "idle" }
  | IncomingFlow
  | ReviewFlow
  | ChirpingFlow
  | SigningFlow
  | SubmittingFlow
  | ConfirmedFlow
  | ErrorFlow;

const SEEN_TTL_MS = 30_000;

function microsToDisplay(micros: string, token: Token): string {
  const n = Number(BigInt(micros));
  const div = token === "USDC" ? 1_000_000 : 1_000_000_000;
  return (n / div).toFixed(2);
}

export function CustomerScreen() {
  const { selectedAccount } = useAuthorization();
  const wallet = useMobileWallet();
  const { connection } = useConnection();
  const { getExplorerUrl, selectedCluster } = useCluster();
  const balance = useBalance();

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [micActive, setMicActive] = useState(false);
  const [enteredAmount, setEnteredAmount] = useState("5.00");
  const [enteredToken, setEnteredToken] = useState<Token>("USDC");
  const [showDebug, setShowDebug] = useState(false);
  const [debug, setDebug] = useState({
    peak: 0,
    rms: 0,
    chunks: 0,
    lastSym: -1 as number,
    lastSnr: 0,
    symCounts: [0, 0, 0, 0],
    preambles: 0,
    framesOk: 0,
    framesBad: 0,
  });

  const statusRef = useRef(status);
  const seenRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const pulseAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!micActive) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(0);
      return;
    }
    Animated.loop(
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 1700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ).start();
  }, [micActive, pulseAnim]);

  useEffect(() => {
    if (!selectedAccount || !micActive) return;

    const channel = getChirpChannel();
    const relay = new RelayClient(CHIRP_CONFIG.relayBaseUrl);

    let unsubDebug: (() => void) | undefined;
    if (channel instanceof AudioChirpChannel) {
      unsubDebug = channel.subscribeDebug((e: ChirpDebugEvent) => {
        setDebug((d) => {
          if (e.type === "audio")
            return { ...d, peak: e.peak, rms: e.rms, chunks: e.chunks };
          if (e.type === "symbol") {
            const counts = [...d.symCounts];
            counts[e.sym]++;
            return { ...d, lastSym: e.sym, lastSnr: e.snr, symCounts: counts };
          }
          if (e.type === "preamble")
            return { ...d, preambles: d.preambles + 1 };
          if (e.type === "frame")
            return e.ok
              ? { ...d, framesOk: d.framesOk + 1 }
              : { ...d, framesBad: d.framesBad + 1 };
          return d;
        });
      });
    }

    const stop = channel.listen(async (payload) => {
      const heardAt = Date.now();
      const seenAt = seenRef.current.get(payload.requestId);
      if (seenAt && heardAt - seenAt < SEEN_TTL_MS) return;
      seenRef.current.set(payload.requestId, heardAt);

      const cur = statusRef.current.kind;
      if (
        cur === "signing" ||
        cur === "submitting" ||
        cur === "chirping" ||
        cur === "review" ||
        cur === "menu"
      )
        return;

      try {
        const lookup: Lookup = await relay.lookup(payload.requestId);
        if (lookup.type === "order") {
          // The phone heard its OWN earlier chirp echoing back through the
          // mic. Ignore — orders are never the Pay-tab's input.
          return;
        }
        if (lookup.type === "intent") {
          const fakeSession: Session = {
            type: "session",
            sessionId: lookup.requestId,
            merchantPubkey: lookup.recipient,
            merchantName: lookup.merchantName,
            acceptedTokens: lookup.tokenMint ? ["USDC"] : ["SOL"],
            sessionCode: "0000",
            menuItems: [
              {
                id: "intent",
                name: lookup.memo ?? "Payment",
                priceMicros: lookup.amountMicros,
                token: lookup.tokenMint ? "USDC" : "SOL",
                emoji: "💸",
              },
            ],
            createdAt: lookup.createdAt,
            expiresAt: lookup.createdAt + 60_000,
            paidPayments: [],
          };
          haptic.tap();
          setStatus({ kind: "menu", session: fakeSession });
          return;
        }
        // lookup is a Session here.
        const session = lookup;
        const now = Date.now();
        if (session.closedAt) {
          haptic.warn();
          setStatus({
            kind: "error",
            message: "Cashier closed before you could pay.",
          });
          return;
        }
        if (now > session.expiresAt) {
          haptic.warn();
          setStatus({
            kind: "error",
            message: "Broadcast expired. Wait for the next chirp.",
          });
          return;
        }
        setEnteredToken(
          session.acceptedTokens.includes("USDC") ? "USDC" : "SOL",
        );
        haptic.tap();
        setStatus({ kind: "menu", session });
      } catch (e: any) {
        haptic.error();
        setStatus({ kind: "error", message: String(e?.message ?? e) });
      }
    });

    return () => {
      stop();
      unsubDebug?.();
    };
  }, [selectedAccount, micActive]);

  if (!selectedAccount) {
    return (
      <ScrollView
        style={{ backgroundColor: COLORS.bg }}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.hero}>
          <BirdLogo size={88} bg={COLORS.ink} glow={false} />
          <Text style={styles.heading}>No wallet</Text>
          <Text style={styles.sub}>
            Connect a wallet from the Home tab first.
          </Text>
        </View>
      </ScrollView>
    );
  }

  const pickItem = (item: MenuItem) => {
    if (statusRef.current.kind !== "menu") return;
    haptic.press();
    const session = (statusRef.current as IncomingFlow).session;
    const intent: PaymentIntent = {
      type: "intent",
      requestId: session.sessionId,
      recipient: session.merchantPubkey,
      amountMicros: item.priceMicros,
      tokenMint: item.token === "USDC" ? USDC_DEVNET_MINT.toBase58() : null,
      memo: `${session.merchantName ?? "Chirp"} · ${item.name}`,
      merchantName: session.merchantName,
      createdAt: session.createdAt,
    };
    setStatus({
      kind: "review",
      intent,
      sessionCode: session.sessionCode,
      pickedItem: item,
    });
  };

  const customAmount = () => {
    if (statusRef.current.kind !== "menu") return;
    haptic.press();
    const session = (statusRef.current as IncomingFlow).session;
    const parsed = parseFloat(enteredAmount);
    if (!parsed || parsed <= 0) {
      haptic.warn();
      setStatus({ kind: "error", message: "Enter a valid amount." });
      return;
    }
    const div = enteredToken === "USDC" ? 1_000_000 : 1_000_000_000;
    const intent: PaymentIntent = {
      type: "intent",
      requestId: session.sessionId,
      recipient: session.merchantPubkey,
      amountMicros: BigInt(Math.round(parsed * div)).toString(),
      tokenMint: enteredToken === "USDC" ? USDC_DEVNET_MINT.toBase58() : null,
      memo: `${session.merchantName ?? "Chirp"} · custom`,
      merchantName: session.merchantName,
      createdAt: session.createdAt,
    };
    setStatus({
      kind: "review",
      intent,
      sessionCode: session.sessionCode,
    });
  };

  const handleConfirm = async () => {
    const cur = statusRef.current;
    if (cur.kind !== "review") return;
    haptic.press();
    const intent = cur.intent;
    const pickedItem = cur.pickedItem;
    const sessionId = intent.requestId;
    const relay = new RelayClient(CHIRP_CONFIG.relayBaseUrl);
    const payerKey = selectedAccount.publicKey.toBase58();

    // Phase 1 — chirp the order to the cashier.
    setStatus({ kind: "chirping" });
    const orderId = newRequestId();
    try {
      await relay.createOrder({
        orderId,
        sessionId,
        payerPubkey: payerKey,
        merchantPubkey: intent.recipient,
        merchantName: intent.merchantName,
        itemId: pickedItem?.id,
        itemName: pickedItem?.name,
        itemEmoji: pickedItem?.emoji,
        amountMicros: intent.amountMicros,
        tokenMint: intent.tokenMint,
        token: intent.tokenMint ? "USDC" : "SOL",
      });
      const channel = getChirpChannel();
      await channel.emit({ requestId: orderId });
    } catch (e: any) {
      // Order chirp is best-effort — if it fails, the cashier still sees the
      // payment via relay polling. Continue to sign.
      console.log("[customer] order chirp failed (continuing):", e);
    }

    // Phase 2 — sign + submit the actual payment.
    setStatus({ kind: "signing" });
    try {
      const { tx, minContextSlot } = await buildPaymentTx(
        connection,
        new PublicKey(payerKey),
        intent,
      );
      const signature = await wallet.signAndSendTransaction(tx, minContextSlot);
      setStatus({ kind: "submitting" });
      const ok = await confirmSignature(connection, signature);
      if (!ok) {
        haptic.error();
        setStatus({
          kind: "error",
          message: "Transaction failed to confirm.",
        });
        return;
      }
      await relay
        .ackSessionPaid(sessionId, {
          signature,
          payerPubkey: payerKey,
          amountMicros: intent.amountMicros,
          tokenMint: intent.tokenMint,
        })
        .catch(() => {});
      await relay.settleOrder(orderId, signature).catch(() => {});

      // Persist a local receipt so the user has a payment history that
      // survives across launches.
      const prettyAmount = formatAmount(intent);
      recordReceipt({
        signature,
        amount: prettyAmount,
        amountMicros: intent.amountMicros,
        token: intent.tokenMint ? "USDC" : "SOL",
        merchantName: intent.merchantName,
        merchantPubkey: intent.recipient,
        itemName: pickedItem?.name,
        itemEmoji: pickedItem?.emoji,
        cluster: selectedCluster.network,
        ts: Date.now(),
      }).catch(() => {});

      haptic.success();
      setStatus({
        kind: "confirmed",
        signature,
        amount: prettyAmount,
      });
    } catch (e: any) {
      const isCancellation = String(e?.message ?? "").includes(
        "CancellationException",
      );
      haptic.error();
      setStatus({
        kind: "error",
        message: isCancellation
          ? "Wallet cancelled."
          : String(e?.message ?? e),
      });
    }
  };

  const cancel = () => {
    haptic.tap();
    setStatus({ kind: "idle" });
  };

  return (
    <ScrollView
      style={{ backgroundColor: COLORS.bg }}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <ListeningHeader micActive={micActive} pulseAnim={pulseAnim} />

      <View style={{ alignItems: "center" }}>
        <BalancePill balance={balance} />
      </View>

      <PopButton
        label={micActive ? "🛑  Stop listening" : "🎧  Start listening"}
        variant={micActive ? "secondary" : "primary"}
        onPress={() => {
          haptic.press();
          setMicActive((v) => !v);
        }}
      />

      <Pressable
        onPress={() => {
          haptic.tap();
          setShowDebug((v) => !v);
        }}
        style={styles.debugToggle}
      >
        <Text style={styles.debugToggleText}>
          {showDebug ? "Hide diagnostics" : "Show diagnostics"}
        </Text>
      </Pressable>

      {showDebug && <DebugPanel debug={debug} micActive={micActive} />}

      {status.kind === "idle" && micActive && (
        <Card>
          <Text style={styles.cardTitle}>Listening for chirps…</Text>
          <Text style={styles.cardBody}>
            Hold your phone close to a Chirp terminal. The menu will appear
            here automatically.
          </Text>
        </Card>
      )}

      {status.kind === "menu" && (
        <MenuCard
          session={status.session}
          enteredAmount={enteredAmount}
          setEnteredAmount={setEnteredAmount}
          enteredToken={enteredToken}
          setEnteredToken={setEnteredToken}
          onPick={pickItem}
          onCustom={customAmount}
          onCancel={cancel}
        />
      )}

      {status.kind === "review" && (
        <ReviewCard
          intent={status.intent}
          sessionCode={status.sessionCode}
          pickedItem={status.pickedItem}
          onConfirm={handleConfirm}
          onCancel={cancel}
        />
      )}

      {(status.kind === "chirping" ||
        status.kind === "signing" ||
        status.kind === "submitting") && (
        <Card>
          <Text style={styles.cardTitle}>
            {status.kind === "chirping"
              ? "Chirping order to cashier…"
              : status.kind === "signing"
              ? "Sign in your wallet…"
              : "Submitting to Solana…"}
          </Text>
          <Text style={styles.cardBody}>
            {status.kind === "chirping"
              ? "Hold your phone toward the register."
              : status.kind === "signing"
              ? "Approve the transaction in Phantom."
              : "Confirming on devnet — usually under a second."}
          </Text>
        </Card>
      )}

      {status.kind === "confirmed" && (
        <ConfirmedCard
          signature={status.signature}
          amount={status.amount}
          explorerUrl={getExplorerUrl(`tx/${status.signature}`)}
          clusterName={selectedCluster.network}
          onDone={cancel}
        />
      )}

      {status.kind === "error" && (
        <Card style={{ borderColor: "rgba(255, 69, 58, 0.32)", borderWidth: StyleSheet.hairlineWidth }}>
          <Text style={[styles.cardTitle, { color: COLORS.red }]}>
            Something went wrong
          </Text>
          <Text style={styles.cardBody}>{status.message}</Text>
          <View style={{ height: 14 }} />
          <PopButton label="OK" variant="secondary" onPress={cancel} />
        </Card>
      )}
    </ScrollView>
  );
}

function DebugPanel({
  debug,
  micActive,
}: {
  debug: {
    peak: number;
    rms: number;
    chunks: number;
    lastSym: number;
    lastSnr: number;
    symCounts: number[];
    preambles: number;
    framesOk: number;
    framesBad: number;
  };
  micActive: boolean;
}) {
  const ranges = ["19.0", "19.5", "20.0", "20.5"];
  const [a, b, c, d] = debug.symCounts;
  const total = a + b + c + d || 1;
  const bars = [a, b, c, d].map((n) => n / total);
  const heard = debug.chunks > 0;
  return (
    <View style={styles.debugCard}>
      <Text style={styles.debugLabel}>DIAGNOSTICS</Text>
      <Text style={styles.debugLine}>
        mic: {micActive ? (heard ? "running" : "no audio yet") : "off"}
        {"  ·  "}
        chunks {debug.chunks}
      </Text>
      <Text style={styles.debugLine}>
        peak {debug.peak.toFixed(3)}   rms {debug.rms.toFixed(3)}
      </Text>
      <View style={styles.debugMeter}>
        <View
          style={[
            styles.debugMeterFill,
            { width: `${Math.min(100, debug.peak * 100)}%` },
          ]}
        />
      </View>

      <Text style={[styles.debugLabel, { marginTop: 12 }]}>
        TONE COUNTS · kHz
      </Text>
      <View style={styles.debugBars}>
        {bars.map((v, i) => (
          <View key={i} style={styles.debugBarCol}>
            <View style={styles.debugBarTrack}>
              <View
                style={[
                  styles.debugBarFill,
                  { height: `${Math.max(2, v * 100)}%` },
                ]}
              />
            </View>
            <Text style={styles.debugBarLabel}>{ranges[i]}</Text>
            <Text style={styles.debugBarCount}>{[a, b, c, d][i]}</Text>
          </View>
        ))}
      </View>

      <Text style={[styles.debugLabel, { marginTop: 12 }]}>DECODER</Text>
      <Text style={styles.debugLine}>
        last symbol {debug.lastSym >= 0 ? debug.lastSym : "—"}   snr{" "}
        {debug.lastSnr.toFixed(1)}
      </Text>
      <Text style={styles.debugLine}>
        preambles {debug.preambles}   frames ok {debug.framesOk}   bad{" "}
        {debug.framesBad}
      </Text>

      {micActive && !heard && (
        <Text style={styles.debugWarn}>
          No mic chunks. Check mic permission, then close & reopen Pay tab.
        </Text>
      )}
      {micActive && heard && debug.peak < 0.005 && (
        <Text style={styles.debugWarn}>
          Mic is open but level is near zero. Move closer to the speaker or
          check the system input volume.
        </Text>
      )}
      {micActive && heard && total < 5 && debug.peak >= 0.005 && (
        <Text style={styles.debugWarn}>
          Mic is hearing audio but no chirp tones. The speaker may be rolling
          off above 19 kHz. Try external speakers, or relay-channel mode.
        </Text>
      )}
    </View>
  );
}

function ListeningHeader({
  micActive,
  pulseAnim,
}: {
  micActive: boolean;
  pulseAnim: Animated.Value;
}) {
  const scale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.85],
  });
  const opacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 0],
  });
  const scaleSecond = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 2.4],
  });
  const opacitySecond = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0],
  });
  return (
    <View style={styles.hero}>
      <View style={styles.pulseWrap}>
        {micActive && (
          <>
            <Animated.View
              style={[
                styles.pulse,
                {
                  transform: [{ scale: scaleSecond }],
                  opacity: opacitySecond,
                },
              ]}
            />
            <Animated.View
              style={[styles.pulse, { transform: [{ scale }], opacity }]}
            />
          </>
        )}
        <BirdLogo
          size={96}
          bg={COLORS.ink}
          glow={micActive}
        />
      </View>
      <Text style={styles.heading}>
        {micActive ? "Listening for menus" : "Mic off"}
      </Text>
      <Text style={styles.sub}>
        {micActive
          ? "Hold your phone close to a Chirp terminal."
          : "Tap below to start listening for nearby cashiers."}
      </Text>
    </View>
  );
}

function MenuCard({
  session,
  enteredAmount,
  setEnteredAmount,
  enteredToken,
  setEnteredToken,
  onPick,
  onCustom,
  onCancel,
}: {
  session: Session;
  enteredAmount: string;
  setEnteredAmount: (v: string) => void;
  enteredToken: Token;
  setEnteredToken: (t: Token) => void;
  onPick: (item: MenuItem) => void;
  onCustom: () => void;
  onCancel: () => void;
}) {
  const items = session.menuItems ?? [];
  return (
    <Card>
      <Text style={styles.codeLabel}>VERIFY · MATCHES THE TERMINAL</Text>
      <Text style={styles.bigCode}>
        {session.sessionCode.split("").join(" ")}
      </Text>
      <Text style={styles.merchantName}>
        {session.merchantName ?? "Merchant"}
      </Text>
      <Text style={styles.merchantAddr}>
        {session.merchantPubkey.slice(0, 8)}…
        {session.merchantPubkey.slice(-6)}
      </Text>

      {items.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 22 }]}>
            TAP AN ITEM TO PAY
          </Text>
          <View style={{ gap: 10 }}>
            {items.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => onPick(item)}
                style={({ pressed }) => [
                  styles.menuItem,
                  {
                    backgroundColor: pressed
                      ? COLORS.paperHigh
                      : COLORS.paperDeep,
                    transform: [{ translateY: pressed ? 1 : 0 }],
                  },
                ]}
              >
                <Text style={styles.menuEmoji}>{item.emoji ?? "🧾"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuItemName}>{item.name}</Text>
                </View>
                <Text style={styles.menuItemPrice}>
                  {microsToDisplay(item.priceMicros, item.token)} {item.token}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Text style={[styles.sectionLabel, { marginTop: 22 }]}>
        OR TIP / CUSTOM AMOUNT
      </Text>
      <View style={styles.tokenRow}>
        {(session.acceptedTokens as Token[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => {
              haptic.tap();
              setEnteredToken(t);
            }}
            style={[
              styles.tokenChip,
              enteredToken === t && styles.tokenChipActive,
            ]}
          >
            <Text
              style={[
                styles.tokenChipText,
                enteredToken === t && styles.tokenChipTextActive,
              ]}
            >
              {t}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.amountRow}>
        <TextInput
          value={enteredAmount}
          onChangeText={setEnteredAmount}
          keyboardType="decimal-pad"
          style={styles.amountInput}
          selectionColor={COLORS.accent}
          placeholderTextColor={COLORS.inkMuted}
        />
        <Text style={styles.amountToken}>{enteredToken}</Text>
      </View>

      <View style={{ height: 14 }} />
      <PopButton label="Pay custom amount" onPress={onCustom} />
      <View style={{ height: 8 }} />
      <PopButton label="Cancel" variant="ghost" onPress={onCancel} />
    </Card>
  );
}

function ReviewCard({
  intent,
  sessionCode,
  pickedItem,
  onConfirm,
  onCancel,
}: {
  intent: PaymentIntent;
  sessionCode?: string;
  pickedItem?: MenuItem;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Card style={{ borderColor: "rgba(255, 180, 74, 0.3)", borderWidth: StyleSheet.hairlineWidth }}>
      <Text style={styles.codeLabel}>REVIEW PAYMENT</Text>
      {pickedItem && (
        <Text style={styles.pickedItem}>
          {pickedItem.emoji ?? "🧾"} {pickedItem.name}
        </Text>
      )}
      <Text style={styles.bigAmount}>{formatAmount(intent)}</Text>
      <Text style={styles.toLabel}>To</Text>
      <Text style={styles.toName}>{intent.merchantName ?? "Merchant"}</Text>
      <Text style={styles.merchantAddr}>{intent.recipient}</Text>
      {sessionCode && sessionCode !== "0000" && (
        <View style={styles.codePill}>
          <Text style={styles.codePillLabel}>TERMINAL CODE</Text>
          <Text style={styles.codePillValue}>{sessionCode}</Text>
        </View>
      )}
      <View style={{ height: 18 }} />
      <PopButton label="Place order  →" onPress={onConfirm} />
      <View style={{ height: 8 }} />
      <PopButton label="Cancel" variant="ghost" onPress={onCancel} />
    </Card>
  );
}

function ConfirmedCard({
  signature,
  amount,
  explorerUrl,
  clusterName,
  onDone,
}: {
  signature: string;
  amount: string;
  explorerUrl: string;
  clusterName: string;
  onDone: () => void;
}) {
  const scale = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 110,
      useNativeDriver: true,
    }).start();
    Animated.parallel([
      Animated.timing(ringScale, {
        toValue: 2.4,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(ringOpacity, {
          toValue: 0.7,
          duration: 80,
          useNativeDriver: true,
        }),
        Animated.timing(ringOpacity, {
          toValue: 0,
          duration: 820,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [scale, ringScale, ringOpacity]);

  return (
    <Card
      style={{
        alignItems: "center",
      }}
    >
      <View style={styles.checkWrap}>
        <Animated.View
          style={[
            styles.checkRing,
            {
              transform: [{ scale: ringScale }],
              opacity: ringOpacity,
            },
          ]}
        />
        <Animated.View
          style={[styles.bigCheck, { transform: [{ scale }] }]}
        >
          <Text style={styles.bigCheckText}>✓</Text>
        </Animated.View>
      </View>
      <Text style={styles.confirmedHeading}>Paid</Text>
      <Text style={styles.bigAmount}>{amount}</Text>
      <Text style={styles.confirmedSub}>
        Settled on Solana {clusterName}
      </Text>

      <Pressable
        onPress={() => {
          haptic.tap();
          Linking.openURL(explorerUrl).catch(() => {});
        }}
        hitSlop={10}
        style={({ pressed }) => [
          styles.sigLink,
          pressed && { opacity: 0.65 },
        ]}
      >
        <Text style={styles.sigLinkLabel}>VIEW PROOF ON SOLANA EXPLORER</Text>
        <View style={styles.sigLinkRow}>
          <Text style={styles.sigLinkSig}>
            {signature.slice(0, 12)}…{signature.slice(-6)}
          </Text>
          <Text style={styles.sigLinkArrow}>↗</Text>
        </View>
      </Pressable>

      <View style={{ height: 14 }} />
      <PopButton label="Done" onPress={onDone} />
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 60,
    gap: 18,
  },
  hero: {
    alignItems: "center",
    paddingTop: 14,
    paddingBottom: 4,
    gap: 16,
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.ink,
    letterSpacing: -0.6,
    marginTop: 6,
  },
  sub: {
    fontSize: 14,
    color: COLORS.inkSoft,
    textAlign: "center",
    paddingHorizontal: 28,
    lineHeight: 20,
    letterSpacing: -0.1,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.ink,
    letterSpacing: -0.4,
  },
  cardBody: {
    fontSize: 14,
    color: COLORS.inkSoft,
    marginTop: 8,
    lineHeight: 21,
  },
  codeLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.8,
    color: COLORS.inkMuted,
  },
  bigCode: {
    fontSize: 72,
    fontWeight: "400",
    color: COLORS.ink,
    marginVertical: 12,
    letterSpacing: 6,
    fontFamily: DISPLAY_FONT,
    lineHeight: 76,
  },
  merchantName: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.ink,
    marginTop: 4,
    letterSpacing: -0.3,
  },
  merchantAddr: {
    fontSize: 12,
    color: COLORS.inkMuted,
    fontFamily: "Courier",
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.8,
    color: COLORS.inkMuted,
    marginBottom: 12,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  menuEmoji: {
    fontSize: 24,
    width: 32,
    textAlign: "center",
  },
  menuItemName: {
    fontSize: 16,
    fontWeight: "500",
    color: COLORS.ink,
    letterSpacing: -0.2,
  },
  menuItemPrice: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.ink,
    letterSpacing: -0.1,
  },
  tokenRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  tokenChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.paperDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  tokenChipActive: {
    backgroundColor: COLORS.ink,
    borderColor: COLORS.ink,
  },
  tokenChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.inkSoft,
    letterSpacing: 0.5,
  },
  tokenChipTextActive: {
    color: "#0A0A0E",
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.paperDeep,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  amountInput: {
    flex: 1,
    fontSize: 36,
    fontWeight: "300",
    color: COLORS.ink,
    paddingVertical: 0,
    letterSpacing: -1.5,
  },
  amountToken: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.inkMuted,
    letterSpacing: 0.6,
  },
  bigAmount: {
    fontSize: 64,
    fontWeight: "400",
    color: COLORS.ink,
    marginTop: 14,
    letterSpacing: -2,
    fontFamily: DISPLAY_FONT,
    lineHeight: 68,
  },
  pickedItem: {
    fontSize: 22,
    color: COLORS.ink,
    marginTop: 8,
    fontWeight: "500",
    letterSpacing: -0.3,
  },
  toLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.6,
    color: COLORS.inkMuted,
    marginTop: 18,
  },
  toName: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.ink,
    marginTop: 4,
    letterSpacing: -0.2,
  },
  codePill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderSoft,
    alignSelf: "flex-start",
  },
  codePillLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.6,
    color: COLORS.inkMuted,
  },
  codePillValue: {
    fontSize: 20,
    fontWeight: "500",
    color: COLORS.ink,
    letterSpacing: 5,
    marginTop: 3,
    fontFamily: "Courier",
  },
  pulseWrap: {
    width: 160,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
  },
  pulse: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
  checkWrap: {
    width: 110,
    height: 110,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  checkRing: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.4)",
  },
  bigCheck: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: COLORS.ink,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  bigCheckText: {
    fontSize: 48,
    color: "#0A0A0E",
    fontWeight: "600",
    lineHeight: 56,
  },
  confirmedHeading: {
    fontSize: 38,
    fontWeight: "400",
    color: COLORS.ink,
    marginTop: 20,
    letterSpacing: -1.2,
    fontFamily: DISPLAY_FONT,
    fontStyle: "italic",
  },
  confirmedSub: {
    fontSize: 13,
    color: COLORS.inkSoft,
    marginTop: 6,
  },
  confirmedSig: {
    fontSize: 11,
    color: COLORS.inkMuted,
    fontFamily: "Courier",
    marginTop: 10,
  },
  sigLink: {
    marginTop: 18,
    alignSelf: "stretch",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderSoft,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  sigLinkLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: COLORS.accent,
    marginBottom: 6,
  },
  sigLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sigLinkSig: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: "Courier",
    flexShrink: 1,
  },
  sigLinkArrow: {
    fontSize: 14,
    color: COLORS.accent,
    fontWeight: "700",
  },
  debugToggle: {
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.borderSoft,
  },
  debugToggleText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.inkSoft,
    letterSpacing: 0.6,
  },
  debugCard: {
    backgroundColor: COLORS.paperDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  debugLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.6,
    color: COLORS.inkMuted,
    marginBottom: 4,
  },
  debugLine: {
    fontFamily: "Courier",
    fontSize: 11,
    color: COLORS.ink,
    letterSpacing: 0.2,
  },
  debugMeter: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 6,
  },
  debugMeterFill: {
    height: "100%",
    backgroundColor: COLORS.accent,
  },
  debugBars: {
    flexDirection: "row",
    gap: 8,
    height: 70,
    marginTop: 4,
  },
  debugBarCol: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  debugBarTrack: {
    width: "100%",
    height: 40,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 4,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  debugBarFill: {
    width: "100%",
    backgroundColor: COLORS.accent,
  },
  debugBarLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: COLORS.inkMuted,
    marginTop: 4,
    letterSpacing: 0.4,
  },
  debugBarCount: {
    fontSize: 10,
    color: COLORS.inkSoft,
    fontFamily: "Courier",
  },
  debugWarn: {
    fontSize: 11,
    color: COLORS.accent,
    marginTop: 10,
    lineHeight: 15,
  },
});
