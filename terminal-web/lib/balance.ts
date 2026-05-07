import { useEffect, useRef, useState } from "react";
import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { CONFIG } from "./config";

const USDC_DEVNET_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

const POLL_MS = 12_000;

export type MerchantBalance = {
  sol: number | null;
  usdc: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

// Fetches the cashier's wallet balance (SOL + USDC) and polls every 12s.
// All-public devnet RPC is fine — these calls are cheap and read-only.
export function useMerchantBalance(pubkey: string | null): MerchantBalance {
  const [sol, setSol] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef(0);

  const fetchAll = async () => {
    if (!pubkey) return;
    let owner: PublicKey;
    try {
      owner = new PublicKey(pubkey);
    } catch {
      setError("Invalid wallet address.");
      return;
    }
    const myTick = ++tickRef.current;
    setLoading(true);
    try {
      const connection = new Connection(CONFIG.rpcUrl, "confirmed");
      const lamports = await connection.getBalance(owner, "confirmed");
      if (myTick === tickRef.current) setSol(lamports / 1_000_000_000);

      try {
        const ata = await getAssociatedTokenAddress(USDC_DEVNET_MINT, owner);
        const acct = await connection.getTokenAccountBalance(ata, "confirmed");
        if (myTick === tickRef.current) {
          setUsdc(Number(acct.value.uiAmountString ?? acct.value.uiAmount ?? 0));
        }
      } catch {
        if (myTick === tickRef.current) setUsdc(0);
      }
      if (myTick === tickRef.current) setError(null);
    } catch (e: any) {
      if (myTick === tickRef.current) setError(String(e?.message ?? e));
    } finally {
      if (myTick === tickRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!pubkey) {
      setSol(null);
      setUsdc(null);
      return;
    }
    fetchAll();
    const id = setInterval(fetchAll, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey]);

  return { sol, usdc, loading, error, refresh: fetchAll };
}

// Lightweight ATA derivation (avoids importing the full @solana/spl-token bundle
// into the client). Mirrors getAssociatedTokenAddressSync from spl-token.
async function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const TOKEN_PROGRAM_ID = new PublicKey(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  );
  const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  );
  const [address] = await PublicKey.findProgramAddress(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return address;
}
