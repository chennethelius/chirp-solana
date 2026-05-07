import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

const KEY = "chirp.receipts.v1";
const MAX = 100;

export type Receipt = {
  signature: string;
  amount: string; // pretty-formatted, e.g. "5.50 USDC"
  amountMicros: string;
  token: "SOL" | "USDC";
  merchantName?: string;
  merchantPubkey: string;
  itemName?: string;
  itemEmoji?: string;
  cluster: string;
  ts: number;
};

async function read(): Promise<Receipt[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Receipt[];
  } catch {
    return [];
  }
}

async function write(list: Receipt[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {}
}

// Append a new receipt. Idempotent on signature — duplicate ack-paid calls
// won't double-record.
export async function recordReceipt(r: Receipt): Promise<void> {
  const cur = await read();
  if (cur.some((x) => x.signature === r.signature)) return;
  await write([r, ...cur]);
}

export async function clearReceipts(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

// React hook with live refetch on every focus + a manual refresh fn.
export function useReceipts(): {
  receipts: Receipt[];
  loading: boolean;
  refresh: () => Promise<void>;
  clear: () => Promise<void>;
} {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const list = await read();
    setReceipts(list);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const clear = async () => {
    await clearReceipts();
    await refresh();
  };

  return { receipts, loading, refresh, clear };
}
