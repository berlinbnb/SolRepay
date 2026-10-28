import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  BATCH_CLOSE_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  LIGHTHOUSE_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants.ts";
import type { TxSummary } from "./log.ts";

export type BuiltBatchClose = {
  transaction: VersionedTransaction;
  n: number;
};

/**
 * Same flat V0 BatchClose the live N1 probe builds:
 * one instruction, discriminator byte 0, no address lookup table,
 * no compute-budget instruction. Authority, then the Token program,
 * then the empty classic ATAs.
 */
export function buildFlatBatchCloseV0(input: {
  authority: string;
  atas: readonly string[];
  recentBlockhash: string;
  programId?: string;
}): BuiltBatchClose {
  if (input.atas.length === 0) throw new Error("atas must be non-empty");
  const authority = new PublicKey(input.authority);
  const atas = input.atas.map((ata) => new PublicKey(ata));
  const programId = new PublicKey(input.programId ?? BATCH_CLOSE_PROGRAM_ID);
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
      ...atas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    ],
    data: Uint8Array.of(0),
  });
  const message = new TransactionMessage({
    payerKey: authority,
    recentBlockhash: input.recentBlockhash,
    instructions: [instruction],
  }).compileToV0Message([]);
  const transaction = new VersionedTransaction(message);
  const serialized = transaction.serialize();
  if (serialized.length > 1232) throw new Error(`packet ${serialized.length} > 1232`);
  return { transaction, n: atas.length };
}

export type TxFacts = TxSummary & {
  lighthouseIx: number;
  version: number | "legacy";
  lookupTables: number;
  discriminator: number | null;
};

export function txFacts(tx: VersionedTransaction): TxFacts {
  const message = tx.message;
  const keys = message.staticAccountKeys;
  const header = message.header;
  const writable = keys.length - header.numReadonlySignedAccounts - header.numReadonlyUnsignedAccounts;
  const programAt = (index: number) => keys[index]?.toBase58() ?? "";
  const cuIx = message.compiledInstructions.some(
    (ix) => programAt(ix.programIdIndex) === COMPUTE_BUDGET_PROGRAM_ID,
  );
  const lighthouseIx = message.compiledInstructions.filter(
    (ix) => programAt(ix.programIdIndex) === LIGHTHOUSE_PROGRAM_ID,
  ).length;
  const first = message.compiledInstructions[0];
  const discriminator = first && first.data.length > 0 ? first.data[0] : null;
  return {
    n: 0,
    bytes: tx.serialize().length,
    uniqueAccounts: keys.length,
    writable,
    cuIx,
    lighthouseIx,
    version: message.version,
    lookupTables: message.addressTableLookups.length,
    discriminator,
  };
}

export function summaryFromFacts(n: number, facts: TxFacts): TxSummary {
  return {
    n,
    bytes: facts.bytes,
    uniqueAccounts: facts.uniqueAccounts,
    writable: facts.writable,
    cuIx: facts.cuIx,
  };
}

/** RPC order, no sort. Null when there are fewer than 2n empties. */
export function splitEmpties(atas: readonly string[], n: number): [string[], string[]] | null {
  if (atas.length < n * 2) return null;
  return [atas.slice(0, n), atas.slice(n, n * 2)];
}

export function isEmptyClassicAta(row: {
  parsedType?: string | null;
  owner?: string | null;
  amount?: string | null;
}, wallet: string): boolean {
  return row.parsedType === "account" && row.owner === wallet && row.amount === "0";
}
