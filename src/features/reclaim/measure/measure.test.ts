import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { classifyWalletError } from "./classify.ts";
import {
  BATCH_CLOSE_PROGRAM_ID,
  BATCH_CLOSE_RPC_PATH,
  CONTROL_COUNTS,
  SIGN_AND_SEND_PROBE_OPTIONS,
  SUGGESTED_COUNT_ORDER,
  TOKEN_PROGRAM_ID,
} from "./constants.ts";
import {
  discoverPhantomProvider,
  selectMultiSign,
  type PhantomProbeProvider,
  type WalletStandardWallet,
} from "./discover.ts";
import { buildFlatBatchCloseV0, isEmptyClassicAta, splitEmpties, txFacts } from "./flatBatchClose.ts";
import { hostBlockReason, readMeasureGates } from "./gates.ts";
import { annotateEntry, createAttemptCounter, type MeasureEntry } from "./log.ts";
import { planPanel } from "./panelModel.ts";
import type { ProbeIo } from "./probeIo.ts";
import { runBatchCloseLadder } from "./runLadder.ts";
import { runMultiTxProbe } from "./runMultiTx.ts";
import { N1_CONTROL_WALLET } from "./constants.ts";

const host = {
  walletAddress: N1_CONTROL_WALLET,
  walletName: "Phantom",
  network: "mainnet-beta",
  chain: "solana:mainnet",
};
const when = new Date("2026-10-28T15:00:00.000Z");
const blockhash = Keypair.generate().publicKey.toBase58();

function atas(count: number): string[] {
  return Array.from({ length: count }, () => Keypair.generate().publicKey.toBase58());
}

function io(list: string[], opts?: { err?: unknown; executable?: boolean }): ProbeIo & { listed: number } {
  const api = {
    listed: 0,
    async listEmptyClassicAtas() {
      api.listed += 1;
      return list;
    },
    async latestBlockhash() {
      return blockhash;
    },
    async programExecutable() {
      return opts?.executable !== false;
    },
    async simulate() {
      return { err: opts?.err ?? null, unitsConsumed: 1200 };
    },
  };
  return api;
}

function provider(over: Partial<PhantomProbeProvider> = {}): PhantomProbeProvider & { calls: string[] } {
  const calls: string[] = [];
  return Object.assign(
    {
      calls,
      isPhantom: true,
      version: "26.10.1",
      publicKey: { toBase58: () => N1_CONTROL_WALLET },
      signTransaction: async (tx: unknown) => {
        calls.push("signTransaction");
        return tx;
      },
      signAndSendTransaction: async () => {
        calls.push("signAndSendTransaction");
        throw new Error("signAndSend should not run");
      },
      signAllTransactions: async () => {
        calls.push("signAllTransactions");
        throw new Error("signAll should not run");
      },
      signAndSendAllTransactions: async () => {
        calls.push("signAndSendAllTransactions");
        throw new Error("signAndSendAll should not run");
      },
    },
    over,
  );
}

function logs(): { entries: MeasureEntry[]; log: (entry: MeasureEntry) => void } {
  const entries: MeasureEntry[] = [];
  return { entries, log: (entry) => entries.push(entry) };
}

test("control counts and suggested order stay a manual subset", () => {
  assert.deepEqual(CONTROL_COUNTS, [1, 5, 6, 8, 9, 10, 13, 20, 28]);
  assert.deepEqual(SUGGESTED_COUNT_ORDER, [9, 5, 13, 8, 10]);
  for (const count of SUGGESTED_COUNT_ORDER) {
    assert.equal(CONTROL_COUNTS.includes(count), true);
  }
});

test("gates match the live N1 query and stay off otherwise", () => {
  assert.equal(readMeasureGates("").n1Requested, false);
  assert.equal(readMeasureGates("?batchclosen1=1").n1Count, 1);
  assert.equal(readMeasureGates("?batchclosen1=1&count=9").n1Count, 9);
  assert.equal(readMeasureGates("?batchclosen1=1&count=08").n1Count, 8);
  assert.equal(readMeasureGates("?batchclosen1=1&count=7").invalidN1Count, true);
  assert.equal(readMeasureGates("?batchclosen1=1&count=11").n1Count, null);
  assert.equal(readMeasureGates("?batchclosen1=1&count=9&count=1").n1Count, 9);
  const multi = readMeasureGates("?multitx=1&n=13");
  assert.equal(multi.multiSplit, 13);
  assert.equal(readMeasureGates("?multitx=1&split=25").multiSplit, 25);
  assert.equal(readMeasureGates("?multitx=1&split=12").invalidMultiSplit, true);
  assert.equal(readMeasureGates("?batchclosen1=1&count=8&cys=1").blockedByOtherGate, "cys");
  assert.equal(readMeasureGates("?batchclosen1=1&count=8&v1probe=1").blockedByOtherGate, "v1probe");
  assert.equal(readMeasureGates("?multitx=1&split=5&batchcloseprobe=1").blockedByOtherGate, "batchcloseprobe");
});

