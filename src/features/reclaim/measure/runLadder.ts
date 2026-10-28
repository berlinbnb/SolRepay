import { VersionedTransaction } from "@solana/web3.js";
import { SIGN_AND_SEND_PROBE_OPTIONS, type ControlCount } from "./constants.ts";
import { classifyWalletError, readSignature } from "./classify.ts";
import {
  providerMatchesWallet,
  type PhantomProbeProvider,
} from "./discover.ts";
import { buildFlatBatchCloseV0, summaryFromFacts, txFacts } from "./flatBatchClose.ts";
import { hostBlockReason, type MeasureHost } from "./gates.ts";
import { CONTROL_COUNTS } from "./constants.ts";
import { emptyEntry, publishMeasure, type MeasureEntry, type MeasureLog } from "./log.ts";
import type { ProbeIo } from "./probeIo.ts";

export type LadderApi = "signTransaction" | "signAndSendTransaction";

function isControlCount(count: number): count is ControlCount {
  return (CONTROL_COUNTS as readonly number[]).includes(count);
}

/**
 * Step 1. One flat V0 BatchClose of `count` empty classic ATAs.
 * `signTransaction` matches the live N1 control and does not submit.
 * `signAndSendTransaction` is the same bytes and the same options as
 * production Phantom Geri Al. Approving that call broadcasts. This function
 * never calls sendRawTransaction, `/api/batchclose/submit`, or status polling.
 */
