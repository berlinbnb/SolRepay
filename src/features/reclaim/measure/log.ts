import { MEASURE_TAG, SIGN_AND_SEND_PROBE_OPTIONS } from "./constants.ts";

export type MeasureResult = "OK" | "RED" | "CANCEL" | "BROADCAST" | "FAIL";

export type MeasurePresentation = "batch" | "one-by-one" | "unknown";

export type TxSummary = {
  n: number;
  bytes: number;
  uniqueAccounts: number;
  writable: number;
  cuIx: boolean;
};

/**
 * One console object per attempt. Berlin copies this.
 * `send` is sendless vs real. `broadcastOnApprove` is true when the wallet
 * method would publish if the sheet is a normal approval.
 */
export type MeasureEntry = {
  tag: typeof MEASURE_TAG;
  step: 1 | 4;
  n: number;
  attempt: number;
  api: string;
  result: MeasureResult;
  screenText: string | null;
  simVisible: boolean | null;
  bytes: number | null;
  uniqueAccounts: number | null;
  writable: number | null;
  cuIx: boolean | null;
  send: "sendless" | "real";
  broadcastOnApprove: boolean;
  phantomVersion: string | null;
  at: string;
  approvalScreens: number | null;
  presentation: MeasurePresentation | null;
  perTx: TxSummary[] | null;
  rpcSimOk: boolean | null;
  unitsConsumed: number | null;
  signedBytes: number | null;
  signedUniqueAccounts: number | null;
  signedWritable: number | null;
  signedCuIx: boolean | null;
  lighthouseIx: number | null;
  signature: string | null;
  walletOpened: boolean;
  note: string | null;
  annotated: boolean;
  annotatedAt?: string;
  sendOptions?: typeof SIGN_AND_SEND_PROBE_OPTIONS | null;
};

export type MeasureLog = (entry: MeasureEntry) => void;

export function emptyEntry(input: {
  step: 1 | 4;
  n: number;
  attempt: number;
  api: string;
  phantomVersion: string | null;
  at: string;
  broadcastOnApprove: boolean;
}): MeasureEntry {
  return {
    tag: MEASURE_TAG,
    step: input.step,
    n: input.n,
    attempt: input.attempt,
    api: input.api,
    result: "FAIL",
    screenText: null,
    simVisible: null,
    bytes: null,
    uniqueAccounts: null,
    writable: null,
    cuIx: null,
    send: "sendless",
    broadcastOnApprove: input.broadcastOnApprove,
    phantomVersion: input.phantomVersion,
    at: input.at,
    approvalScreens: null,
    presentation: null,
    perTx: null,
    rpcSimOk: null,
    unitsConsumed: null,
    signedBytes: null,
    signedUniqueAccounts: null,
    signedWritable: null,
    signedCuIx: null,
    lighthouseIx: null,
    signature: null,
    walletOpened: false,
    note: null,
    annotated: false,
    sendOptions: null,
  };
}

export function publishMeasure(entry: MeasureEntry, log?: MeasureLog): MeasureEntry {
  const write = log ?? defaultMeasureLog;
  write(entry);
  return entry;
}

export function defaultMeasureLog(entry: MeasureEntry): void {
  const scope = globalThis as { __solrepayMeasure?: MeasureEntry[] };
  (scope.__solrepayMeasure ??= []).push(entry);
  console.info("[solrepay:measure]", entry);
}

export type Annotation = {
  screenText?: string | null;
  simVisible?: boolean | null;
  approvalScreens?: number | null;
  presentation?: MeasurePresentation | null;
  phantomVersion?: string | null;
  /** Ignored when the attempt already broadcast. */
  result?: MeasureResult;
};

export function annotateEntry(entry: MeasureEntry, patch: Annotation, now = new Date()): MeasureEntry {
  const next: MeasureEntry = {
    ...entry,
    annotated: true,
    annotatedAt: now.toISOString(),
  };
  if ("screenText" in patch) next.screenText = patch.screenText ?? null;
  if ("simVisible" in patch) next.simVisible = patch.simVisible ?? null;
  if ("approvalScreens" in patch) next.approvalScreens = patch.approvalScreens ?? null;
  if ("presentation" in patch) next.presentation = patch.presentation ?? null;
  if ("phantomVersion" in patch && patch.phantomVersion) next.phantomVersion = patch.phantomVersion;
  if (patch.result && patch.result !== entry.result) {
    if (entry.send === "real" || entry.result === "BROADCAST") {
      next.note = [entry.note, "Broadcast stays real. Relabeling it was ignored."].filter(Boolean).join(" ");
    } else {
      next.result = patch.result;
      next.note = [entry.note, `Annotated result ${entry.result} → ${patch.result}. Nothing was submitted.`]
        .filter(Boolean)
        .join(" ");
    }
  }
  return next;
}

export function createAttemptCounter(storage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}): (key: string) => number {
  return (key: string) => {
    const next = Number(storage.getItem(key) ?? "0") + 1;
    const attempt = Number.isInteger(next) && next > 0 ? next : 1;
    storage.setItem(key, String(attempt));
    return attempt;
  };
}
