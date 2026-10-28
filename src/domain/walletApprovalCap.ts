/**
 * Production reclaim approval caps.
 *
 * Live worker (2026-10-28, version 560118d3) exports these as:
 *   k = 10  non-Phantom batch cap
 *   n = 5   Phantom cap while phantomChunkGuard is on
 *   V(guard, walletName) = guard === true && /phantom/i on the wallet name
 *
 * Measured Phantom signAndSendTransaction ladder the same day: 13 closes
 * in one transaction is accepted; 14 is blocked ("İstek engellendi").
 * The Phantom cap is therefore 13. Non-Phantom packing stays at 10.
 */

export const NON_PHANTOM_BATCH_ACTION_CAP = 10;

/** Phantom chunk size for signAndSendTransaction. Was 5 on the sign-then-submit path. */
export const WALLET_APPROVAL_ACTION_CAP = 13;

export function isPhantomWallet(walletName: unknown): boolean {
  return typeof walletName === "string" && /phantom/i.test(walletName.trim());
}

/** Settings store uses the string "false"; the client flag uses boolean false. */
export function phantomChunkGuardEnabled(value: unknown): boolean {
  return value !== false && value !== "false";
}

export function usesPhantomChunkCap(phantomChunkGuard: unknown, walletName: unknown): boolean {
  return phantomChunkGuardEnabled(phantomChunkGuard) && isPhantomWallet(walletName);
}

/**
 * Action ceiling passed to the quote packer.
 * A positive maxActions value is the batchtest override (including mode=signsend
 * bsize) and must win so probes can still request other sizes.
 * The existing byte budget can still open a chunk before this ceiling.
 */
export function approvalActionCap(input: {
  phantomChunkGuard: unknown;
  walletName?: unknown;
  maxActions?: number;
}): number {
  const override = input.maxActions;
  if (typeof override === "number" && override >= 1) return override;
  return usesPhantomChunkCap(input.phantomChunkGuard, input.walletName)
    ? WALLET_APPROVAL_ACTION_CAP
    : NON_PHANTOM_BATCH_ACTION_CAP;
}

export function chunkByActionCap<T>(actions: readonly T[], cap: number): T[][] {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new Error("Action cap must be a positive integer.");
  }
  const chunks: T[][] = [];
  for (let index = 0; index < actions.length; index += cap) {
    chunks.push(actions.slice(index, index + cap));
  }
  return chunks;
}

export type ReclaimSignPath =
  | "batchtest-signsend"
  | "batchtest-probe"
  | "batchtest-signall"
  | "phantom-sign-and-send"
  | "sequential-sign-submit"
  | "signall-submit";

const DEDICATED_BATCHTEST_MODES = new Set([
  "pairprobe",
  "transfer",
  "transferdirect",
  "jupiterprobe",
  "v0probe",
  "v1probe",
  "direct",
]);

/**
 * Production Phantom with the chunk guard on uses signAndSendTransaction.
 * Solflare and every other non-Phantom wallet stay on signAll + app submit.
 * Turning the guard off keeps Phantom on the previous sign-then-submit path.
 * batchtest modes are left on their existing probe branches.
 */
export function selectReclaimSignPath(input: {
  batchtest: boolean;
  mode?: string;
  batchSign: boolean;
  signAll: boolean;
  walletName: unknown;
  phantomChunkGuard: unknown;
  batchCount: number;
}): ReclaimSignPath {
  const mode = input.mode ?? "";
  if (input.batchtest && mode === "signsend") return "batchtest-signsend";
  if (input.batchtest && DEDICATED_BATCHTEST_MODES.has(mode)) return "batchtest-probe";
  if (input.batchtest && input.batchSign && input.signAll && input.batchCount >= 1) {
    return "batchtest-signall";
  }
  if (
    !input.batchtest &&
    usesPhantomChunkCap(input.phantomChunkGuard, input.walletName) &&
    input.batchCount >= 1
  ) {
    return "phantom-sign-and-send";
  }
  if (input.batchtest || !input.signAll || isPhantomWallet(input.walletName) || input.batchCount < 1) {
    return "sequential-sign-submit";
  }
  return "signall-submit";
}

export type ChunkBatch = { actions?: readonly unknown[] };

/**
 * Fullscreen / chip notice. Shown only when Phantom packing needs more than
 * one chunk. With the cap at 13 that is 14 or more empty accounts, unless the
 * byte budget splits earlier. Hidden for a single chunk and for the signsend probe.
 */
export function shouldShowPhantomChunkNotice(input: {
  batches: readonly ChunkBatch[] | null | undefined;
  walletName: unknown;
  phantomChunkGuard: unknown;
  batchtest?: boolean;
  mode?: string;
}): boolean {
  if (input.batchtest && (input.mode ?? "") === "signsend") return false;
  if (!usesPhantomChunkCap(input.phantomChunkGuard, input.walletName)) return false;
  const batches = input.batches;
  if (!Array.isArray(batches) || batches.length <= 1) return false;
  const sizes = batches.map((batch) => batch?.actions?.length ?? 0);
  if (sizes.length === 0 || sizes.some((size) => size <= 0)) return false;
  return true;
}
