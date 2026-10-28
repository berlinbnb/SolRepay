import assert from "node:assert/strict";
import test from "node:test";
import {
  PHANTOM_SIGN_AND_SEND_OPTIONS,
  phantomSignAndSendTransaction,
} from "./phantomSignAndSend.ts";

test("production phantom send matches the signsend probe and does not app-submit", async () => {
  const calls: unknown[] = [];
  const signature = "5".repeat(88);
  const result = await phantomSignAndSendTransaction({
    current: () => true,
    transaction: { kind: "versioned" },
    provider: {
      isConnected: true,
      signAndSendTransaction: async (transaction, options) => {
        calls.push({ transaction, options });
        return { signature };
      },
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    transaction: { kind: "versioned" },
    options: PHANTOM_SIGN_AND_SEND_OPTIONS,
  });
  assert.equal(result.signature, signature);
  assert.equal(result.appSubmit, false);
});

test("connects when needed and reads a raw signature", async () => {
  let connected = false;
  const raw = new Uint8Array(32).fill(1);
  const result = await phantomSignAndSendTransaction({
    current: () => true,
    transaction: raw,
    provider: {
      isConnected: false,
      connect: async () => {
        connected = true;
      },
      signAndSendTransaction: async () => raw,
    },
  });
  assert.equal(connected, true);
  assert.equal(result.appSubmit, false);
  assert.equal(result.signature.length > 0, true);
});

test("missing phantom signAndSendTransaction fails before any submit", async () => {
  await assert.rejects(
    () =>
      phantomSignAndSendTransaction({
        current: () => true,
        transaction: null,
        provider: {},
      }),
    /signAndSendTransaction not available/,
  );
});
