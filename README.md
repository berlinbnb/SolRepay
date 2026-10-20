# SolRepay

**Reclaim the SOL locked in your Solana wallet.** Website: https://solrepay.com

Every token account on Solana holds a small rent deposit (about 0.002 SOL). When an account is empty or unused, that SOL stays locked. SolRepay finds these accounts and lets you close them, returning the SOL to your own wallet.

## How it works
1. Connect your wallet (Phantom, Solflare, etc.).
2. SolRepay scans your token accounts and shows what can be reclaimed.
3. You review the amount and approve each transaction in your wallet.
4. The SOL goes straight back to your wallet.

## Security
- **Non-custodial:** we never hold your funds.
- **No seed phrase or private key** is ever requested.
- **You approve every transaction** in your own wallet before it is sent.
- Only official SPL Token instructions are used (`CloseAccount`, `WithdrawExcessLamports`).
- Accounts holding valuable tokens are never closed.
- A small service fee is shown before you sign.

## Free tool
- [Image metadata remover](https://solrepay.com/exif): removes EXIF and location data in your browser.

## Contact
- Website: https://solrepay.com
- X: https://x.com/isnotberlin