test("flat V0 batch close matches the N1 account layout and has no compute budget", () => {
  for (const count of CONTROL_COUNTS) {
    const built = buildFlatBatchCloseV0({
      authority: N1_CONTROL_WALLET,
      atas: atas(count),
      recentBlockhash: blockhash,
    });
    const facts = txFacts(built.transaction);
    assert.equal(facts.version, 0);
    assert.equal(facts.lookupTables, 0);
    assert.equal(facts.cuIx, false);
    assert.equal(facts.lighthouseIx, 0);
    assert.equal(facts.discriminator, 0);
    assert.equal(facts.uniqueAccounts, count + 3);
    assert.equal(facts.writable, count + 1);
    assert.ok(facts.bytes <= 1232);
    const ix = TransactionMessage.decompile(built.transaction.message).instructions;
    assert.equal(ix.length, 1);
    assert.equal(ix[0].programId.toBase58(), BATCH_CLOSE_PROGRAM_ID);
    assert.deepEqual([...ix[0].data], [0]);
    assert.equal(ix[0].keys[0].pubkey.toBase58(), N1_CONTROL_WALLET);
    assert.equal(ix[0].keys[0].isSigner, true);
    assert.equal(ix[0].keys[0].isWritable, true);
    assert.equal(ix[0].keys[1].pubkey.toBase58(), TOKEN_PROGRAM_ID);
    assert.equal(ix[0].keys[1].isWritable, false);
    assert.equal(ix[0].keys.at(-1)?.isWritable, true);
  }
  const list = atas(4);
  const first = buildFlatBatchCloseV0({
    authority: N1_CONTROL_WALLET,
    atas: list.slice(0, 2),
    recentBlockhash: blockhash,
  });
  const second = buildFlatBatchCloseV0({
    authority: N1_CONTROL_WALLET,
    atas: list.slice(0, 2),
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  });
  assert.equal(first.transaction.serialize().length, second.transaction.serialize().length);
});

test("empty classic filter and two-tx split keep RPC order", () => {
  assert.equal(isEmptyClassicAta({ parsedType: "account", owner: "A", amount: "0" }, "A"), true);
  assert.equal(isEmptyClassicAta({ parsedType: "account", owner: "A", amount: "1" }, "A"), false);
  assert.equal(isEmptyClassicAta({ parsedType: "mint", owner: "A", amount: "0" }, "A"), false);
  const list = ["a", "b", "c", "d", "e"];
  assert.deepEqual(splitEmpties(list, 2), [
    ["a", "b"],
    ["c", "d"],
  ]);
  assert.equal(splitEmpties(list, 3), null);
});

test("signTransaction control is sendless and does not call signAndSend", async () => {
  const list = atas(12);
  const wallet = provider();
  const record = logs();
  const entry = await runBatchCloseLadder({
    api: "signTransaction",
    count: 8,
    attempt: 2,
    host,
    io: io(list),
    provider: wallet,
    phantomVersion: "26.10.1",
    now: when,
    log: record.log,
  });
  assert.equal(record.entries.length, 1);
  assert.equal(entry.result, "OK");
  assert.equal(entry.api, "signTransaction");
  assert.equal(entry.send, "sendless");
  assert.equal(entry.broadcastOnApprove, false);
  assert.equal(entry.signature, null);
  assert.equal(entry.cuIx, false);
  assert.equal(entry.uniqueAccounts, 11);
  assert.equal(entry.writable, 9);
  assert.equal(entry.attempt, 2);
  assert.equal(entry.at, "2026-10-28T15:00:00.000Z");
  assert.equal(entry.phantomVersion, "26.10.1");
  assert.equal(entry.simVisible, null);
  assert.equal(entry.rpcSimOk, true);
  assert.deepEqual(wallet.calls, ["signTransaction"]);
});

