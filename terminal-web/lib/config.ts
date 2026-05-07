export const CONFIG = {
  relayBaseUrl:
    process.env.NEXT_PUBLIC_WHISPER_RELAY_URL ?? "http://localhost:8787",
  rpcUrl:
    process.env.NEXT_PUBLIC_HELIUS_RPC ?? "https://api.devnet.solana.com",
};
