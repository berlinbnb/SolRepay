import {
  CONTROL_COUNTS,
  MULTI_SPLITS,
  N1_CONTROL_WALLET,
  SUGGESTED_COUNT_ORDER,
  type ControlCount,
  type MultiSplit,
} from "./constants.ts";

export type MeasureHost = {
  walletAddress: string;
  walletName: string;
  network: string;
  chain: string;
};

export type MeasureGates = {
  n1Requested: boolean;
  n1Count: ControlCount | null;
  invalidN1Count: boolean;
  multiRequested: boolean;
  multiSplit: MultiSplit | null;
  invalidMultiSplit: boolean;
  blockedByOtherGate: "cys" | "v1probe" | "batchcloseprobe" | null;
};

function params(search: string): URLSearchParams {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw);
}

function isControlCount(value: number): value is ControlCount {
  return (CONTROL_COUNTS as readonly number[]).includes(value);
}

function isMultiSplit(value: number): value is MultiSplit {
  return (MULTI_SPLITS as readonly number[]).includes(value);
}

/**
 * Live N1 rule: `?batchclosen1=1` and `count` (default 1) must be one of
 * CONTROL_COUNTS. `URLSearchParams.get` is the first value, matching the
 * deployed gate. This does not turn on Geri Al or mainnet BatchClose submit.
 */
export function readMeasureGates(search: string): MeasureGates {
  const query = params(search);
  const n1Requested = query.get("batchclosen1") === "1";
  let n1Count: ControlCount | null = null;
  let invalidN1Count = false;
  if (n1Requested) {
    const raw = query.get("count") ?? "1";
    const count = Number(raw);
    if (/^\d+$/.test(raw) && isControlCount(count)) n1Count = count;
    else invalidN1Count = true;
  }

  const multiRequested = query.get("multitx") === "1";
  let multiSplit: MultiSplit | null = null;
  let invalidMultiSplit = false;
  if (multiRequested) {
    const raw = query.get("split") ?? query.get("n") ?? "";
    if (raw === "") invalidMultiSplit = true;
    else {
      const split = Number(raw);
      if (/^\d+$/.test(raw) && isMultiSplit(split)) multiSplit = split;
      else invalidMultiSplit = true;
    }
  }

  let blockedByOtherGate: MeasureGates["blockedByOtherGate"] = null;
  if (query.has("cys")) blockedByOtherGate = "cys";
  else if (query.get("v1probe") === "1") blockedByOtherGate = "v1probe";
  else if (query.get("batchcloseprobe") === "1") blockedByOtherGate = "batchcloseprobe";

  return {
    n1Requested,
    n1Count,
    invalidN1Count,
    multiRequested,
    multiSplit,
    invalidMultiSplit,
    blockedByOtherGate,
  };
}

/** Same wallet, name, and cluster checks as `runBatchCloseN1Probe`. */
export function hostBlockReason(host: MeasureHost): string | null {
  if (host.walletAddress !== N1_CONTROL_WALLET || !/^phantom$/i.test(host.walletName)) {
    return "BatchClose kontrolü yalnız allowlist Phantom Mainnet cüzdanında açıktır.";
  }
  if (host.network !== "mainnet-beta" || host.chain !== "solana:mainnet") {
    return "BatchClose kontrolü yalnız allowlist Phantom Mainnet cüzdanında açıktır.";
  }
  return null;
}

export function withCount(search: string, count: ControlCount): string {
  const query = params(search);
  query.set("batchclosen1", "1");
  query.set("count", String(count));
  return `?${query.toString()}`;
}

export function withSplit(search: string, split: MultiSplit): string {
  const query = params(search);
  query.set("multitx", "1");
  query.set("split", String(split));
  query.delete("n");
  return `?${query.toString()}`;
}

export function suggestedCounts(): readonly ControlCount[] {
  return SUGGESTED_COUNT_ORDER;
}
