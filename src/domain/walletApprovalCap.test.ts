import assert from "node:assert/strict";
import test from "node:test";
import {
  NON_PHANTOM_BATCH_ACTION_CAP,
  WALLET_APPROVAL_ACTION_CAP,
  approvalActionCap,
  chunkByActionCap,
  selectReclaimSignPath,
  shouldShowPhantomChunkNotice,
} from "./walletApprovalCap.ts";

const phantom = {
  batchtest: false,
  batchSign: false,
  signAll: true,
  walletName: "Phantom",
  phantomChunkGuard: true,
  batchCount: 1,
};

test("phantom production cap is 13 and non-phantom stays 10", () => {
  assert.equal(WALLET_APPROVAL_ACTION_CAP, 13);
  assert.equal(NON_PHANTOM_BATCH_ACTION_CAP, 10);
  assert.equal(approvalActionCap({ phantomChunkGuard: true, walletName: "Phantom" }), 13);
  assert.equal(approvalActionCap({ phantomChunkGuard: true, walletName: "Solflare" }), 10);
  assert.equal(approvalActionCap({ phantomChunkGuard: true, walletName: "Backpack" }), 10);
  assert.equal(approvalActionCap({ phantomChunkGuard: false, walletName: "Phantom" }), 10);
  assert.equal(approvalActionCap({ phantomChunkGuard: "false", walletName: "Phantom" }), 10);
});

test("batchtest maxActions override still wins, including sizes above the phantom cap", () => {
  assert.equal(
    approvalActionCap({ phantomChunkGuard: true, walletName: "Phantom", maxActions: 14 }),
    14,
  );
  assert.equal(
    approvalActionCap({ phantomChunkGuard: true, walletName: "Phantom", maxActions: 1 }),
    1,
  );
  assert.equal(
    approvalActionCap({ phantomChunkGuard: true, walletName: "Solflare", maxActions: 8 }),
    8,
  );
});

test("chunks are at most 13 phantom closes and 10 otherwise", () => {
  assert.deepEqual(chunkByActionCap([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], 13), [
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  ]);
  const fourteen = chunkByActionCap(Array.from({ length: 14 }, (_, index) => index), 13);
  assert.deepEqual(fourteen.map((chunk) => chunk.length), [13, 1]);
  const solflare = chunkByActionCap(Array.from({ length: 25 }, (_, index) => index), 10);
  assert.deepEqual(solflare.map((chunk) => chunk.length), [10, 10, 5]);
});

test("phantom production uses signAndSend; solflare stays on signAll", () => {
  assert.equal(selectReclaimSignPath(phantom), "phantom-sign-and-send");
  assert.equal(selectReclaimSignPath({ ...phantom, batchCount: 2 }), "phantom-sign-and-send");
  assert.equal(
    selectReclaimSignPath({ ...phantom, walletName: "Solflare", batchCount: 3 }),
    "signall-submit",
  );
  assert.equal(
    selectReclaimSignPath({ ...phantom, phantomChunkGuard: false, batchCount: 2 }),
    "sequential-sign-submit",
  );
});

test("batchtest signsend and other probes are not retargeted", () => {
  assert.equal(
    selectReclaimSignPath({
      ...phantom,
      batchtest: true,
      mode: "signsend",
      batchSign: true,
      batchCount: 1,
    }),
    "batchtest-signsend",
  );
  assert.equal(
    selectReclaimSignPath({
      ...phantom,
      batchtest: true,
      mode: "v0probe",
      batchSign: true,
    }),
    "batchtest-probe",
  );
  assert.equal(
    selectReclaimSignPath({
      batchtest: true,
      mode: "",
      batchSign: true,
      signAll: true,
      walletName: "Solflare",
      phantomChunkGuard: true,
      batchCount: 2,
    }),
    "batchtest-signall",
  );
});

test("multi-approval notice appears only past one chunk of 13", () => {
  const oneChunk = [{ actions: Array.from({ length: 13 }, (_, index) => index) }];
  const twoChunks = [
    { actions: Array.from({ length: 13 }, (_, index) => index) },
    { actions: [13] },
  ];
  assert.equal(
    shouldShowPhantomChunkNotice({
      batches: oneChunk,
      walletName: "Phantom",
      phantomChunkGuard: true,
    }),
    false,
  );
  assert.equal(
    shouldShowPhantomChunkNotice({
      batches: twoChunks,
      walletName: "Phantom",
      phantomChunkGuard: true,
    }),
    true,
  );
  assert.equal(
    shouldShowPhantomChunkNotice({
      batches: twoChunks,
      walletName: "Solflare",
      phantomChunkGuard: true,
    }),
    false,
  );
  assert.equal(
    shouldShowPhantomChunkNotice({
      batches: twoChunks,
      walletName: "Phantom",
      phantomChunkGuard: true,
      batchtest: true,
      mode: "signsend",
    }),
    false,
  );
});
