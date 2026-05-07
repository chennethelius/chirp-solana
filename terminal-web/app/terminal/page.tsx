"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CONFIG } from "@/lib/config";
import { MenuItem, Order, RelayClient, Session } from "@/lib/relay";
import { newRequestId } from "@/lib/chirp";
import { emitChirp, chime } from "@/lib/audioEmitter";
import { startListening, ListenerStats } from "@/lib/audioListener";
import { BirdLogo } from "@/components/BirdLogo";
import { BalanceHero } from "@/components/BalancePanel";
import { loadMerchantConfig, MerchantConfig } from "@/lib/wallet";

const SESSION_CHIRP_INTERVAL_MS = 5000;
const SESSION_REFRESH_INTERVAL_MS = 30_000;
const RECEIPT_POLL_INTERVAL_MS = 1500;
const MENU_KEY = "whisper.merchant.menu";

const USDC_DEVNET_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

type Token = "USDC" | "SOL";

type Receipt = {
  sessionId: string;
  status: "open" | "closed";
  paymentCount: number;
  totalsByToken: Partial<Record<Token, number>>;
  createdAt: number;
};

const DEFAULT_MENU: MenuItem[] = [
  { id: "espresso", name: "Espresso", priceMicros: "3000000", token: "USDC", emoji: "☕" },
  { id: "latte", name: "Oat Latte", priceMicros: "5500000", token: "USDC", emoji: "🥛" },
  { id: "croissant", name: "Croissant", priceMicros: "4250000", token: "USDC", emoji: "🥐" },
];

function rand4(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] % 10000).toString().padStart(4, "0");
}

function microsToDisplay(micros: string, token: Token): string {
  const n = Number(BigInt(micros));
  const div = token === "USDC" ? 1_000_000 : 1_000_000_000;
  return (n / div).toFixed(2);
}

function loadMenu(): MenuItem[] {
  if (typeof window === "undefined") return DEFAULT_MENU;
  const raw = localStorage.getItem(MENU_KEY);
  if (!raw) return DEFAULT_MENU;
  try {
    const parsed = JSON.parse(raw) as MenuItem[];
    if (!Array.isArray(parsed)) return DEFAULT_MENU;
    return parsed;
  } catch {
    return DEFAULT_MENU;
  }
}

function saveMenu(items: MenuItem[]) {
  localStorage.setItem(MENU_KEY, JSON.stringify(items));
}