test("signAndSend uses the same bytes and broadcasts only if the wallet resolves", async () => {
  const list = atas(12);
  let seenBytes = 0;
  const wallet = provider({
    signAndSendTransaction: async (tx, options) => {
      wallet.calls.push("signAndSendTransaction");
      seenBytes = tx.serialize().length;
      assert.deepEqual(options, SIGN_AND_SEND_PROBE_OPTIONS);
      return { signature: "5".repeat(88) };
    },
  });
  const control = await runBatchCloseLadder({
    api: "signTransaction",
    count: 9,
    attempt: 1,
    host,
    io: io(list),
    provider: wallet,
    phantomVersion: null,
    now: when,
    log: () => undefined,
  });
  const sent = await runBatchCloseLadder({
    api: "signAndSendTransaction",
    count: 9,
    attempt: 1,
    host,
    io: io(list),
    provider: wallet,
    phantomVersion: null,
    now: when,
    log: () => undefined,
  });
  assert.equal(control.bytes, sent.bytes);
  assert.equal(control.uniqueAccounts, sent.uniqueAccounts);
  assert.equal(seenBytes, sent.bytes);
  assert.equal(sent.result, "BROADCAST");
  assert.equal(sent.send, "real");
  assert.equal(sent.broadcastOnApprove, true);
  assert.equal(sent.signature, "5".repeat(88));
  assert.equal(wallet.calls.includes("signTransaction"), true);
  assert.equal(wallet.calls.includes("signAndSendAllTransactions"), false);
});

test("Phantom block text is RED and a bare cancel is not", async () => {
  const blocked = provider({
    signAndSendTransaction: async () => {
      throw Object.assign(new Error("İstek engellendi"), { code: 4001 });
    },
  });
  const red = await runBatchCloseLadder({
    api: "signAndSendTransaction",
    count: 9,
    attempt: 3,
    host,
    io: io(atas(10)),
    provider: blocked,
    phantomVersion: null,
    now: when,
    log: () => undefined,
  });
  assert.equal(red.result, "RED");
  assert.equal(red.send, "sendless");
  assert.equal(red.broadcastOnApprove, true);
  assert.equal(red.walletOpened, true);
  assert.equal(red.screenText, "İstek engellendi");
  assert.equal(red.signature, null);

  const cancel = provider({
    signTransaction: async () => {
      throw Object.assign(new Error("User rejected the request"), { code: 4001 });
    },
  });
  const cancelled = await runBatchCloseLadder({
    api: "signTransaction",
    count: 8,
    attempt: 1,
    host,
    io: io(atas(10)),
    provider: cancel,
    phantomVersion: null,
    now: when,
    log: () => undefined,
  });
  assert.equal(cancelled.result, "CANCEL");
  assert.equal(classifyWalletError(new Error("simulation failed")).result, "FAIL");
});

test("a failed sim or a short account list never opens the wallet", async () => {
  const wallet = provider();
  const sim = await runBatchCloseLadder({
    api: "signTransaction",
    count: 8,
    attempt: 1,
    host,
    io: io(atas(10), { err: { InstructionError: [0, "Custom"] } }),
    provider: wallet,
    phantomVersion: null,
    now: when,
    log: () => undefined,
  });
  assert.equal(sim.result, "FAIL");
  assert.equal(sim.walletOpened, false);
  assert.equal(sim.rpcSimOk, false);
  assert.match(sim.note ?? "", /Not RED/);
  const shortIo = io(atas(3));
  const short = await runBatchCloseLadder({
    api: "signAndSendTransaction",
    count: 8,
    attempt: 1,
    host,
    io: shortIo,
    provider: wallet,
    phantomVersion: null,
    now: when,
    log: () => undefined,
  });
  assert.equal(short.walletOpened, false);
  assert.equal(short.broadcastOnApprove, false);
  assert.match(short.note ?? "", /yeterli boş/);
  assert.equal(shortIo.listed, 1);
  const blockedHost = io(atas(10));
  const wrong = await runBatchCloseLadder({
    api: "signTransaction",
    count: 8,
    attempt: 1,
    host: { ...host, walletName: "Solflare" },
    io: blockedHost,
    provider: wallet,
    phantomVersion: null,
    now: when,
    log: () => undefined,
  });
  assert.equal(wrong.walletOpened, false);
  assert.equal(blockedHost.listed, 0);
  assert.deepEqual(wallet.calls, []);
  assert.equal(hostBlockReason(host), null);
  assert.ok(hostBlockReason({ ...host, network: "devnet" }));
});

