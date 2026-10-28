/**
 * Gated Phantom measurement probes for BatchClose steps 1 and 4.
 * Import this only from the gated probe slot. Do not call it from Geri Al,
 * and do not change the production approval cap from here.
 */
export { CONTROL_COUNTS, MULTI_SPLITS, SUGGESTED_COUNT_ORDER, BATCH_CLOSE_PROGRAM_ID } from "./constants.ts";
export { attachPhantomMeasureProbes } from "./panel.ts";
export { planPanel } from "./panelModel.ts";
export { readMeasureGates, hostBlockReason } from "./gates.ts";
export { runBatchCloseLadder } from "./runLadder.ts";
export { runMultiTxProbe } from "./runMultiTx.ts";
export { annotateEntry } from "./log.ts";
