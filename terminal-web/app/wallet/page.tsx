"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { BirdLogo } from "@/components/BirdLogo";
import {
  clearManagedWallet,
  loadMerchantConfig,
  loadMerchantSecret,
  MerchantConfig,
} from "@/lib/wallet";
import { useMerchantBalance } from "@/lib/balance";
import { formatUsd, useSolUsd } from "@/lib/usd";
import { sendSol, sendUsdc, sweepAll, SendResult } from "@/lib/tx";

type Tab = "receive" | "send" | "sweep" | "backup";

export default function WalletPage() {
  const router = useRouter();
  const [merchant, setMerchant] = useState<MerchantConfig | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("receive");

  useEffect(() => {
    const cfg = loadMerchantConfig();
    if (!cfg || !cfg.pubkey) {
      router.replace("/");
      return;
    }
    setMerchant(cfg);
    if (cfg.managed) {
      const stored = loadMerchantSecret();
      setSecret(stored?.secretBase58 ?? null);
    }
  }, [router]);

  if (!merchant) return null;

  const truncated = `${merchant.pubkey.slice(0, 6)}…${merchant.pubkey.slice(-4)}`;
  const canSign = Boolean(secret);

  return (
    <main className="min-h-screen px-5 py-6 max-w-xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BirdLogo size={36} />
          <div>
            <h1 className="text-lg font-extrabold leading-tight">Wallet</h1>
            <p className="font-mono text-[11px] text-[var(--color-ink-soft)]">
              {merchant.name} · {truncated}
            </p>
          </div>
        </div>
        <button
          onClick={() => router.push("/terminal")}
          className="text-xs text-[var(--color-ink-soft)] font-semibold underline"
        >
          ← Back to terminal
        </button>
      </header>

      <Tabs value={tab} onChange={setTab} />

      <div className="mt-5">
        {tab === "receive" && <ReceivePanel pubkey={merchant.pubkey} />}
        {tab === "send" && (
          <SendPanel
            pubkey={merchant.pubkey}
            secret={secret}
            canSign={canSign}
          />
        )}
        {tab === "sweep" && (
          <SweepPanel
            pubkey={merchant.pubkey}
            secret={secret}
            canSign={canSign}
          />
        )}
        {tab === "backup" && (
          <BackupPanel secret={secret} canSign={canSign} />
        )}
      </div>

      <SignOutCard
        pubkey={merchant.pubkey}
        managed={Boolean(secret)}
        onSignedOut={() => router.replace("/")}
      />
    </main>
  );
}