test("two-tx probe signs both halves and never calls the sending batch API", async () => {
  const list = atas(12);
  const signed: VersionedTransaction[][] = [];
  const wallet = provider({
    signAllTransactions: async (txs) => {
      wallet.calls.push("signAllTransactions");
      signed.push(txs);
      return txs;
    },
  });
  const standardCalls: unknown[] = [];
  const standard: WalletStandardWallet = {
    name: "Phantom",
    accounts: [{ address: N1_CONTROL_WALLET }],
    features: {
      "solana:signTransaction": {
        signTransaction: async (...inputs) => {
          standardCalls.push(inputs);
          return inputs.map((input) => ({ signedTransaction: input.transaction }));
        },
      },
    },
  };
  const entry = await runMultiTxProbe({
    split: 5,
    attempt: 1,
    host,
    io: io(list),
    provider: wallet,
    wallets: [standard],
    phantomVersion: null,
    now: when,
    log: () => undefined,
  });
  assert.equal(entry.result, "OK");
  assert.equal(entry.api, "signAllTransactions");
  assert.equal(entry.send, "sendless");
  assert.equal(entry.broadcastOnApprove, false);
  assert.equal(entry.approvalScreens, null);
  assert.equal(entry.perTx?.length, 2);
  assert.equal(entry.perTx?.[0].n, 5);
  assert.equal(entry.perTx?.[1].n, 5);
  assert.equal(entry.cuIx, false);
  assert.deepEqual(wallet.calls, ["signAllTransactions"]);
  assert.equal(standardCalls.length, 0);
  const firstKeys = signed[0][0].message.staticAccountKeys.map((key) => key.toBase58());
  const secondKeys = signed[0][1].message.staticAccountKeys.map((key) => key.toBase58());
  const onlyFirst = firstKeys.filter((key) => !secondKeys.includes(key));
  const onlySecond = secondKeys.filter((key) => !firstKeys.includes(key));
  assert.equal(onlyFirst.length, 5);
  assert.equal(onlySecond.length, 5);
  assert.deepEqual(onlyFirst, list.slice(0, 5));
  assert.deepEqual(onlySecond, list.slice(5, 10));
});

test("multi-tx falls back to wallet-standard signTransaction and refuses signAndSendAll", async () => {
  const inputs: unknown[] = [];
  const wallet = provider({
    signAllTransactions: undefined,
    signAndSendAllTransactions: undefined,
  });
  const standard: WalletStandardWallet = {
    name: "Phantom",
    accounts: [{ address: N1_CONTROL_WALLET }],
    features: {
      "solana:signTransaction": {
        supportedTransactionVersions: [0],
        signTransaction: async (...sent) => {
          inputs.push(sent);
          return sent.map((input) => ({ signedTransaction: input.transaction }));
        },
      },
    },
  };
  const entry = await runMultiTxProbe({
    split: 5,
    attempt: 4,
    host,
    io: io(atas(10)),
    provider: wallet,
    wallets: [standard],
    phantomVersion: null,
    now: when,
    log: () => undefined,
  });
  assert.equal(entry.result, "OK");
  assert.equal(entry.api, "wallet-standard:solana:signTransaction");
  assert.equal(inputs.length, 1);
  assert.equal((inputs[0] as unknown[]).length, 2);
  assert.equal(wallet.calls.includes("signAndSendAllTransactions"), false);

  const sending = provider({ signAllTransactions: undefined });
  const refused = await runMultiTxProbe({
    split: 13,
    attempt: 1,
    host,
    io: io(atas(30)),
    provider: sending,
    wallets: [],
    phantomVersion: null,
    now: when,
    log: () => undefined,
  });
  assert.equal(refused.result, "FAIL");
  assert.equal(refused.walletOpened, false);
  assert.match(refused.note ?? "", /signAndSendAllTransactions would broadcast/);
  assert.deepEqual(sending.calls, []);
});

