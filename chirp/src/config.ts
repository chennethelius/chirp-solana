const CLUSTER_DEFAULTS: Record<string, string> = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

const CLUSTER =
  process.env.EXPO_PUBLIC_CHIRP_CLUSTER ?? "devnet";

export const CHIRP_CONFIG = {
  relayBaseUrl:
    process.env.EXPO_PUBLIC_CHIRP_RELAY_URL ?? "http://10.0.2.2:8787",
  chirpChannelId: process.env.EXPO_PUBLIC_CHIRP_CHANNEL ?? "demo",
  cluster: CLUSTER,
  heliusRpc:
    process.env.EXPO_PUBLIC_HELIUS_RPC ??
    CLUSTER_DEFAULTS[CLUSTER] ??
    CLUSTER_DEFAULTS.devnet,
};