export default function TerminalPage() {
  const router = useRouter();
  const [merchant, setMerchant] = useState<MerchantConfig | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>(DEFAULT_MENU);
  const [active, setActive] = useState<{
    sessionId: string;
    sessionCode: string;
  } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [chirpPulse, setChirpPulse] = useState(0);
  const [busy, setBusy] = useState(false);
  const [incomingOrder, setIncomingOrder] = useState<Order | null>(null);
  const [paidConfirm, setPaidConfirm] = useState<{
    amount: number;
    token: Token;
    payer?: string;
    when: number;
  } | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugStats, setDebugStats] = useState<ListenerStats | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const chirpTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopListenRef = useRef<(() => void) | null>(null);
  const stopStatsRef = useRef<(() => void) | null>(null);
  const seenOrderRef = useRef<Set<string>>(new Set());
  const seenPaidRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const cfg = loadMerchantConfig();
    if (!cfg || !cfg.pubkey) {
      router.replace("/");
      return;
    }
    setMerchant(cfg);
    setMenu(loadMenu());
  }, [router]);

  useEffect(
    () => () => {
      chirpTimer.current && clearInterval(chirpTimer.current);
      refreshTimer.current && clearInterval(refreshTimer.current);
      pollTimer.current && clearInterval(pollTimer.current);
      stopListenRef.current?.();
    },
    [],
  );

  if (!merchant) return null;

  const updateMenu = (next: MenuItem[]) => {
    setMenu(next);
    saveMenu(next);
  };

  const broadcastMenu = async () => {
    if (active || busy) return;
    if (menu.length === 0) {
      alert("Add at least one menu item before broadcasting.");
      return;
    }
    setBusy(true);
    try {
      const sessionId = newRequestId();
      const sessionCode = rand4();
      const acceptedTokens: Token[] = Array.from(
        new Set(menu.map((m) => m.token)),
      ) as Token[];
      const relay = new RelayClient(CONFIG.relayBaseUrl);
      await relay.openSession({
        sessionId,
        merchantPubkey: merchant.pubkey,
        merchantName: merchant.name,
        acceptedTokens,
        sessionCode,
        menuItems: menu,
      });
      setActive({ sessionId, sessionCode });
      setReceipt({
        sessionId,
        status: "open",
        paymentCount: 0,
        totalsByToken: {},
        createdAt: Date.now(),
      });

      const emit = async () => {
        try {
          await emitChirp({ requestId: sessionId });
          setChirpPulse((n) => n + 1);
        } catch {}
      };
      emit();
      chirpTimer.current = setInterval(emit, SESSION_CHIRP_INTERVAL_MS);
      refreshTimer.current = setInterval(
        () => relay.refreshSession(sessionId).catch(() => {}),
        SESSION_REFRESH_INTERVAL_MS,
      );
      pollTimer.current = setInterval(async () => {
        try {
          const s: Session = await relay.getSession(sessionId);
          const totals: Partial<Record<Token, number>> = {};
          for (const p of s.paidPayments) {
            const t: Token = p.tokenMint ? "USDC" : "SOL";
            const div = t === "USDC" ? 1_000_000 : 1_000_000_000;
            totals[t] = (totals[t] ?? 0) + Number(BigInt(p.amountMicros)) / div;
            // Trigger confirmation overlay only on newly-seen payments.
            if (!seenPaidRef.current.has(p.signature)) {
              seenPaidRef.current.add(p.signature);
              const div2 = t === "USDC" ? 1_000_000 : 1_000_000_000;
              setPaidConfirm({
                amount: Number(BigInt(p.amountMicros)) / div2,
                token: t,
                payer: p.payerPubkey,
                when: Date.now(),
              });
              chime("ok").catch(() => {});
            }
          }
          setReceipt({
            sessionId,
            status: s.closedAt ? "closed" : "open",
            paymentCount: s.paidPayments.length,
            totalsByToken: totals,
            createdAt: s.createdAt,
          });
        } catch {}
      }, RECEIPT_POLL_INTERVAL_MS);

      // Mic listener — phone chirps order details back, we decode and show
      // the live order before payment lands.
      try {
        const listener = await startListening(async ({ requestId }) => {
          if (seenOrderRef.current.has(requestId)) return;
          seenOrderRef.current.add(requestId);
          try {
            const order = await relay.getOrder(requestId);
            if (order.sessionId !== sessionId) return;
            setIncomingOrder(order);
            chime("ok").catch(() => {});
          } catch {
            // Not an order — likely our own outgoing session chirp echoing.
          }
        });
        stopListenRef.current = listener.stop;
        stopStatsRef.current = listener.onStats(setDebugStats);
        setMicError(null);
      } catch (e: any) {
        console.warn("[terminal] mic listen failed:", e);
        setMicError(
          e?.name === "NotAllowedError"
            ? "Mic permission denied — click the lock icon in the address bar."
            : String(e?.message ?? e),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const closeBroadcast = async () => {
    if (!active) return;
    chirpTimer.current && clearInterval(chirpTimer.current);
    refreshTimer.current && clearInterval(refreshTimer.current);
    pollTimer.current && clearInterval(pollTimer.current);
    chirpTimer.current = null;
    refreshTimer.current = null;
    pollTimer.current = null;
    stopStatsRef.current?.();
    stopStatsRef.current = null;
    stopListenRef.current?.();
    stopListenRef.current = null;
    seenOrderRef.current.clear();
    seenPaidRef.current.clear();
    setIncomingOrder(null);
    setPaidConfirm(null);
    setDebugStats(null);
    setMicError(null);
    const relay = new RelayClient(CONFIG.relayBaseUrl);
    await relay.closeSession(active.sessionId);
    setActive(null);
  };

  const truncated = `${merchant.pubkey.slice(0, 6)}…${merchant.pubkey.slice(-4)}`;

  return (
    <main className="min-h-screen px-5 py-6 max-w-3xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={active ? "drift" : ""}>
            <BirdLogo size={44} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold leading-tight">
              {merchant.name}
            </h1>
            <p className="font-mono text-[11px] text-[var(--color-ink-soft)]">
              {truncated}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowDebug((v) => !v)}
            className="text-[10px] tracking-[0.16em] uppercase font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] transition"
          >
            {showDebug ? "Hide" : "Show"} diagnostics
          </button>
          <button
            onClick={() => router.push("/")}
            className="text-xs text-[var(--color-ink-soft)] font-semibold underline"
          >
            Switch wallet
          </button>
        </div>
      </header>

      <div className="mb-4">
        <BalanceHero pubkey={merchant.pubkey} />
      </div>

      {active ? (
        <BroadcastingCard
          code={active.sessionCode}
          merchantPubkey={merchant.pubkey}
          merchantName={merchant.name}
          menu={menu}
          chirpPulse={chirpPulse}
          receipt={receipt}
          onClose={closeBroadcast}
        />
      ) : (
        <MenuBuilder
          menu={menu}
          setMenu={updateMenu}
          busy={busy}
          onBroadcast={broadcastMenu}
        />
      )}

      {showDebug && active && (
        <div className="mt-4">
          <DebugPanel stats={debugStats} micError={micError} />
        </div>
      )}

      {incomingOrder && (
        <OrderToast
          order={incomingOrder}
          onDismiss={() => setIncomingOrder(null)}
        />
      )}

      {paidConfirm && (
        <PaidOverlay
          amount={paidConfirm.amount}
          token={paidConfirm.token}
          payer={paidConfirm.payer}
          onDone={() => setPaidConfirm(null)}
        />
      )}
    </main>
  );
}

function OrderToast({
  order,
  onDismiss,
}: {
  order: Order;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 7000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  const div = order.token === "USDC" ? 1_000_000 : 1_000_000_000;
  const amt = (Number(BigInt(order.amountMicros)) / div).toFixed(
    order.token === "USDC" ? 2 : 4,
  );
  return (
    <div className="fixed bottom-6 right-6 z-30 max-w-sm pop-in">
      <div className="card-glass-tint p-5">
        <div className="text-[10px] font-semibold tracking-[0.18em] text-[var(--color-accent)] uppercase">
          New order · heard via mic
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <div className="text-2xl">{order.itemEmoji ?? "🧾"}</div>
          <div className="font-display text-3xl text-[var(--color-ink)] leading-none">
            {amt}
            <span className="ml-2 text-base text-[var(--color-ink-soft)]">
              {order.token}
            </span>
          </div>
        </div>
        {order.itemName && (
          <div className="text-sm text-[var(--color-ink-soft)] mt-2">
            {order.itemName}
          </div>
        )}
        <div className="font-mono text-[10px] text-[var(--color-ink-muted)] mt-3 truncate">
          from {order.payerPubkey.slice(0, 8)}…{order.payerPubkey.slice(-6)}
        </div>
      </div>
    </div>
  );
}

function PaidOverlay({
  amount,
  token,
  payer,
  onDone,
}: {
  amount: number;
  token: Token;
  payer?: string;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, 4500);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div
      onClick={onDone}
      className="fixed inset-0 z-40 flex items-center justify-center p-6 cursor-pointer"
      style={{
        background:
          "radial-gradient(800px 600px at 50% 50%, rgba(255,180,74,0.18), rgba(8,8,11,0.92))",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div className="text-center pop-in">
        <div
          className="mx-auto w-28 h-28 rounded-full flex items-center justify-center"
          style={{
            background:
              "linear-gradient(180deg, #FFFFFF 0%, #E8E8EB 100%)",
            boxShadow:
              "0 0 80px rgba(255, 180, 74, 0.5), 0 20px 40px rgba(0,0,0,0.5)",
          }}
        >
          <span className="text-5xl text-[#0A0A0E]">✓</span>
        </div>
        <div className="font-display italic text-5xl text-[var(--color-ink)] mt-7 leading-none">
          paid
        </div>
        <div className="font-display text-7xl text-[var(--color-ink)] mt-3 leading-none">
          {amount.toLocaleString(undefined, {
            minimumFractionDigits: token === "USDC" ? 2 : 4,
            maximumFractionDigits: token === "USDC" ? 2 : 4,
          })}{" "}
          <span className="text-[var(--color-ink-soft)]">{token}</span>
        </div>
        {payer && (
          <div className="font-mono text-xs text-[var(--color-ink-muted)] mt-6">
            {payer.slice(0, 12)}…{payer.slice(-8)}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuBuilder({
  menu,
  setMenu,
  busy,
  onBroadcast,
}: {
  menu: MenuItem[];
  setMenu: (m: MenuItem[]) => void;
  busy: boolean;
  onBroadcast: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [token, setToken] = useState<Token>("USDC");
  const [emoji, setEmoji] = useState("");

  const addItem = () => {
    const parsed = parseFloat(price);
    if (!name.trim() || !parsed || parsed <= 0) return;
    const div = token === "USDC" ? 1_000_000 : 1_000_000_000;
    const next: MenuItem = {
      id: name.trim().toLowerCase().replace(/\s+/g, "-") + "-" + Date.now(),
      name: name.trim(),
      priceMicros: BigInt(Math.round(parsed * div)).toString(),
      token,
      emoji: emoji.trim() || undefined,
    };
    setMenu([...menu, next]);
    setName("");
    setPrice("");
    setEmoji("");
  };

  const removeItem = (id: string) => {
    setMenu(menu.filter((m) => m.id !== id));
  };

  return (
    <div className="card-ios p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-extrabold">Your menu</h2>
        <span className="chip">{menu.length} items</span>
      </div>
      <p className="text-sm text-[var(--color-ink-soft)] mb-5">
        Customers in earshot will see this menu, pick what they want, and pay.
      </p>

      <ul className="space-y-2 mb-5">
        {menu.length === 0 && (
          <li className="text-center text-[var(--color-ink-soft)] text-sm py-6">
            No items yet. Add one below to start broadcasting.
          </li>
        )}
        {menu.map((m) => (
          <li
            key={m.id}
            className="flex items-center gap-3 p-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper-deep)]"
          >
            <span className="text-2xl w-8 text-center">{m.emoji ?? "🧾"}</span>
            <div className="flex-1 min-w-0">
              <div className="font-extrabold truncate">{m.name}</div>
              <div className="text-xs text-[var(--color-ink-soft)] font-semibold">
                {microsToDisplay(m.priceMicros, m.token)} {m.token}
              </div>
            </div>
            <button
              onClick={() => removeItem(m.id)}
              className="text-[var(--color-red)] text-xs font-bold px-3 py-1 rounded-full hover:bg-[var(--color-paper-high)]"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="border-t border-[var(--color-border)] pt-4">
        <div className="text-xs font-extrabold uppercase tracking-wider text-[var(--color-ink-soft)] mb-3">
          Add a new item
        </div>
        <div className="grid grid-cols-12 gap-2">
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="🥐"
            maxLength={4}
            className="col-span-2 bg-[var(--color-paper-deep)] border border-[var(--color-border)] text-[var(--color-ink)] rounded-2xl px-3 py-3 text-center text-xl focus:outline-none focus:border-[var(--color-accent)]"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
            className="col-span-6 bg-[var(--color-paper-deep)] border border-[var(--color-border)] text-[var(--color-ink)] rounded-2xl px-3 py-3 font-semibold focus:outline-none focus:border-[var(--color-accent)]"
          />
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="3.50"
            type="number"
            step="0.01"
            min="0"
            className="col-span-2 bg-[var(--color-paper-deep)] border border-[var(--color-border)] text-[var(--color-ink)] rounded-2xl px-3 py-3 font-semibold focus:outline-none focus:border-[var(--color-accent)]"
          />
          <select
            value={token}
            onChange={(e) => setToken(e.target.value as Token)}
            className="col-span-2 bg-[var(--color-paper-deep)] border border-[var(--color-border)] text-[var(--color-ink)] rounded-2xl px-2 py-3 font-bold focus:outline-none focus:border-[var(--color-accent)]"
          >
            <option>USDC</option>
            <option>SOL</option>
          </select>
        </div>
        <button
          onClick={addItem}
          className="btn-pop mt-3 px-5 py-2.5 text-sm bg-[var(--color-paper-deep)] border border-[var(--color-border)] text-[var(--color-ink)] text-[var(--color-ink)]"
          style={{ boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.04)" }}
        >
          + Add to menu
        </button>
      </div>

      <button
        onClick={onBroadcast}
        disabled={busy || menu.length === 0}
        className="btn-pop w-full mt-6 py-4 text-lg disabled:opacity-50"
        style={{
          background: "var(--color-accent)",
          color: "#0A0D11",
          boxShadow:
            "0 10px 28px rgba(255, 180, 74, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
        }}
      >
        📡 Start broadcasting menu
      </button>
    </div>
  );
}

function BroadcastingCard({
  code,
  merchantPubkey,
  merchantName,
  menu,
  chirpPulse,
  receipt,
  onClose,
}: {
  code: string;
  merchantPubkey: string;
  merchantName: string;
  menu: MenuItem[];
  chirpPulse: number;
  receipt: Receipt | null;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div
        className="card-ios p-10 text-center relative overflow-hidden amber-glow"
        style={{
          background:
            "radial-gradient(900px 500px at 50% -120px, rgba(255, 180, 74, 0.18), transparent 70%), linear-gradient(180deg, rgba(21,21,27,0.85) 0%, rgba(15,15,20,0.92) 100%)",
          borderColor: "rgba(255, 180, 74, 0.22)",
        }}
      >
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.22em] mb-2"
          style={{ color: "var(--color-accent)" }}
        >
          Broadcasting
        </div>
        <div
          className="text-xs mb-6"
          style={{ color: "var(--color-ink-muted)", letterSpacing: "0.05em" }}
        >
          Verify this code on your phone
        </div>

        <div className="relative flex items-center justify-center">
          <div
            key={chirpPulse}
            className="absolute w-72 h-72 rounded-full pulse-ring"
            style={{ borderWidth: 1, borderColor: "rgba(255, 180, 74, 0.32)" }}
          />
          <div
            className="font-display leading-none"
            style={{
              color: "var(--color-ink)",
              fontSize: "min(18vw, 8.5rem)",
              fontWeight: 400,
              letterSpacing: "0.04em",
            }}
          >
            {code}
          </div>
        </div>

        <div
          className="mt-8 text-[11px] font-mono"
          style={{ color: "var(--color-ink-muted)", letterSpacing: "0.06em" }}
        >
          {merchantPubkey.slice(0, 12)}…{merchantPubkey.slice(-8)}
        </div>
        <div
          className="mt-1 text-base font-extrabold"
          style={{ color: "#F4F6FA" }}
        >
          {merchantName}
        </div>
      </div>

      <div className="card-ios p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-extrabold">On the menu</h3>
          <span className="chip">{menu.length} items chirping</span>
        </div>
        <ul className="grid grid-cols-2 gap-2">
          {menu.map((m) => (
            <li
              key={m.id}
              className="p-3 rounded-2xl bg-[var(--color-paper-deep)] flex items-center gap-2 border border-[var(--color-border)]"
            >
              <span className="text-xl">{m.emoji ?? "🧾"}</span>
              <div className="flex-1 min-w-0">
                <div className="font-extrabold text-sm truncate">{m.name}</div>
                <div className="text-[11px] text-[var(--color-ink-soft)] font-semibold">
                  {microsToDisplay(m.priceMicros, m.token)} {m.token}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {receipt && (
        <div className="card-ios p-5">
          <div className="text-xs font-extrabold uppercase tracking-wider text-[var(--color-ink-soft)] mb-2">
            Live receipts
          </div>
          {receipt.paymentCount === 0 ? (
            <div className="text-sm text-[var(--color-ink-soft)]">
              No payments yet. Hold a phone near the speaker.
            </div>
          ) : (
            <div className="space-y-1">
              <div className="font-display text-5xl text-[var(--color-ink)] leading-none">
                {receipt.paymentCount}
                <span className="text-[var(--color-accent)] italic ml-3">paid</span>
              </div>
              <div className="text-sm font-semibold">
                {Object.entries(receipt.totalsByToken).map(([t, v]) => (
                  <span key={t} className="mr-3">
                    {(v as number).toFixed(2)} {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={onClose}
        className="btn-pop w-full py-3 bg-[var(--color-paper-deep)] border border-[var(--color-border)] text-[var(--color-ink)] text-[var(--color-ink)]"
        style={{ boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.04)" }}
      >
        Stop broadcasting
      </button>
    </div>
  );
}

function DebugPanel({
  stats,
  micError,
}: {
  stats: ListenerStats | null;
  micError: string | null;
}) {
  const ranges = ["19.0", "19.5", "20.0", "20.5"];
  const counts = stats?.symCounts ?? [0, 0, 0, 0];
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const heard = (stats?.chunks ?? 0) > 0;
  const peak = stats?.peak ?? 0;

  return (
    <div className="card-inset p-5 font-mono text-[11px] text-[var(--color-ink)]">
      <div className="text-[10px] font-semibold tracking-[0.18em] text-[var(--color-ink-soft)] uppercase mb-3">
        Mic diagnostics
      </div>

      <div>
        mic:{" "}
        {micError
          ? "error"
          : stats
          ? heard
            ? "running"
            : "no audio yet"
          : "starting…"}
        {"  ·  chunks "}
        {stats?.chunks ?? 0}
      </div>
      <div className="mt-1">
        peak {peak.toFixed(3)} &nbsp; rms {stats?.rms.toFixed(3) ?? "0.000"}
      </div>
      <div className="h-1 mt-2 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full"
          style={{
            width: `${Math.min(100, peak * 100)}%`,
            background: "var(--color-accent)",
          }}
        />
      </div>

      <div className="text-[10px] font-semibold tracking-[0.18em] text-[var(--color-ink-soft)] uppercase mt-4 mb-2">
        Tone counts · kHz
      </div>
      <div className="grid grid-cols-4 gap-2 h-24">
        {counts.map((n, i) => {
          const pct = (n / total) * 100;
          return (
            <div key={i} className="flex flex-col justify-end items-center">
              <div className="w-full h-16 bg-white/[0.05] rounded relative overflow-hidden">
                <div
                  className="absolute inset-x-0 bottom-0"
                  style={{
                    height: `${Math.max(2, pct)}%`,
                    background: "var(--color-accent)",
                  }}
                />
              </div>
              <div className="text-[9px] font-semibold text-[var(--color-ink-muted)] mt-1.5 tracking-wider">
                {ranges[i]}
              </div>
              <div className="text-[10px] text-[var(--color-ink-soft)]">{n}</div>
            </div>
          );
        })}
      </div>

      <div className="text-[10px] font-semibold tracking-[0.18em] text-[var(--color-ink-soft)] uppercase mt-4 mb-2">
        Decoder
      </div>
      <div>
        last sym {stats?.lastSym !== undefined && stats.lastSym >= 0 ? stats.lastSym : "—"}{" "}
        &nbsp; snr {stats?.lastSnr.toFixed(1) ?? "0.0"}
      </div>
      <div className="mt-1">
        preambles {stats?.preambles ?? 0} &nbsp; frames ok{" "}
        {stats?.framesOk ?? 0} &nbsp; bad {stats?.framesBad ?? 0}
      </div>

      {micError && (
        <div className="mt-3 text-[var(--color-red)] font-sans">{micError}</div>
      )}
      {!micError && stats && heard && peak < 0.005 && (
        <div className="mt-3 text-[var(--color-accent)] font-sans">
          Mic is open but level is near zero. Pick a closer mic in your
          system audio settings, or move the phone closer.
        </div>
      )}
      {!micError && stats && heard && peak >= 0.005 && total < 5 && (
        <div className="mt-3 text-[var(--color-accent)] font-sans">
          Mic hears audio but no chirp tones. Phone speakers may be rolling
          off above 19 kHz — bring the phone closer.
        </div>
      )}
    </div>
  );
}
