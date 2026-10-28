# Phantom reclaim: signAndSendTransaction, cap 13

Measured 2026-10-28 on Phantom `signAndSendTransaction` (same call as `?batchtest=1&mode=signsend&bsize=N`):

| Closes in one transaction | Result |
| --- | --- |
| 13 | Accepted. No Phantom «İstek engellendi». |
| 14 | Blocked. |

## What production was doing

Checked on the live worker `solrepay` (wrangler deploy, version `560118d3`, 2026-10-28 01:07 UTC).

- Phantom (`/phantom/i` on the wallet name) with `phantomChunkGuard` on (the default) packed with cap **5** and then used Wallet Standard `signTransaction` plus app submit. That is the path that had to stay at 5.
- `?batchtest=1&mode=signsend` already calls `window.phantom.solana.signAndSendTransaction` and does not app-submit. `bsize` overrides the cap for that probe only.
- Everyone else, including Solflare, uses `signAll` and cap **10**.

The fullscreen notice is not a hardcoded “more than 5”. It opens when Phantom has more than one packed chunk. Raising the cap to 13 moves that threshold with the packer. A single chunk of 13 closes does not show it.

## Production intent

- Phantom with the guard on: `signAndSendTransaction`, chunks of at most **13** closes. The wallet broadcasts, so there is no second app submit. Receipts still confirm through the existing status path.
- More than one chunk of 13 (or an earlier byte-budget split) is the only multi-approval case. Turkish and English copy says 13, including «13'ten fazla hesapta birden fazla onay».
- `NON_PHANTOM_BATCH_ACTION_CAP` stays **10**. Solflare stays on `signAll`. Solflare `signAndSendTransaction` was not measured, so its cap was not raised and it was not moved onto that API. The older unverified-domain warning was seen near 20 closes with older packing, which this cap does not use.
- `?batchtest=1&mode=signsend&bsize=N` is unchanged, including `bsize` above 13 for probes. Other batchtest modes stay on their existing branches.
- The byte budget can still split a chunk before 13 closes. The quote still keeps its existing transaction count limit.

Guard off still means the previous Phantom sign-then-submit path and the non-Phantom cap of 10. That matches the admin switch.

## Deploy

This GitHub repo does not contain the Next.js app, `wrangler.toml`, or a deploy workflow. Production is the Cloudflare Worker `solrepay`, deployed from the private tree with wrangler (OpenNext). Apply `WALLET_APPROVAL_ACTION_CAP` / the phantomChunkGuard cap (`n`, was 5), the Phantom execute branch, and the Turkish/English strings there, then deploy with the usual wrangler command from that tree. Do not deploy this repository as the worker.

Constants in this repo:

| Name | Value |
| --- | --- |
| `WALLET_APPROVAL_ACTION_CAP` | 13 |
| `NON_PHANTOM_BATCH_ACTION_CAP` | 10 |

Files: `src/domain/walletApprovalCap.ts`, `src/features/reclaim/phantomSignAndSend.ts`, `src/i18n/phantomChunkCopy.ts`.
