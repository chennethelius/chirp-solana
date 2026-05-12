"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BirdLogo } from "@/components/BirdLogo";
import {
  clearManagedWallet,
  generateManagedWallet,
  isLikelySolanaPubkey,
  loadMerchantConfig,
  loadMerchantSecret,
  saveMerchantConfig,
  WalletStorageError,
} from "@/lib/wallet";

type Mode = "choice" | "create" | "paste" | "review";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choice");
  const [name, setName] = useState("");
  const [pubkey, setPubkey] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [revealSecret, setRevealSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cfg = loadMerchantConfig();
    if (cfg && cfg.pubkey) {
      setName(cfg.name);
      setPubkey(cfg.pubkey);
      const stored = loadMerchantSecret();
      if (cfg.managed && stored) setSecret(stored.secretBase58);
      setMode("review");
    }
  }, []);

  const goCreate = () => {
    setError(null);
    setRevealSecret(false);
    try {
      const { pubkey: pk, secretBase58 } = generateManagedWallet();
      setPubkey(pk);
      setSecret(secretBase58);
      setMode("create");
    } catch (e) {
      if (e instanceof WalletStorageError) {
        setError(e.message);
      } else {
        setError("Couldn't create a wallet on this device. Try a different browser.");
      }
    }
  };

  const goPaste = () => {
    setError(null);
    setSecret(null);
    setPubkey("");
    setMode("paste");
  };

  const finishCreate = () => {
    if (!name.trim()) {
      setError("Give your shop a name first.");
      return;
    }
    saveMerchantConfig({ pubkey, name: name.trim(), managed: true });
    router.push("/terminal");
  };

  const finishPaste = () => {
    if (!isLikelySolanaPubkey(pubkey)) {
      setError("That doesn't look like a Solana wallet address.");
      return;
    }
    if (!name.trim()) {
      setError("Give your shop a name first.");
      return;
    }
    saveMerchantConfig({ pubkey, name: name.trim(), managed: false });
    router.push("/terminal");
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <header className="flex flex-col items-center text-center mb-8">
          <div className="drift">
            <BirdLogo size={120} />
          </div>
          <h1 className="font-display text-6xl mt-5 text-[var(--color-ink)] leading-none">
            Chirp
          </h1>
          <p className="text-[var(--color-ink-soft)] mt-3 text-sm">
            Get paid by sound.
          </p>
          {mode === "choice" && (
            <p className="text-[var(--color-ink-muted)] mt-4 text-xs leading-relaxed max-w-xs">
              No card reader, no app install for customers. Set up takes 20
              seconds — even if you've never touched crypto.
            </p>
          )}
        </header>

        {mode === "choice" && (
          <>
            <ChoiceCard onCreate={goCreate} onPaste={goPaste} />
            {error && (
              <div
                className="mt-4 rounded-2xl p-4 border"
                style={{
                  background: "rgba(255, 90, 90, 0.08)",
                  borderColor: "rgba(255, 90, 90, 0.4)",
                }}
              >
                <p className="text-sm font-semibold text-[var(--color-ink)]">
                  {error}
                </p>
              </div>
            )}
          </>
        )}

        {mode === "create" && (
          <CreateCard
            name={name}
            setName={setName}
            pubkey={pubkey}
            secret={secret!}
            revealSecret={revealSecret}
            setRevealSecret={setRevealSecret}
            error={error}
            onBack={() => setMode("choice")}
            onContinue={finishCreate}
          />
        )}

        {mode === "paste" && (
          <PasteCard
            name={name}
            setName={setName}
            pubkey={pubkey}
            setPubkey={setPubkey}
            error={error}
            onBack={() => setMode("choice")}
            onContinue={finishPaste}
          />
        )}

        {mode === "review" && (
          <ReviewCard
            name={name}
            pubkey={pubkey}
            managed={Boolean(secret)}
            onEnter={() => router.push("/terminal")}
            onSwitch={() => setMode("choice")}
            onSignOut={() => {
              if (
                confirm(
                  "Sign out and forget this wallet on this device? Save your backup first if it has funds — there's no recovery.",
                )
              ) {
                clearManagedWallet();
                setName("");
                setPubkey("");
                setSecret(null);
                setMode("choice");
              }
            }}
          />
        )}
      </div>
    </main>
  );
}

