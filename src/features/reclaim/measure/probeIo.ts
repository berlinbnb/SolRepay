import { Connection, PublicKey, type VersionedTransaction } from "@solana/web3.js";
import { BATCH_CLOSE_PROGRAM_ID, BATCH_CLOSE_RPC_PATH, TOKEN_PROGRAM_ID } from "./constants.ts";
import { isEmptyClassicAta } from "./flatBatchClose.ts";

export type ProbeIo = {
  listEmptyClassicAtas: (wallet: string) => Promise<string[]>;
  latestBlockhash: () => Promise<string>;
  programExecutable: () => Promise<boolean>;
  simulate: (tx: VersionedTransaction) => Promise<{ err: unknown; unitsConsumed: number | null }>;
};

/**
 * Same RPC the live N1 probe uses (`/api/batchclose/rpc`).
 * There is no submit method on this object.
 */
export function createMainnetProbeIo(origin: string): ProbeIo {
  const endpoint = `${origin.replace(/\/$/, "")}${BATCH_CLOSE_RPC_PATH}`;
  const connection = new Connection(endpoint, "confirmed");
  const program = new PublicKey(BATCH_CLOSE_PROGRAM_ID);
  return {
    async listEmptyClassicAtas(wallet) {
      const owner = new PublicKey(wallet);
      const listed = await connection.getParsedTokenAccountsByOwner(owner, {
        programId: new PublicKey(TOKEN_PROGRAM_ID),
      });
      const atas: string[] = [];
      for (const row of listed.value) {
        const data = row.account.data;
        if (!("parsed" in data)) continue;
        const parsed = data.parsed as {
          type?: string;
          info?: { owner?: string; tokenAmount?: { amount?: string } };
        };
        if (
          isEmptyClassicAta(
            {
              parsedType: parsed?.type ?? null,
              owner: parsed?.info?.owner ?? null,
              amount: parsed?.info?.tokenAmount?.amount ?? null,
            },
            wallet,
          )
        ) {
          atas.push(row.pubkey.toBase58());
        }
      }
      return atas;
    },
    async latestBlockhash() {
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      return blockhash;
    },
    async programExecutable() {
      const info = await connection.getAccountInfo(program, "confirmed");
      return Boolean(info?.executable);
    },
    async simulate(tx) {
      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false,
        commitment: "confirmed",
      });
      return { err: sim.value.err, unitsConsumed: sim.value.unitsConsumed ?? null };
    },
  };
}
