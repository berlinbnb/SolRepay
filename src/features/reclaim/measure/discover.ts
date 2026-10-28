import type { VersionedTransaction } from "@solana/web3.js";

export type PhantomProbeProvider = {
  isPhantom?: boolean;
  isConnected?: boolean;
  publicKey?: { toBase58(): string } | null;
  version?: string;
  signTransaction?: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  signAndSendTransaction?: (
    tx: VersionedTransaction,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  signAllTransactions?: (txs: VersionedTransaction[]) => Promise<VersionedTransaction[]>;
  signAndSendAllTransactions?: (...args: unknown[]) => Promise<unknown>;
};

export type WalletStandardAccount = {
  address: string;
  publicKey?: Uint8Array;
};

export type WalletStandardSignInput = {
  account: WalletStandardAccount;
  transaction: Uint8Array;
  chain: "solana:mainnet";
};

export type WalletStandardWallet = {
  name: string;
  accounts: readonly WalletStandardAccount[];
  features: Record<
    string,
    {
      supportedTransactionVersions?: readonly (0 | 1 | "legacy")[];
      signTransaction?: (
        ...inputs: WalletStandardSignInput[]
      ) => Promise<readonly { signedTransaction: Uint8Array }[]>;
    }
  >;
};

export type InjectedScope = {
  phantom?: { solana?: PhantomProbeProvider | null } | null;
  solana?: PhantomProbeProvider | null;
  wallets?: { get?: () => readonly WalletStandardWallet[] } | null;
};

/** Same provider pick as the live N1 probe: `window.phantom.solana`, else Phantom `window.solana`. */
export function discoverPhantomProvider(scope: InjectedScope | null | undefined): PhantomProbeProvider | null {
  const injected = scope?.phantom?.solana ?? (scope?.solana?.isPhantom ? scope.solana : null);
  return injected?.isPhantom ? injected : null;
}

export function listStandardWallets(scope: InjectedScope | null | undefined): readonly WalletStandardWallet[] {
  const get = scope?.wallets?.get;
  if (typeof get !== "function") return [];
  try {
    return get.call(scope.wallets) ?? [];
  } catch {
    return [];
  }
}

export function readProviderVersion(provider: PhantomProbeProvider | null | undefined): string | null {
  const version = provider?.version;
  return typeof version === "string" && version.trim() ? version.trim() : null;
}

export type MultiSignChoice =
  | { ok: true; api: "signAllTransactions" }
  | {
      ok: true;
      api: "wallet-standard:solana:signTransaction";
      wallet: WalletStandardWallet;
      account: WalletStandardAccount;
    }
  | { ok: false; api: "unavailable"; reason: string };

/**
 * Prefer Phantom's `signAllTransactions` (sendless, legacy, not Wallet Standard).
 * Otherwise one Wallet Standard `solana:signTransaction` call with two inputs.
 * `signAndSendAllTransactions` is detected and refused: it broadcasts on approve.
 */
export function selectMultiSign(input: {
  provider: PhantomProbeProvider | null;
  wallets: readonly WalletStandardWallet[];
  walletAddress: string;
}): MultiSignChoice {
  if (typeof input.provider?.signAllTransactions === "function") {
    return { ok: true, api: "signAllTransactions" };
  }
  const standard = input.wallets.find((wallet) => {
    if (!/phantom/i.test(wallet.name)) return false;
    const feature = wallet.features["solana:signTransaction"];
    if (typeof feature?.signTransaction !== "function") return false;
    const versions = feature.supportedTransactionVersions;
    if (versions && !versions.includes(0) && !versions.includes("legacy")) return false;
    return wallet.accounts.some((account) => account.address === input.walletAddress);
  });
  if (standard) {
    const account = standard.accounts.find((item) => item.address === input.walletAddress);
    if (account) {
      return { ok: true, api: "wallet-standard:solana:signTransaction", wallet: standard, account };
    }
  }
  if (typeof input.provider?.signAndSendAllTransactions === "function") {
    return {
      ok: false,
      api: "unavailable",
      reason:
        "signAndSendAllTransactions would broadcast on approve and is not used. No sendless multi-transaction API was found.",
    };
  }
  return {
    ok: false,
    api: "unavailable",
    reason:
      "No sendless multi-transaction API was found (signAllTransactions missing, Wallet Standard solana:signTransaction missing).",
  };
}

export function providerMatchesWallet(
  provider: PhantomProbeProvider | null,
  walletAddress: string,
): string | null {
  if (!provider?.isPhantom) return "Aktif Phantom hesabı eşleşmiyor veya sağlayıcı yok.";
  if (provider.publicKey?.toBase58() !== walletAddress) {
    return "Aktif Phantom hesabı eşleşmiyor veya signTransaction yok.";
  }
  return null;
}