test("5+5 does not open the wallet when there are not enough empties", async () => {
  const wallet = provider({
    signAllTransactions: async (txs) => txs,
  });
  const entry = await runMultiTxProbe({
    split: 5,
    attempt: 1,
    host,
    io: io(atas(9)),
    provider: wallet,
    wallets: [],
    phantomVersion: null,
    now: when,
    log: () => undefined,
  });
  assert.equal(entry.result, "FAIL");
  assert.match(entry.note ?? "", /Not RED/);
  assert.deepEqual(wallet.calls, []);
});

test("annotation can mark a cancel as OK and cannot hide a broadcast", () => {
  const cancel = {
    result: "CANCEL",
    send: "sendless",
    note: "cancelled",
    screenText: null,
    simVisible: null,
  } as MeasureEntry;
  const marked = annotateEntry(cancel, { result: "OK", screenText: "normal preview", simVisible: true, approvalScreens: 1, presentation: "batch" }, when);
  assert.equal(marked.result, "OK");
  assert.equal(marked.send, "sendless");
  assert.equal(marked.screenText, "normal preview");
  assert.equal(marked.simVisible, true);
  assert.equal(marked.approvalScreens, 1);
  assert.equal(marked.presentation, "batch");
  assert.equal(marked.annotated, true);

  const broadcast = { result: "BROADCAST", send: "real", note: "landed", screenText: null } as MeasureEntry;
  const kept = annotateEntry(broadcast, { result: "OK" }, when);
  assert.equal(kept.result, "BROADCAST");
  assert.equal(kept.send, "real");
  assert.match(kept.note ?? "", /Broadcast stays real/);
});

test("panel plan is gated, does not auto-run, and keeps the SAS button dangerous", () => {
  assert.equal(planPanel("", host).visible, false);
  const plan = planPanel("?batchclosen1=1&count=9", host);
  assert.equal(plan.autoRun, false);
  assert.deepEqual(plan.buttons.map((button) => button.id), ["control", "sas"]);
  assert.equal(plan.buttons[0].danger, false);
  assert.equal(plan.buttons[0].disabled, false);
  assert.equal(plan.buttons[1].danger, true);
  assert.equal(plan.countLinks.find((link) => link.count === 9)?.suggested, true);
  assert.equal(plan.countLinks.find((link) => link.count === 1)?.suggested, false);
  const blocked = planPanel("?batchclosen1=1&count=9&cys=1", host);
  assert.equal(blocked.buttons.every((button) => button.disabled), true);
  const multi = planPanel("?multitx=1&split=5", host);
  assert.equal(multi.buttons[0].id, "multitx");
  assert.equal(multi.buttons[0].danger, false);
  assert.match(multi.warnings.join(" "), /signAndSendAllTransactions kullanılmaz/);
});

test("attempt counter and phantom discovery", () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
  };
  const next = createAttemptCounter(storage);
  assert.equal(next("sas"), 1);
  assert.equal(next("sas"), 2);
  assert.equal(next("control"), 1);
  const found = discoverPhantomProvider({
    phantom: { solana: { isPhantom: true, publicKey: { toBase58: () => N1_CONTROL_WALLET } } },
    solana: { isPhantom: true },
  });
  assert.equal(found?.isPhantom, true);
  assert.equal(discoverPhantomProvider({ solana: { isPhantom: false } }), null);
  const choice = selectMultiSign({
    provider: { isPhantom: true, signAllTransactions: async (txs) => txs },
    wallets: [],
    walletAddress: N1_CONTROL_WALLET,
  });
  assert.equal(choice.ok && choice.api, "signAllTransactions");
});

test("probe sources do not submit and do not lower the production cap", () => {
  const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const name of ["runLadder.ts", "runMultiTx.ts", "probeIo.ts", "panel.ts", "index.ts"]) {
    const source = code(read(name));
    assert.equal(source.includes("sendRawTransaction"), false, name);
    assert.equal(source.includes("/api/batchclose/submit"), false, name);
    assert.equal(source.includes("WALLET_APPROVAL_ACTION_CAP"), false, name);
  }
  assert.equal(code(read("runMultiTx.ts")).includes("signAndSendAllTransactions"), false);
  assert.match(read("probeIo.ts"), new RegExp(BATCH_CLOSE_RPC_PATH.replaceAll("/", "\\/")));
  assert.match(read("constants.ts"), /maxRetries: 3/);
});
