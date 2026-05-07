"use client";
import { useMerchantBalance } from "@/lib/balance";

function fmt(n: number | null, places: number): string {
  if (n === null) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

export function BalanceHero({ pubkey }: { pubkey: string }) {
  const b = useMerchantBalance(pubkey);
  return (
    <div
      onClick={b.refresh}
      role="button"
      className="card-glass-tint p-6 cursor-pointer transition active:scale-[0.99]"
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold tracking-[0.18em] text-[var(--color-ink-soft)] uppercase">
          Balance
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={`w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] ${
              b.loading ? "animate-pulse" : ""
            }`}
          />
          <div className="text-[10px] font-semibold tracking-[0.18em] text-[var(--color-ink-muted)] uppercase">
            Devnet
          </div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-6">
        <div>
          <div className="font-display text-5xl text-[var(--color-ink)] leading-none">
            {fmt(b.sol, 4)}
          </div>
          <div className="text-[10px] font-semibold tracking-[0.2em] text-[var(--color-ink-muted)] mt-2 uppercase">
            SOL
          </div>
        </div>
        <div className="border-l border-white/[0.06] pl-6">
          <div className="font-display text-5xl text-[var(--color-ink)] leading-none">
            {fmt(b.usdc, 2)}
          </div>
          <div className="text-[10px] font-semibold tracking-[0.2em] text-[var(--color-ink-muted)] mt-2 uppercase">
            USDC
          </div>
        </div>
      </div>
      {b.error && (
        <div className="mt-3 text-xs text-[var(--color-red)]">{b.error}</div>
      )}
    </div>
  );
}
