import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from "@solana/spl-token";
import bs58 from "bs58";
import { CONFIG } from "./config";

export const USDC_DEVNET_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

function keypairFromBase58(secretBase58: string): Keypair {
  const bytes = bs58.decode(secretBase58);
  return Keypair.fromSecretKey(bytes);
}

function isValidPubkey(addr: string): PublicKey | null {
  try {
    return new PublicKey(addr);
  } catch {
    return null;
  }
}

// Reserve a little SOL for rent + fees on a sweep. Anything below this on a
// "send all SOL" turns into "transaction will fail" — leave a buffer.
const SOL_FEE_BUFFER_LAMPORTS = 5_000;

export type SendResult = {
  signature: string;
  explorerUrl: string;
};

function explorerUrl(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export async function sendSol(args: {
  fromSecretBase58: string;
  toAddress: string;
  amountSol: number;
}): Promise<SendResult> {
  const to = isValidPubkey(args.toAddress);
  if (!to) throw new Error("Recipient address isn't a valid Solana wallet.");
  if (!Number.isFinite(args.amountSol) || args.amountSol <= 0)
    throw new Error("Amount must be greater than zero.");

  const payer = keypairFromBase58(args.fromSecretBase58);
  const lamports = Math.round(args.amountSol * 1_000_000_000);
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: to,
      lamports,
    }),
  );
  const sig = await sendTx(connection, tx, payer);
  return { signature: sig, explorerUrl: explorerUrl(sig) };
}

export async function sendUsdc(args: {
  fromSecretBase58: string;
  toAddress: string;
  amountUsdc: number;
}): Promise<SendResult> {
  const to = isValidPubkey(args.toAddress);
  if (!to) throw new Error("Recipient address isn't a valid Solana wallet.");
  if (!Number.isFinite(args.amountUsdc) || args.amountUsdc <= 0)
    throw new Error("Amount must be greater than zero.");

  const payer = keypairFromBase58(args.fromSecretBase58);
  const amountMicros = BigInt(Math.round(args.amountUsdc * 1_000_000));
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");

  const sourceAta = getAssociatedTokenAddressSync(
    USDC_DEVNET_MINT,
    payer.publicKey,
  );
  const destAta = getAssociatedTokenAddressSync(USDC_DEVNET_MINT, to);

  const tx = new Transaction();
  if (!(await ataExists(connection, destAta))) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        destAta,
        to,
        USDC_DEVNET_MINT,
      ),
    );
  }
  tx.add(
    createTransferInstruction(sourceAta, destAta, payer.publicKey, amountMicros),
  );

  const sig = await sendTx(connection, tx, payer);
  return { signature: sig, explorerUrl: explorerUrl(sig) };
}

// Drains SOL + USDC to a destination address. Builds the appropriate
// instructions into one transaction when possible. Leaves a 5,000-lamport
// buffer on SOL so the tx can pay its own fee.
export async function sweepAll(args: {
  fromSecretBase58: string;
  toAddress: string;
}): Promise<SendResult> {
  const to = isValidPubkey(args.toAddress);
  if (!to) throw new Error("Destination address isn't a valid Solana wallet.");

  const payer = keypairFromBase58(args.fromSecretBase58);
  const connection = new Connection(CONFIG.rpcUrl, "confirmed");

  const lamports = await connection.getBalance(payer.publicKey, "confirmed");
  const sourceAta = getAssociatedTokenAddressSync(
    USDC_DEVNET_MINT,
    payer.publicKey,
  );
  let usdcAmount = BigInt(0);
  try {
    const acct = await getAccount(connection, sourceAta);
    usdcAmount = acct.amount;
  } catch (e) {
    if (
      !(e instanceof TokenAccountNotFoundError) &&
      !(e instanceof TokenInvalidAccountOwnerError)
    ) {
      throw e;
    }
  }

  if (lamports <= SOL_FEE_BUFFER_LAMPORTS && usdcAmount === BigInt(0)) {
    throw new Error("Wallet is empty — nothing to sweep.");
  }

  const tx = new Transaction();

  if (usdcAmount > BigInt(0)) {
    const destAta = getAssociatedTokenAddressSync(USDC_DEVNET_MINT, to);
    if (!(await ataExists(connection, destAta))) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          destAta,
          to,
          USDC_DEVNET_MINT,
        ),
      );
    }
    tx.add(
      createTransferInstruction(sourceAta, destAta, payer.publicKey, usdcAmount),
    );
  }

  // SOL goes last so the transfer reflects the post-token-fees balance.
  // The fee buffer is a flat 5,000 lamports — generous enough for the worst
  // case (one ATA create + one token transfer + one system transfer).
  const sendableLamports = Math.max(0, lamports - SOL_FEE_BUFFER_LAMPORTS);
  if (sendableLamports > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: to,
        lamports: sendableLamports,
      }),
    );
  }

  const sig = await sendTx(connection, tx, payer);
  return { signature: sig, explorerUrl: explorerUrl(sig) };
}

async function ataExists(
  connection: Connection,
  ata: PublicKey,
): Promise<boolean> {
  try {
    await getAccount(connection, ata);
    return true;
  } catch (e) {
    if (
      e instanceof TokenAccountNotFoundError ||
      e instanceof TokenInvalidAccountOwnerError
    ) {
      return false;
    }
    throw e;
  }
}

async function sendTx(
  connection: Connection,
  tx: Transaction,
  payer: Keypair,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);

  const raw = tx.serialize();
  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}
