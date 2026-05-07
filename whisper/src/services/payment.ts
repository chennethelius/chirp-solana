import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionSignature,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PaymentIntent } from "./relay";

export const USDC_DEVNET_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

export async function buildPaymentTx(
  connection: Connection,
  payer: PublicKey,
  intent: PaymentIntent,
): Promise<{ tx: Transaction; minContextSlot: number }> {
  const recipient = new PublicKey(intent.recipient);
  const amount = BigInt(intent.amountMicros);

  const tx = new Transaction();

  if (intent.tokenMint) {
    const mint = new PublicKey(intent.tokenMint);
    const fromAta = getAssociatedTokenAddressSync(mint, payer);
    const toAta = getAssociatedTokenAddressSync(mint, recipient);
    tx.add(createTransferInstruction(fromAta, toAta, payer, amount));
  } else {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: recipient,
        lamports: Number(amount),
      }),
    );
  }

  const latest = await connection.getLatestBlockhashAndContext("finalized");
  tx.recentBlockhash = latest.value.blockhash;
  tx.feePayer = payer;
  return { tx, minContextSlot: latest.context.slot };
}

export async function confirmSignature(
  connection: Connection,
  signature: TransactionSignature,
): Promise<boolean> {
  const status = await connection.confirmTransaction(signature, "confirmed");
  return !status.value.err;
}

export function formatAmount(intent: PaymentIntent): string {
  const micros = BigInt(intent.amountMicros);
  if (intent.tokenMint) {
    const whole = Number(micros) / 1_000_000;
    return `${whole.toFixed(2)} USDC`;
  }
  const sol = Number(micros) / 1_000_000_000;
  return `${sol.toFixed(4)} SOL`;
}