function ChoiceCard({
  onCreate,
  onPaste,
}: {
  onCreate: () => void;
  onPaste: () => void;
}) {
  return (
    <div className="space-y-4">
      <button
        onClick={onCreate}
        className="btn-pop w-full text-base px-5 py-5 text-left flex items-start gap-4"
        style={{
          background: "var(--color-accent)",
          color: "#0A0D11",
          boxShadow:
            "0 8px 24px rgba(255, 180, 74, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
        }}
      >
        <span className="text-2xl">🐣</span>
        <span className="block">
          <span className="block text-lg font-extrabold">
            Set up in one tap
          </span>
          <span className="block text-sm font-medium opacity-90 mt-0.5">
            Recommended for first-timers. We'll make a wallet for you. No
            sign-ups, no card reader.
          </span>
        </span>
      </button>

      <button
        onClick={onPaste}
        className="btn-pop w-full text-[var(--color-ink)] text-base px-5 py-5 text-left flex items-start gap-4 bg-[var(--color-paper)] border border-[var(--color-border)]"
        style={{ boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.04)" }}
      >
        <span className="text-2xl">🔑</span>
        <span className="block">
          <span className="block text-lg font-extrabold">
            I already have a Solana wallet
          </span>
          <span className="block text-sm font-medium text-[var(--color-ink-soft)] mt-0.5">
            Paste your address. Payments arrive directly — no middlemen.
          </span>
        </span>
      </button>

      <div className="mt-6 px-2 space-y-2">
        <p className="text-xs text-[var(--color-ink-soft)] text-center leading-relaxed">
          Chirp never holds your money. Customers pay you directly in dollars
          (USDC) or SOL — you see the dollar amount on every screen.
        </p>
        <p className="text-[10px] text-[var(--color-ink-muted)] text-center font-semibold tracking-wider uppercase">
          Devnet · demo mode · no real money moves
        </p>
      </div>
    </div>
  );
}

function CreateCard({
  name,
  setName,
  pubkey,
  secret,
  revealSecret,
  setRevealSecret,
  error,
  onBack,
  onContinue,
}: {
  name: string;
  setName: (n: string) => void;
  pubkey: string;
  secret: string;
  revealSecret: boolean;
  setRevealSecret: (b: boolean) => void;
  error: string | null;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="card-ios p-6 space-y-5">
      <Step n={1} label="Name your shop" />
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Blue Bottle Coffee"
        className="w-full bg-[var(--color-paper-deep)] border-2 border-[var(--color-border)] rounded-2xl px-4 py-3 focus:outline-none focus:border-[var(--color-accent)] text-[var(--color-ink)] font-semibold"
      />

      <div className="border-t border-[var(--color-border)] -mx-6 my-2" />

      <Step n={2} label="Your wallet is ready" />
      <div className="bg-[var(--color-paper-deep)] rounded-2xl p-4 border-2 border-[var(--color-border)]">
        <div className="text-xs font-bold text-[var(--color-ink-soft)] uppercase tracking-wider">
          Receiving address
        </div>
        <div className="font-mono text-sm break-all mt-1">{pubkey}</div>
        <p className="text-[11px] text-[var(--color-ink-muted)] mt-2 leading-relaxed">
          Think of this like your IBAN. Customers send to it — you receive
          dollars (USDC) or SOL.
        </p>
      </div>

      <div
        className="border rounded-2xl p-4"
        style={{
          background: "rgba(255, 200, 0, 0.06)",
          borderColor: "rgba(255, 200, 0, 0.28)",
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🔐</span>
          <span className="text-sm font-extrabold text-[var(--color-ink)]">
            Backup phrase (optional, recommended)
          </span>
        </div>
        <p className="text-xs text-[var(--color-ink-soft)] mt-1.5 leading-relaxed">
          Saved on this device. If you ever lose the device, this string lets
          you restore the wallet. Treat it like the PIN to a safe.
        </p>
        <button
          onClick={() => setRevealSecret(!revealSecret)}
          className="mt-3 chip"
          style={{
            background: "var(--color-paper-high)",
            color: "var(--color-ink)",
            borderColor: "var(--color-border-soft)",
          }}
        >
          {revealSecret ? "Hide" : "Show"} my backup
        </button>
        {revealSecret && (
          <div className="font-mono text-[11px] break-all mt-3 bg-[var(--color-paper-deep)] rounded-xl p-3 border border-[var(--color-border)] text-[var(--color-ink)]">
            {secret}
          </div>
        )}
      </div>

      {error && (
        <p className="text-[var(--color-red)] text-sm font-semibold">{error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          onClick={onBack}
          className="btn-pop px-5 py-3 bg-[var(--color-paper)] border border-[var(--color-border)] text-[var(--color-ink)]"
          style={{ boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.04)" }}
        >
          Back
        </button>
        <button
          onClick={onContinue}
          className="btn-pop flex-1 px-5 py-3"
          style={{
            background: "var(--color-accent)",
            color: "#0A0D11",
            boxShadow:
              "0 8px 24px rgba(255, 180, 74, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
          }}
        >
          Open my terminal →
        </button>
      </div>
    </div>
  );
}

function PasteCard({
  name,
  setName,
  pubkey,
  setPubkey,
  error,
  onBack,
  onContinue,
}: {
  name: string;
  setName: (n: string) => void;
  pubkey: string;
  setPubkey: (p: string) => void;
  error: string | null;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="card-ios p-6 space-y-5">
      <Step n={1} label="Your Solana wallet" />
      <input
        autoFocus
        value={pubkey}
        onChange={(e) => setPubkey(e.target.value.trim())}
        placeholder="4Nd1mZpxd5kdRq8QhbJu5J8vh2YnMGn3RzJiUjkPMvrK"
        className="w-full bg-[var(--color-paper)] border border-[var(--color-border)] rounded-2xl px-4 py-3 focus:outline-none focus:border-[var(--color-accent)] font-mono text-sm"
      />

      <Step n={2} label="Shop name" />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Blue Bottle Coffee"
        className="w-full bg-[var(--color-paper)] border border-[var(--color-border)] rounded-2xl px-4 py-3 focus:outline-none focus:border-[var(--color-accent)] font-semibold"
      />

      {error && (
        <p className="text-[var(--color-red)] text-sm font-semibold">{error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          onClick={onBack}
          className="btn-pop px-5 py-3 bg-[var(--color-paper)] border border-[var(--color-border)] text-[var(--color-ink)]"
          style={{ boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.04)" }}
        >
          Back
        </button>
        <button
          onClick={onContinue}
          className="btn-pop flex-1 px-5 py-3"
          style={{
            background: "var(--color-accent)",
            color: "#0A0D11",
            boxShadow:
              "0 8px 24px rgba(255, 180, 74, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
          }}
        >
          Open my terminal →
        </button>
      </div>
    </div>
  );
}

function ReviewCard({
  name,
  pubkey,
  managed,
  onEnter,
  onSwitch,
  onSignOut,
}: {
  name: string;
  pubkey: string;
  managed: boolean;
  onEnter: () => void;
  onSwitch: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="card-ios p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-[var(--color-ink-soft)] uppercase tracking-wider">
          Welcome back
        </div>
        <span className="chip">
          {managed ? "🐣 Managed" : "🔑 External"}
        </span>
      </div>
      <div>
        <div className="text-2xl font-extrabold">{name}</div>
        <div className="font-mono text-xs text-[var(--color-ink-soft)] mt-1 break-all">
          {pubkey}
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <button
          onClick={onSwitch}
          className="btn-pop px-5 py-3 bg-[var(--color-paper)] border border-[var(--color-border)] text-[var(--color-ink)]"
          style={{ boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.04)" }}
        >
          Switch wallet
        </button>
        <button
          onClick={onEnter}
          className="btn-pop flex-1 px-5 py-3"
          style={{
            background: "var(--color-accent)",
            color: "#0A0D11",
            boxShadow:
              "0 8px 24px rgba(255, 180, 74, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
          }}
        >
          Open terminal →
        </button>
      </div>
      <div className="flex justify-center pt-1">
        <button
          onClick={onSignOut}
          className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-red)] font-semibold underline"
        >
          Sign out and forget this wallet
        </button>
      </div>
    </div>
  );
}

function Step({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold text-white"
        style={{ background: "var(--color-accent)" }}
      >
        {n}
      </div>
      <div className="font-extrabold text-sm uppercase tracking-wider text-[var(--color-ink)]">
        {label}
      </div>
    </div>
  );
}
