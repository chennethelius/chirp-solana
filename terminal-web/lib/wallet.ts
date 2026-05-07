import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export const MERCHANT_KEY = "whisper.merchant.config";
export const MERCHANT_SECRET_KEY = "whisper.merchant.secret";

export type MerchantConfig = {
  pubkey: string;
  name: string;
  managed: boolean;
};

export type StoredSecret = {
  secretBase58: string;
  createdAt: number;
};

export function loadMerchantConfig(): MerchantConfig | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(MERCHANT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      pubkey: parsed.pubkey ?? "",
      name: parsed.name ?? "Chirp Merchant",
      managed: Boolean(parsed.managed),
    };
  } catch {
    return null;
  }
}

export function saveMerchantConfig(cfg: MerchantConfig): void {
  localStorage.setItem(MERCHANT_KEY, JSON.stringify(cfg));
}

export function loadMerchantSecret(): StoredSecret | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(MERCHANT_SECRET_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSecret;
  } catch {
    return null;
  }
}

export function generateManagedWallet(): {
  pubkey: string;
  secretBase58: string;
} {
  const kp = Keypair.generate();
  const secretBase58 = bs58.encode(kp.secretKey);
  const pubkey = kp.publicKey.toBase58();
  localStorage.setItem(
    MERCHANT_SECRET_KEY,
    JSON.stringify({ secretBase58, createdAt: Date.now() } as StoredSecret),
  );
  return { pubkey, secretBase58 };
}

export function clearManagedWallet(): void {
  localStorage.removeItem(MERCHANT_SECRET_KEY);
  localStorage.removeItem(MERCHANT_KEY);
}

export function isLikelySolanaPubkey(addr: string): boolean {
  if (addr.length < 32 || addr.length > 44) return false;
  try {
    bs58.decode(addr);
    return true;
  } catch {
    return false;
  }
}
