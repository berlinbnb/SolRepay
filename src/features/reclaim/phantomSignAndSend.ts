/**
 * Phantom production broadcast. Same wallet call as batchtest mode=signsend:
 * window.phantom.solana.signAndSendTransaction. The wallet submits the
 * transaction, so the app must not call submit / sendTransaction again.
 * Confirmation stays on the existing status/receipt path.
 *
 * The signsend probe's test-wallet allowlist does not apply here.
 */

export type PhantomSignAndSendOptions = {
  skipPreflight: false;
  preflightCommitment: "confirmed";
  maxRetries: 3;
};

export const PHANTOM_SIGN_AND_SEND_OPTIONS: PhantomSignAndSendOptions = {
  skipPreflight: false,
  preflightCommitment: "confirmed",
  maxRetries: 3,
};

export type PhantomSignAndSendProvider = {
  isConnected?: boolean;
  connect?: () => Promise<unknown>;
  signAndSendTransaction?: (
    transaction: unknown,
    options?: PhantomSignAndSendOptions,
  ) => Promise<unknown>;
};

export type PhantomSignAndSendResult = {
  signature: string;
  /** Wallet already broadcast. Callers must not app-submit this transaction. */
  appSubmit: false;
};

export async function phantomSignAndSendTransaction(input: {
  provider: PhantomSignAndSendProvider | null | undefined;
  transaction: unknown;
  current: () => boolean;
}): Promise<PhantomSignAndSendResult> {
  if (!input.current()) throw new Error("Wallet account changed.");
  const provider = input.provider;
  if (!provider || typeof provider.signAndSendTransaction !== "function") {
    throw new Error("window.phantom.solana.signAndSendTransaction not available.");
  }
  if (!provider.isConnected && provider.connect) await provider.connect();
  if (!input.current()) throw new Error("Wallet account changed.");
  const raw = await provider.signAndSendTransaction(
    input.transaction,
    PHANTOM_SIGN_AND_SEND_OPTIONS,
  );
  if (!input.current()) throw new Error("Wallet account changed.");
  return { signature: readPhantomSignature(raw), appSubmit: false };
}

function readPhantomSignature(value: unknown): string {
  if (typeof value === "string" && value.length >= 64) return value;
  if (value instanceof Uint8Array && value.length >= 32) return encodeBase58(value);
  if (value && typeof value === "object" && "signature" in value) {
    const signature = (value as { signature: unknown }).signature;
    if (typeof signature === "string" && signature.length >= 64) return signature;
    if (signature instanceof Uint8Array && signature.length >= 32) return encodeBase58(signature);
  }
  throw new Error("Phantom signAndSendTransaction returned an unexpected signature.");
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let encoded = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded += "1";
  }
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    encoded += BASE58_ALPHABET[digits[index]];
  }
  return encoded;
}
