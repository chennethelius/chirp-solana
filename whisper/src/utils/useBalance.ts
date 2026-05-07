import { useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useConnection } from "./ConnectionProvider";
import { useAuthorization } from "./useAuthorization";
import { USDC_DEVNET_MINT } from "../services/payment";

export type Balance = {
  sol: number | null; // in SOL units
  usdc: number | null; // in USDC units (6 decimals)
  loading: boolean;
  error?: string;
  refresh: () => void;
};

const POLL_MS = 12_000;

// Polls SOL + USDC ATA balances for the connected wallet. Numbers, not
// micro-units — friendly for display. Both are nullable so the UI can show
// a skeleton state on first paint instead of "0.0000".
export function useBalance(): Balance {
  const { selectedAccount } = useAuthorization();
  const { connection } = useConnection();
  const [sol, setSol] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const tickRef = useRef(0);

  const fetchAll = async () => {
    if (!selectedAccount) return;
    const myTick = ++tickRef.current;
    setLoading(true);
    try {
      const owner = selectedAccount.publicKey;
      const lamports = await connection.getBalance(owner, "confirmed");
      if (myTick === tickRef.current) setSol(lamports / 1_000_000_000);

      try {
        const ata = getAssociatedTokenAddressSync(USDC_DEVNET_MINT, owner);
        const acct = await connection.getTokenAccountBalance(ata, "confirmed");
        if (myTick === tickRef.current) {
          setUsdc(Number(acct.value.uiAmountString ?? acct.value.uiAmount ?? 0));
        }
      } catch {
        // No USDC ATA yet — display 0 rather than null.
        if (myTick === tickRef.current) setUsdc(0);
      }
      if (myTick === tickRef.current) setError(undefined);
    } catch (e: any) {
      if (myTick === tickRef.current) setError(String(e?.message ?? e));
    } finally {
      if (myTick === tickRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedAccount) {
      setSol(null);
      setUsdc(null);
      return;
    }
    fetchAll();
    const id = setInterval(fetchAll, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount?.publicKey.toBase58(), connection]);

  return {
    sol,
    usdc,
    loading,
    error,
    refresh: fetchAll,
  };
}