function SignOutCard({
  pubkey,
  managed,
  onSignedOut,
}: {
  pubkey: string;
  managed: boolean;
  onSignedOut: () => void;
}) {
  const b = useMerchantBalance(pubkey);
  const solUsd = useSolUsd();
  const [confirming, setConfirming] = useState(false);

  const totalUsd =
    (b.usdc ?? 0) + (b.sol === null ? 0 : b.sol * solUsd);
  const hasFunds = totalUsd > 0.01;

  const handleSignOut = () => {
    clearManagedWallet();
    onSignedOut();
  };

  return (
    <div className="card-ios p-5 mt-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-extrabold uppercase tracking-wider text-[var(--color-ink-soft)]">
            Sign out
          </div>
          <p className="text-[11px] text-[var(--color-ink-soft)] mt-1 leading-relaxed">
            Disconnects this wallet from the device. The on-chain wallet
            keeps existing — you can come back to it with your backup.
          </p>
        </div>
        {!confirming && (
          <button
            onClick={() => setConfirming(true)}
            className="btn-pop px-4 py-2.5 text-sm font-extrabold shrink-0"
            style={{
              background: "var(--color-paper-deep)",
              color: "var(--color-ink)",
              border: "1px solid var(--color-border)",
            }}
          >
            Sign out
          </button>
        )}
      </div>

      {confirming && (
        <div className="mt-4 space-y-3">
          {managed && hasFunds && (
            <div
              className="rounded-2xl p-3 border"
              style={{
                background: "rgba(255, 90, 90, 0.08)",
                borderColor: "rgba(255, 90, 90, 0.4)",
              }}
            >
              <div className="text-sm font-extrabold text-[var(--color-ink)]">
                ⚠ This wallet holds {formatUsd(totalUsd)}
              </div>
              <p className="text-[11px] text-[var(--color-ink-soft)] mt-1 leading-relaxed">
                Save your backup (Backup tab) or sweep funds out (Sweep tab)
                first. Otherwise you lose access to the money on this
                device. The keys aren't backed up anywhere else.
              </p>
            </div>
          )}
          {managed && !hasFunds && (
            <p className="text-xs text-[var(--color-ink-soft)] leading-relaxed">
              This wallet is empty. Signing out just clears the keys from
              this browser — safe to do.
            </p>
          )}
          {!managed && (
            <p className="text-xs text-[var(--color-ink-soft)] leading-relaxed">
              You're connected to an external wallet. Signing out just
              forgets the address on this device. Your actual wallet is
              unaffected.
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setConfirming(false)}
              className="btn-pop flex-1 py-3 text-sm font-extrabold bg-[var(--color-paper-deep)] border border-[var(--color-border)]"
            >
              Cancel
            </button>
            <button
              onClick={handleSignOut}
              className="btn-pop flex-1 py-3 text-sm font-extrabold"
              style={{
                background: "var(--color-red)",
                color: "#FFFFFF",
              }}
            >
              Sign out anyway
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tabs({
  value,
  onChange,
}: {
  value: Tab;
  onChange: (t: Tab) => void;
}) {
  const items: { id: Tab; label: string; emoji: string }[] = [
    { id: "receive", label: "Receive", emoji: "↓" },
    { id: "send", label: "Send", emoji: "↑" },
    { id: "sweep", label: "Sweep", emoji: "✈" },
    { id: "backup", label: "Backup", emoji: "🔐" },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className="btn-pop px-3 py-3 text-sm font-extrabold"
            style={{
              background: active
                ? "var(--color-accent)"
                : "var(--color-paper-deep)",
              color: active ? "#0A0D11" : "var(--color-ink)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div className="text-base mb-0.5">{it.emoji}</div>
            <div className="text-[11px] tracking-wider">{it.label}</div>
          </button>
        );
      })}
    </div>
  );
}

function ReceivePanel({ pubkey }: { pubkey: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pubkey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="card-ios p-6 space-y-5">
      <div>
        <div className="text-xs font-extrabold uppercase tracking-wider text-[var(--color-ink-soft)]">
          Your Solana address
        </div>
        <p className="text-sm text-[var(--color-ink-soft)] mt-1.5">
          Share this QR — any Solana wallet (Phantom, Solflare, an exchange)
          can send SOL or USDC to it.
        </p>
      </div>

      <div className="bg-white rounded-2xl p-4 flex items-center justify-center">
        <QRCodeSVG value={pubkey} size={200} level="M" />
      </div>

      <div className="bg-[var(--color-paper-deep)] rounded-2xl p-3 border border-[var(--color-border)]">
        <div className="font-mono text-xs break-all">{pubkey}</div>
      </div>

      <button onClick={copy} className="btn-pop w-full py-3 text-sm font-extrabold"
        style={{
          background: "var(--color-paper-high)",
          color: "var(--color-ink)",
          border: "1px solid var(--color-border)",
        }}>
        {copied ? "✓ Copied" : "Copy address"}
      </button>

      <p className="text-[11px] text-[var(--color-ink-muted)] leading-relaxed">
        Devnet only — accept devnet SOL and devnet USDC ({" "}
        <span className="font-mono">4zMMC9srt5Ri…JDncDU</span>). Don't send
        mainnet funds.
      </p>
    </div>
  );
}

function SendPanel({
  pubkey,
  secret,
  canSign,
}: {
  pubkey: string;
  secret: string | null;
  canSign: boolean;
}) {
  const b = useMerchantBalance(pubkey);
  const solUsd = useSolUsd();
  const [asset, setAsset] = useState<"USDC" | "SOL">("USDC");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  if (!canSign) {
    return (
      <div className="card-ios p-6 text-sm text-[var(--color-ink-soft)]">
        You're using an external wallet — sign and send from there. Chirp
        doesn't hold your keys.
      </div>
    );
  }

  const parsedAmount = parseFloat(amount);
  const usdEstimate =
    Number.isFinite(parsedAmount) && parsedAmount > 0
      ? asset === "USDC"
        ? parsedAmount
        : parsedAmount * solUsd
      : null;
  const available =
    asset === "USDC" ? (b.usdc ?? 0) : (b.sol ?? 0);

  const handleSend = async () => {
    if (!secret) return;
    setError(null);
    setResult(null);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (parsedAmount > available) {
      setError(`Not enough ${asset} — you have ${available.toFixed(asset === "USDC" ? 2 : 4)}.`);
      return;
    }
    setBusy(true);
    try {
      const res =
        asset === "USDC"
          ? await sendUsdc({
              fromSecretBase58: secret,
              toAddress: recipient.trim(),
              amountUsdc: parsedAmount,
            })
          : await sendSol({
              fromSecretBase58: secret,
              toAddress: recipient.trim(),
              amountSol: parsedAmount,
            });
      setResult(res);
      setAmount("");
      b.refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-ios p-6 space-y-5">
      <div>
        <div className="text-xs font-extrabold uppercase tracking-wider text-[var(--color-ink-soft)]">
          Send funds
        </div>
        <p className="text-sm text-[var(--color-ink-soft)] mt-1.5">
          You can send to any Solana address — another wallet you own, an
          exchange deposit address, anyone.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <AssetTile
          label="USDC"
          balance={b.usdc}
          usd={b.usdc}
          places={2}
          active={asset === "USDC"}
          onClick={() => setAsset("USDC")}
        />
        <AssetTile
          label="SOL"
          balance={b.sol}
          usd={b.sol === null ? null : b.sol * solUsd}
          places={4}
          active={asset === "SOL"}
          onClick={() => setAsset("SOL")}
        />
      </div>

      <Field label="Recipient address">
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
          placeholder="4Nd1mZpxd5kdRq8QhbJu5J8vh2YnMGn3RzJiUjkPMvrK"
          className="w-full bg-[var(--color-paper-deep)] border border-[var(--color-border)] rounded-2xl px-4 py-3 focus:outline-none focus:border-[var(--color-accent)] font-mono text-xs"
        />
      </Field>

      <Field label={`Amount (${asset})`}>
        <div className="flex gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            type="number"
            step="0.0001"
            min="0"
            className="flex-1 bg-[var(--color-paper-deep)] border border-[var(--color-border)] rounded-2xl px-4 py-3 focus:outline-none focus:border-[var(--color-accent)] font-semibold"
          />
          <button
            onClick={() =>
              setAmount(available.toFixed(asset === "USDC" ? 2 : 4))
            }
            className="btn-pop px-4 text-xs font-extrabold bg-[var(--color-paper-deep)] border border-[var(--color-border)]"
          >
            MAX
          </button>
        </div>
        <div className="text-[11px] text-[var(--color-ink-soft)] mt-1.5 font-semibold">
          {usdEstimate !== null && `≈ ${formatUsd(usdEstimate)} · `}
          balance: {available.toFixed(asset === "USDC" ? 2 : 4)} {asset}
        </div>
      </Field>

      {error && (
        <p className="text-[var(--color-red)] text-sm font-semibold">{error}</p>
      )}
      {result && (
        <div
          className="rounded-2xl p-4 border"
          style={{
            background: "rgba(76, 217, 100, 0.08)",
            borderColor: "rgba(76, 217, 100, 0.4)",
          }}
        >
          <div className="text-sm font-extrabold">✓ Sent</div>
          <a
            href={result.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-mono underline break-all text-[var(--color-ink-soft)]"
          >
            View on Solana Explorer
          </a>
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={busy || !recipient || !amount}
        className="btn-pop w-full py-4 text-lg disabled:opacity-50"
        style={{
          background: "var(--color-accent)",
          color: "#0A0D11",
          boxShadow:
            "0 10px 28px rgba(255, 180, 74, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
        }}
      >
        {busy ? "Signing & sending…" : `Send ${asset}`}
      </button>
    </div>
  );
}

function SweepPanel({
  pubkey,
  secret,
  canSign,
}: {
  pubkey: string;
  secret: string | null;
  canSign: boolean;
}) {
  const b = useMerchantBalance(pubkey);
  const solUsd = useSolUsd();
  const [dest, setDest] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  if (!canSign) {
    return (
      <div className="card-ios p-6 text-sm text-[var(--color-ink-soft)]">
        Not applicable — Chirp doesn't hold your keys.
      </div>
    );
  }

  const totalUsd =
    (b.usdc ?? 0) + (b.sol === null ? 0 : b.sol * solUsd);

  const ready =
    confirmText === "SWEEP" &&
    dest.length > 30 &&
    !busy;

  const handleSweep = async () => {
    if (!secret || !ready) return;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await sweepAll({
        fromSecretBase58: secret,
        toAddress: dest.trim(),
      });
      setResult(res);
      setConfirmText("");
      b.refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-ios p-6 space-y-5">
      <div>
        <div className="text-xs font-extrabold uppercase tracking-wider text-[var(--color-ink-soft)]">
          Exit ramp
        </div>
        <p className="text-sm text-[var(--color-ink-soft)] mt-1.5">
          One transaction moves <strong className="text-[var(--color-ink)]">every dollar</strong>{" "}
          from this wallet to a destination address. Use this to move funds to
          Phantom, an exchange, or any wallet you trust long-term.
        </p>
      </div>

      <div
        className="rounded-2xl p-4 border"
        style={{
          background: "rgba(255, 180, 74, 0.06)",
          borderColor: "rgba(255, 180, 74, 0.28)",
        }}
      >
        <div className="text-xs font-extrabold uppercase tracking-wider text-[var(--color-ink)]">
          Currently in wallet
        </div>
        <div className="font-display text-4xl text-[var(--color-ink)] mt-2 leading-none">
          {formatUsd(totalUsd)}
        </div>
        <div className="text-xs text-[var(--color-ink-soft)] mt-2 font-semibold">
          {(b.sol ?? 0).toFixed(4)} SOL + {(b.usdc ?? 0).toFixed(2)} USDC
        </div>
      </div>

      <Field label="Destination address">
        <input
          value={dest}
          onChange={(e) => setDest(e.target.value.trim())}
          placeholder="Paste a Phantom / Solflare / exchange address"
          className="w-full bg-[var(--color-paper-deep)] border border-[var(--color-border)] rounded-2xl px-4 py-3 focus:outline-none focus:border-[var(--color-accent)] font-mono text-xs"
        />
      </Field>

      <Field label='Type "SWEEP" to confirm'>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
          placeholder="SWEEP"
          className="w-full bg-[var(--color-paper-deep)] border border-[var(--color-border)] rounded-2xl px-4 py-3 focus:outline-none focus:border-[var(--color-accent)] font-bold tracking-wider"
        />
      </Field>

      {error && (
        <p className="text-[var(--color-red)] text-sm font-semibold">{error}</p>
      )}
      {result && (
        <div
          className="rounded-2xl p-4 border"
          style={{
            background: "rgba(76, 217, 100, 0.08)",
            borderColor: "rgba(76, 217, 100, 0.4)",
          }}
        >
          <div className="text-sm font-extrabold">✓ Swept</div>
          <a
            href={result.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-mono underline break-all text-[var(--color-ink-soft)]"
          >
            View on Solana Explorer
          </a>
        </div>
      )}

      <button
        onClick={handleSweep}
        disabled={!ready}
        className="btn-pop w-full py-4 text-lg disabled:opacity-50"
        style={{
          background: "var(--color-red)",
          color: "#FFFFFF",
        }}
      >
        {busy ? "Sweeping…" : `Sweep everything to destination`}
      </button>

      <p className="text-[11px] text-[var(--color-ink-muted)] leading-relaxed">
        After this completes, your Chirp wallet will be empty. The wallet
        keypair stays on this device so you can keep using the terminal — new
        payments will land here again.
      </p>
    </div>
  );
}

function BackupPanel({
  secret,
  canSign,
}: {
  secret: string | null;
  canSign: boolean;
}) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!canSign || !secret) {
    return (
      <div className="card-ios p-6 text-sm text-[var(--color-ink-soft)]">
        Not applicable — this device is connected to an external wallet, not
        a Chirp-managed wallet.
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="card-ios p-6 space-y-5">
      <div>
        <div className="text-xs font-extrabold uppercase tracking-wider text-[var(--color-ink-soft)]">
          Private key backup
        </div>
        <p className="text-sm text-[var(--color-ink-soft)] mt-1.5">
          This base58 string controls the wallet. Save it somewhere safe —
          a password manager works. You can also import it into Phantom or
          Solflare under <em>"Import private key"</em> to use this wallet
          there.
        </p>
      </div>

      <div
        className="rounded-2xl p-4 border"
        style={{
          background: "rgba(255, 200, 0, 0.06)",
          borderColor: "rgba(255, 200, 0, 0.28)",
        }}
      >
        <div className="text-sm font-extrabold">⚠ Treat this like a password</div>
        <p className="text-xs text-[var(--color-ink-soft)] mt-1 leading-relaxed">
          Anyone with this string controls every cent in the wallet. Don't
          paste it in chat, email, or any web form except a real wallet's
          import screen.
        </p>
      </div>

      {!reveal ? (
        <button
          onClick={() => setReveal(true)}
          className="btn-pop w-full py-3 text-sm font-extrabold"
          style={{
            background: "var(--color-paper-high)",
            color: "var(--color-ink)",
            border: "1px solid var(--color-border)",
          }}
        >
          Show backup
        </button>
      ) : (
        <>
          <div className="font-mono text-[11px] break-all bg-[var(--color-paper-deep)] rounded-2xl p-4 border border-[var(--color-border)] text-[var(--color-ink)]">
            {secret}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setReveal(false)}
              className="btn-pop flex-1 py-3 text-sm font-extrabold bg-[var(--color-paper-deep)] border border-[var(--color-border)]"
            >
              Hide
            </button>
            <button
              onClick={copy}
              className="btn-pop flex-1 py-3 text-sm font-extrabold"
              style={{
                background: "var(--color-accent)",
                color: "#0A0D11",
              }}
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--color-ink-soft)] mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function AssetTile({
  label,
  balance,
  usd,
  places,
  active,
  onClick,
}: {
  label: string;
  balance: number | null;
  usd: number | null;
  places: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="btn-pop p-4 text-left"
      style={{
        background: active ? "var(--color-accent)" : "var(--color-paper-deep)",
        color: active ? "#0A0D11" : "var(--color-ink)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="text-[10px] font-extrabold uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="font-display text-2xl leading-none mt-1">
        {balance === null
          ? "—"
          : balance.toLocaleString(undefined, {
              minimumFractionDigits: places,
              maximumFractionDigits: places,
            })}
      </div>
      <div className="text-[11px] font-semibold opacity-70 mt-1.5">
        {usd === null ? "—" : formatUsd(usd)}
      </div>
    </button>
  );
}
