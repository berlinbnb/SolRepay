/** Live BatchClose program. Flat V0 N1 ladder and these probes use this id. */
export const BATCH_CLOSE_PROGRAM_ID = "6RmyrtFAEYocx2NMHuH6FzdLvmEr3UDFdJrsrpPZ7F75";

export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";

/** Phantom Lighthouse. Counted on a returned signature only. Not added by us. */
export const LIGHTHOUSE_PROGRAM_ID = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

/**
 * Allowlisted mainnet wallet for the existing N1 control.
 * Same address the live `?batchclosen1=1` probe requires.
 */
export const N1_CONTROL_WALLET = "5VHsXYPAWEbgqSM2U2BgwJ9AtN6EyfpDN5Li8MNab6kN";

/** Same set as the live N1 gate. Order here is not a run order. */
export const CONTROL_COUNTS = [1, 5, 6, 8, 9, 10, 13, 20, 28] as const;

export type ControlCount = (typeof CONTROL_COUNTS)[number];

/** Suggested manual order for Berlin. The panel only renders links. */
export const SUGGESTED_COUNT_ORDER = [9, 5, 13, 8, 10] as const;

/** Step 4. Each value means that many closes in each of two transactions. */
export const MULTI_SPLITS = [5, 13, 25] as const;

export type MultiSplit = (typeof MULTI_SPLITS)[number];

export const BATCH_CLOSE_RPC_PATH = "/api/batchclose/rpc";

/**
 * Same options the live Phantom Geri Al `signAndSendTransaction` call passes.
 * This probe does not confirm, retry from the app, or submit a second time.
 * Approving still lets Phantom broadcast.
 */
export const SIGN_AND_SEND_PROBE_OPTIONS = {
  skipPreflight: false,
  preflightCommitment: "confirmed",
  maxRetries: 3,
} as const;

export const MEASURE_TAG = "solrepay:measure" as const;
