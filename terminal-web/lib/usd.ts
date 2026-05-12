"use client";
import { useEffect, useState } from "react";

const CACHE_KEY = "chirp.solUsd";
const CACHE_TTL_MS = 5 * 60 * 1000;
const FALLBACK_PRICE = 180;

type Cached = { price: number; at: number };

function readCache(): Cached | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    if (typeof c?.price !== "number" || typeof c?.at !== "number") return null;
    return c;
  } catch {
    return null;
  }
}

function writeCache(price: number) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ price, at: Date.now() } satisfies Cached),
    );
  } catch {}
}

async function fetchSolUsd(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const j = (await res.json()) as { solana?: { usd?: number } };
  const p = j?.solana?.usd;
  if (typeof p !== "number" || !isFinite(p) || p <= 0) {
    throw new Error("bad price payload");
  }
  return p;
}

// Hook returns a SOL→USD price. Seeds from a localStorage cache so the
// first render is never empty, refetches in the background, and falls back
// to a sane mainnet number if the network is offline. Demo-grade by design.
export function useSolUsd(): number {
  const cached = typeof window !== "undefined" ? readCache() : null;
  const [price, setPrice] = useState<number>(cached?.price ?? FALLBACK_PRICE);

  useEffect(() => {
    const c = readCache();
    if (c && Date.now() - c.at < CACHE_TTL_MS) {
      setPrice(c.price);
      return;
    }
    let alive = true;
    fetchSolUsd()
      .then((p) => {
        if (!alive) return;
        setPrice(p);
        writeCache(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return price;
}

export function solToUsd(sol: number, solUsd: number): number {
  return sol * solUsd;
}

export function usdToSol(usd: number, solUsd: number): number {
  if (solUsd <= 0) return 0;
  return usd / solUsd;
}

export function formatUsd(n: number): string {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
