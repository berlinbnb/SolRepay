# Phantom measurement — steps 1 and 4

Gated probes only. Production **Geri Al** stays on `signAndSendTransaction` with **CAP 13**. BatchClose is not added to that path. Do not deploy this repo as the worker; wire the panel into the private tree and deploy from there.

There is no `chunkedReclaim` symbol in the live bundle (worker `solrepay`, version 175, 2026-10-28). Packing for Geri Al is the quote’s `maxActions`. The N1 ladder is `runBatchCloseN1Probe` at `?batchclosen1=1&count=`. These probes use that same flat V0 BatchClose: program `6RmyrtFAEYocx2NMHuH6FzdLvmEr3UDFdJrsrpPZ7F75`, one instruction, data byte `0`, no address-lookup table, no compute-budget instruction on the unsigned transaction. Empty classic Token ATAs, RPC order, no sort. `CONTROL_COUNTS`: 1, 5, 6, 8, 9, 10, 13, 20, 28.

## Gates

| URL | What runs |
| --- | --- |
| `?batchclosen1=1&count=N` | Existing **signTransaction** control (unchanged, sendless) **and** the new measurement buttons. |
| `?multitx=1&split=5` (or 13, 25) | Two transactions, `split+split`. Sendless. |

`cys`, `v1probe=1`, or `batchcloseprobe=1` keeps these buttons off. Nothing auto-runs.

Suggested N order, as links only: **9, 5, 13, 8, 10**, then the rest of `CONTROL_COUNTS` if you want them. For each N, run **signTransaction** first, then **signAndSend** and press **Cancel** on a normal sheet. Do not approve signAndSend.

## Wire

In the reclaim panel, next to the existing N1 fieldset, mount a div and:

```tsx
useEffect(() => {
  const el = slotRef.current;
  if (!el) return;
  return attachPhantomMeasureProbes(el, {
    walletAddress: connection.address,
    walletName: connection.name,
    network: config.network,
    chain: connection.chain,
  });
}, [connection.address, connection.name, config.network, connection.chain, search]);
```

Import from `src/features/reclaim/measure/index.ts`. Drop a `.ts` suffix if the bundler rejects it. Allowlist, name `Phantom`, mainnet, and cluster checks match the live N1 probe. The existing control button stays.

## What you do

1. Phantom **mainnet**, allowlisted N1 wallet. Type the Phantom version (Settings → About) into the box once.
2. Copy each `[solrepay:measure]` object from the console. The page also keeps them on `window.__solrepayMeasure`.
3. After a sheet, fill screen text, whether a simulation was visible, approval-screen count, and batch vs one-by-one, then **Notu loga yaz**. Use that annotated object.
4. `at` is the UTC time of the attempt. Write that down with the Phantom version.

## Columns

`n`, `attempt`, `api`, `result`, `screenText`, `simVisible`, `bytes`, `uniqueAccounts`, `writable`, `cuIx`, `send`, `phantomVersion`, `at`.

Also useful: `broadcastOnApprove`, `rpcSimOk`, `perTx`, `signedBytes`, `signedCuIx`, `walletOpened`, `note`, `signature` (only if a broadcast happened).

`bytes` / accounts / `cuIx` are the **unsigned** packet we handed Phantom (same size notion as `[batchclose:control:prepared]`). `simVisible` stays empty until you mark what the sheet showed. `rpcSimOk` is our RPC simulate before the wallet opens.

## Sendless vs real

| API | On approve |
| --- | --- |
| `signTransaction` (control) | Sendless. Signature returns, nothing is submitted. |
| `signAndSendTransaction` | **Real broadcast** if you approve. Same options as Geri Al (`skipPreflight: false`, `preflightCommitment: confirmed`, `maxRetries: 3`). The app does not submit again and does not poll. **Press Cancel** on a normal preview. |
| `signAllTransactions` | Sendless. App does not send the signed bytes. |
| `wallet-standard:solana:signTransaction` | Sendless fallback: one call, two inputs. |
| `signAndSendAllTransactions` | **Not called.** It would broadcast. |

If `result` is `BROADCAST`, stop. Accounts may have closed. Do not relabel that row sendless.

`FAIL` with “wallet was not opened” or “Not RED” (not enough ATAs, sim error, bad count) is **not** a ladder point.

## Step 4

Run **5+5 first**. That pair has to be green for the surface itself. If 5+5 is RED, stop; do not read 13+13 or 25+25 as a size limit. 5+5 needs 10 empty classic ATAs, 13+13 needs 26, 25+25 needs 50. A shortfall is `FAIL`, not RED.

Record how many approval screens you saw and whether Phantom showed one batch sheet or one sheet per transaction (`approvalScreens`, `presentation`).

## Phantom docs (checked 2026-10-28)

- Browser provider, [Send a legacy transaction](https://docs.phantom.com/solana/sending-a-transaction): `signAndSendTransaction` is still the documented way to sign **and submit** one transaction. `signAllTransactions` still exists on `window.phantom.solana` / `window.solana`, does **not** submit, and is marked legacy. The same page says those sign-only methods are **not** in Wallet Standard and may be removed. The recommended multi-tx method that **does** submit is `signAndSendAllTransactions`. This probe does not call it.
- Wallet Standard sendless equivalent used here: one `solana:signTransaction` feature call with **two inputs** (rest arguments, not `signAndSend`).
- Deeplink `signAndSendTransaction` is [deprecated](https://docs.phantom.com/phantom-deeplinks/provider-methods/signandsendtransaction) in favor of the sign / signAll **deeplinks**. That deprecation is the mobile deeplink, not the browser provider this probe calls. Deeplink `signAllTransactions` still returns signed transactions and does not submit.

## How to read the ladder

Compare the same N on `signTransaction` and `signAndSendTransaction`. Map a normal preview you cancelled to **OK**. Map «İstek engellendi» to **RED**. `CANCEL` with no screen text is unfinished until you annotate it.

- **8 and 9 agree** across the two APIs → the API is a weak explanation.
- **signTransaction breaks at 8/9 and signAndSend stays green through 13+** → the API matters. Do not lower CAP from this repo.
- **The break sits in 10–12** → both the API and the account count matter.
- **Same N flips OK/RED** → stop. Fix determinism (same wallet, same URL count, don’t approve signAndSend, don’t mix in another gate) before interpreting.

`signedCuIx` / `lighthouseIx` show whether Phantom added instructions before returning a signature. The unsigned `cuIx` we build is false.

`npm test` runs the gate, layout, and sendless checks. It does not open Phantom.
