import { VersionedTransaction } from "@solana/web3.js";
import { classifyWalletError } from "./classify.ts";
import {
  providerMatchesWallet,
  selectMultiSign,
  type PhantomProbeProvider,
  type WalletStandardWallet,
} from "./discover.ts";
import { buildFlatBatchCloseV0, splitEmpties, summaryFromFacts, txFacts } from "./flatBatchClose.ts";
import { hostBlockReason, type MeasureHost } from "./gates.ts";
import { MULTI_SPLITS, type MultiSplit } from "./constants.ts";
import { emptyEntry, publishMeasure, type MeasureEntry, type MeasureLog, type TxSummary } from "./log.ts";
import type { ProbeIo } from "./probeIo.ts";

function isSplit(value: number): value is MultiSplit {
  return (MULTI_SPLITS as readonly number[]).includes(value);
}

/**
 * Step 4. Two flat V0 BatchClose transactions (n + n), one sendless approval
 * surface. Uses `signAllTransactions` when Phantom exposes it. Otherwise one
 * Wallet Standard `solana:signTransaction` call with two inputs.
 * Never calls `signAndSendAllTransactions` or submits the signed bytes.
 */
export async function runMultiTxProbe(input: {
  split: number;
  attempt: number;
  host: MeasureHost;
  io: ProbeIo;
  provider: PhantomProbeProvider | null;
  wallets: readonly WalletStandardWallet[];
  phantomVersion: string | null;
  now?: Date;
  log?: MeasureLog;
}): Promise<MeasureEntry> {
  const at = (input.now ?? new Date()).toISOString();
  const entry = emptyEntry({
    step: 4,
    n: input.split,
    attempt: input.attempt,
    api: "pending",
    phantomVersion: input.phantomVersion,
    at,
    broadcastOnApprove: false,
  });
  const finish = (patch: Partial<MeasureEntry>) => publishMeasure({ ...entry, ...patch }, input.log);

  if (!isSplit(input.split)) {
    return finish({
      api: "unavailable",
      note: `split ${input.split} is not 5, 13, or 25. Wallet was not opened. Not RED.`,
    });
  }
  const hostReason = hostBlockReason(input.host);
  if (hostReason) return finish({ api: "unavailable", note: `${hostReason} Wallet was not opened.` });

  const choice = selectMultiSign({
    provider: input.provider,
    wallets: input.wallets,
    walletAddress: input.host.walletAddress,
  });
  entry.api = choice.api;
  if (!choice.ok) return finish({ note: `${choice.reason} Wallet was not opened.` });

  if (choice.api === "signAllTransactions") {
    const providerReason = providerMatchesWallet(input.provider, input.host.walletAddress);
    if (providerReason) return finish({ note: `${providerReason} Wallet was not opened.` });
  }

  let atas: string[];
  try {
    atas = await input.io.listEmptyClassicAtas(input.host.walletAddress);
  } catch (error) {
    const classified = classifyWalletError(error);
    return finish({
      screenText: classified.screenText,
      note: "Could not list empty classic ATAs. Wallet was not opened. Not RED.",
    });
  }
  const halves = splitEmpties(atas, input.split);
  if (!halves) {
    return finish({
      note: `${input.split}+${input.split} needs ${input.split * 2} empty classic ATAs, found ${atas.length}. Wallet was not opened. Not RED.`,
    });
  }

  let recentBlockhash: string;
  try {
    if (!(await input.io.programExecutable())) {
      return finish({ note: "Mainnet BatchClose programı executable değil. Wallet was not opened." });
    }
    recentBlockhash = await input.io.latestBlockhash();
  } catch (error) {
    const classified = classifyWalletError(error);
    return finish({
      screenText: classified.screenText,
      note: "Blockhash or program lookup failed. Wallet was not opened. Not RED.",
    });
  }

  let built: ReturnType<typeof buildFlatBatchCloseV0>[];
  try {
    built = halves.map((half) =>
      buildFlatBatchCloseV0({
        authority: input.host.walletAddress,
        atas: half,
        recentBlockhash,
      }),
    );
  } catch (error) {
    const classified = classifyWalletError(error);
    return finish({
      screenText: classified.screenText,
      note: `${classified.screenText ?? "Build failed."} Wallet was not opened. Not RED.`,
    });
  }

  const perTx: TxSummary[] = built.map((tx) => summaryFromFacts(tx.n, txFacts(tx.transaction)));
  entry.perTx = perTx;
  entry.bytes = perTx[0]?.bytes ?? null;
  entry.uniqueAccounts = perTx[0]?.uniqueAccounts ?? null;
  entry.writable = perTx[0]?.writable ?? null;
  entry.cuIx = perTx.every((tx) => tx.cuIx);

  for (let index = 0; index < built.length; index += 1) {
    let sim: { err: unknown; unitsConsumed: number | null };
    try {
      sim = await input.io.simulate(built[index].transaction);
    } catch (error) {
      const classified = classifyWalletError(error);
      return finish({
        ...entry,
        rpcSimOk: false,
        screenText: classified.screenText,
        note: `RPC simulate threw on tx ${index + 1}. Wallet was not opened. Not RED.`,
      });
    }
    if (sim.err != null) {
      return finish({
        ...entry,
        rpcSimOk: false,
        unitsConsumed: sim.unitsConsumed,
        note: `Tx ${index + 1} simülasyonu başarısız: ${JSON.stringify(sim.err)}. Wallet was not opened. Not RED.`,
      });
    }
    entry.unitsConsumed = sim.unitsConsumed;
  }
  entry.rpcSimOk = true;
  entry.walletOpened = true;

  try {
    const signed =
      choice.api === "signAllTransactions"
        ? await input.provider!.signAllTransactions!(built.map((tx) => tx.transaction))
        : await signStandard(choice.wallet, choice.account, built.map((tx) => tx.transaction));
    if (signed.length !== built.length) {
      return finish({
        ...entry,
        result: "FAIL",
        walletOpened: true,
        note: `Expected ${built.length} signed transactions, got ${signed.length}. Not submitted.`,
      });
    }
    const signedFacts = signed.map((tx) => txFacts(tx));
    return finish({
      ...entry,
      result: "OK",
      send: "sendless",
      walletOpened: true,
      broadcastOnApprove: false,
      signedBytes: signedFacts[0]?.bytes ?? null,
      signedUniqueAccounts: signedFacts[0]?.uniqueAccounts ?? null,
      signedWritable: signedFacts[0]?.writable ?? null,
      signedCuIx: signedFacts[0]?.cuIx ?? null,
      lighthouseIx: signedFacts.reduce((sum, facts) => sum + facts.lighthouseIx, 0),
      note: `${input.split}+${input.split} signed with ${choice.api}. Not submitted. Record approval screens and whether Phantom showed one batch sheet or one-by-one.`,
    });
  } catch (error) {
    const classified = classifyWalletError(error);
    return finish({
      ...entry,
      result: classified.result,
      screenText: classified.screenText,
      walletOpened: true,
      send: "sendless",
      note:
        classified.result === "RED"
          ? "Phantom blocked the multi-tx request. Not submitted."
          : classified.result === "CANCEL"
            ? "Wallet returned a cancel. Annotate the sheet. Not submitted."
            : `Wallet error. Not submitted. ${classified.screenText ?? ""}`.trim(),
    });
  }
}

async function signStandard(
  wallet: WalletStandardWallet,
  account: { address: string },
  txs: VersionedTransaction[],
): Promise<VersionedTransaction[]> {
  const feature = wallet.features["solana:signTransaction"];
  if (typeof feature?.signTransaction !== "function") {
    throw new Error("Wallet Standard solana:signTransaction missing.");
  }
  const outputs = await feature.signTransaction(
    ...txs.map((tx) => ({
      account,
      transaction: tx.serialize(),
      chain: "solana:mainnet" as const,
    })),
  );
  if (outputs.length !== txs.length) {
    throw new Error(`Wallet Standard returned ${outputs.length} transactions, expected ${txs.length}.`);
  }
  return outputs.map((output) => VersionedTransaction.deserialize(output.signedTransaction));
}