export async function runBatchCloseLadder(input: {
  api: LadderApi;
  count: number;
  attempt: number;
  host: MeasureHost;
  io: ProbeIo;
  provider: PhantomProbeProvider | null;
  phantomVersion: string | null;
  now?: Date;
  log?: MeasureLog;
}): Promise<MeasureEntry> {
  const at = (input.now ?? new Date()).toISOString();
  const entry = emptyEntry({
    step: 1,
    n: input.count,
    attempt: input.attempt,
    api: input.api,
    phantomVersion: input.phantomVersion,
    at,
    broadcastOnApprove: false,
  });
  if (input.api === "signAndSendTransaction") entry.sendOptions = SIGN_AND_SEND_PROBE_OPTIONS;

  const finish = (patch: Partial<MeasureEntry>) => publishMeasure({ ...entry, ...patch }, input.log);

  if (!isControlCount(input.count)) {
    return finish({
      note: `count ${input.count} is not in CONTROL_COUNTS. Wallet was not opened. Not RED.`,
    });
  }
  const hostReason = hostBlockReason(input.host);
  if (hostReason) return finish({ note: `${hostReason} Wallet was not opened.` });

  const providerReason = providerMatchesWallet(input.provider, input.host.walletAddress);
  if (providerReason) return finish({ note: `${providerReason} Wallet was not opened.` });
  const provider = input.provider;
  if (!provider) return finish({ note: "Phantom provider missing. Wallet was not opened." });

  if (input.api === "signTransaction" && typeof provider.signTransaction !== "function") {
    return finish({ note: "signTransaction yok. Wallet was not opened." });
  }
  if (input.api === "signAndSendTransaction" && typeof provider.signAndSendTransaction !== "function") {
    return finish({
      note: "signAndSendTransaction yok. signTransaction was not used as a fallback. Wallet was not opened.",
    });
  }

  let atas: string[];
  try {
    atas = await input.io.listEmptyClassicAtas(input.host.walletAddress);
  } catch (error) {
    const classified = classifyWalletError(error);
    return finish({
      result: "FAIL",
      screenText: classified.screenText,
      note: "Could not list empty classic ATAs. Wallet was not opened. Not RED.",
    });
  }
  if (atas.length < input.count) {
    return finish({
      note: `N=${input.count} için yeterli boş classic token hesabı bulunamadı (${atas.length}). Wallet was not opened. Not RED.`,
    });
  }

  try {
    if (!(await input.io.programExecutable())) {
      return finish({ note: "Mainnet BatchClose programı executable değil. Wallet was not opened." });
    }
  } catch (error) {
    const classified = classifyWalletError(error);
    return finish({
      screenText: classified.screenText,
      note: "Program lookup failed. Wallet was not opened. Not RED.",
    });
  }

  let built;
  try {
    const recentBlockhash = await input.io.latestBlockhash();
    built = buildFlatBatchCloseV0({
      authority: input.host.walletAddress,
      atas: atas.slice(0, input.count),
      recentBlockhash,
    });
  } catch (error) {
    const classified = classifyWalletError(error);
    return finish({
      screenText: classified.screenText,
      note: `${classified.screenText ?? "Build failed."} Wallet was not opened. Not RED.`,
    });
  }

  const unsigned = txFacts(built.transaction);
  entry.bytes = unsigned.bytes;
  entry.uniqueAccounts = unsigned.uniqueAccounts;
  entry.writable = unsigned.writable;
  entry.cuIx = unsigned.cuIx;
  entry.perTx = [summaryFromFacts(built.n, unsigned)];

  let sim: { err: unknown; unitsConsumed: number | null };
  try {
    sim = await input.io.simulate(built.transaction);
  } catch (error) {
    const classified = classifyWalletError(error);
    return finish({
      ...entry,
      rpcSimOk: false,
      screenText: classified.screenText,
      note: "RPC simulate threw. Wallet was not opened. Not RED.",
    });
  }
  entry.rpcSimOk = sim.err == null;
  entry.unitsConsumed = sim.unitsConsumed;
  if (sim.err != null) {
    return finish({
      ...entry,
      note: `N=${input.count} Mainnet simülasyonu başarısız: ${JSON.stringify(sim.err)}. Wallet was not opened. Not RED.`,
    });
  }

  entry.walletOpened = true;
  if (input.api === "signAndSendTransaction") entry.broadcastOnApprove = true;
  try {
    if (input.api === "signTransaction") {
      const signed = await provider.signTransaction!(built.transaction);
      const signedTx = signed instanceof VersionedTransaction ? signed : null;
      const signedFacts = signedTx ? txFacts(signedTx) : null;
      return finish({
        ...entry,
        result: "OK",
        send: "sendless",
        walletOpened: true,
        signedBytes: signedFacts?.bytes ?? null,
        signedUniqueAccounts: signedFacts?.uniqueAccounts ?? null,
        signedWritable: signedFacts?.writable ?? null,
        signedCuIx: signedFacts?.cuIx ?? null,
        lighthouseIx: signedFacts?.lighthouseIx ?? null,
        note: `N=${input.count} signTransaction returned. Not submitted. Hesap kapanmadı.`,
      });
    }

    const raw = await provider.signAndSendTransaction!(
      built.transaction,
      SIGN_AND_SEND_PROBE_OPTIONS,
    );
    const signature = readSignature(raw);
    return finish({
      ...entry,
      result: "BROADCAST",
      send: "real",
      walletOpened: true,
      broadcastOnApprove: true,
      signature,
      note: signature
        ? "STOP. Phantom signAndSendTransaction returned a signature, so this attempt broadcast. Do not continue the ladder until you know which accounts closed."
        : "STOP. signAndSendTransaction resolved without a readable signature. Assume it may have broadcast.",
    });
  } catch (error) {
    const classified = classifyWalletError(error);
    const blocked = classified.result === "RED" || classified.result === "CANCEL";
    return finish({
      ...entry,
      result: classified.result,
      screenText: classified.screenText,
      walletOpened: true,
      send: "sendless",
      note: blocked
        ? classified.result === "RED"
          ? "Phantom blocked the request. Not submitted."
          : "Wallet returned a cancel. If the sheet was a normal preview, annotate OK. If it said İstek engellendi, annotate RED. Not submitted."
        : `Wallet error. Not submitted. ${classified.screenText ?? ""}`.trim(),
    });
  }
}
