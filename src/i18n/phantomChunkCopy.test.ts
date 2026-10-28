import assert from "node:assert/strict";
import test from "node:test";
import { WALLET_APPROVAL_ACTION_CAP } from "../domain/walletApprovalCap.ts";
import { phantomChunkCopy } from "./phantomChunkCopy.ts";

test("turkish and english chunk copy names cap 13 and not cap 5", () => {
  assert.equal(WALLET_APPROVAL_ACTION_CAP, 13);
  for (const locale of [phantomChunkCopy.tr, phantomChunkCopy.en]) {
    for (const value of Object.values(locale)) {
      assert.equal(value.includes("5 hesap"), false);
      assert.equal(value.includes("5 accounts"), false);
      assert.equal(value.includes("%"), false);
      assert.match(value, /13/);
    }
  }
  assert.equal(phantomChunkCopy.tr.chunkNoticeThreshold, "13'ten fazla hesapta birden fazla onay.");
  assert.match(phantomChunkCopy.en.chunkNoticeWhy, /up to 13 accounts per approval/);
  assert.match(phantomChunkCopy.tr.phantomGuardHint, /en fazla 13 hesap \/ onay/);
});
