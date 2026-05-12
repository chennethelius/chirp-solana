"use client";
import { useMerchantBalance } from "@/lib/balance";
import { formatUsd, useSolUsd } from "@/lib/usd";

function fmt(n: number | null, places: number): string {
  if (n === null) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

export function BalanceHero({ pubkey }: { pubkey: string }) {
  const b = useMerchantBalance(pubkey);
  const solUsd = useSolUsd();

  const solValueUsd = b.sol === null ? null : b.sol * solUsd;
  const usdcValueUsd = b.usdc;
  const totalUsd =
    solValueUsd === null && usdcValueUsd === null
      ? null
      : (solValueUsd ?? 0) + (usdcValueUsd ?? 0);

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

      <div className="mt-4">
        <div className="font-display text-6xl text-[var(--color-ink)] leading-none">
          {totalUsd === null ? "—" : formatUsd(totalUsd)}
        </div>
        <div className="text-[10px] font-semibold tracking-[0.2em] text-[var(--color-ink-muted)] mt-2 uppercase">
          Total · USD equivalent
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-6 border-t border-white/[0.06] pt-4">
        <div>
          <div className="font-display text-2xl text-[var(--color-ink)] leading-none">
            {fmt(b.sol, 4)}
            <span className="text-xs text-[var(--color-ink-muted)] ml-1.5 font-sans font-semibold tracking-wide">
              SOL
            </span>
          </div>
          <div className="text-[11px] text-[var(--color-ink-soft)] mt-1.5 font-semibold">
            {solValueUsd === null ? "—" : `≈ ${formatUsd(solValueUsd)}`}
          </div>
        </div>
        <div className="border-l border-white/[0.06] pl-6">
          <div className="font-display text-2xl text-[var(--color-ink)] leading-none">
            {fmt(b.usdc, 2)}
            <span className="text-xs text-[var(--color-ink-muted)] ml-1.5 font-sans font-semibold tracking-wide">
              USDC
            </span>
          </div>
          <div className="text-[11px] text-[var(--color-ink-soft)] mt-1.5 font-semibold">
            {usdcValueUsd === null ? "—" : `≈ ${formatUsd(usdcValueUsd)}`}
          </div>
        </div>
      </div>
      {b.error && (
        <div className="mt-3 text-xs text-[var(--color-red)]">{b.error}</div>
      )}
    </div>
  );
}
