import type { MeasureResult } from "./log.ts";

export function errorText(error: unknown): { message: string | null; code: string } {
  if (typeof error === "string") return { message: error, code: "" };
  if (error instanceof Error) {
    const code =
      "code" in error && (typeof error.code === "string" || typeof error.code === "number")
        ? String(error.code)
        : "";
    return { message: error.message || null, code };
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    const codeValue = (error as { code?: unknown }).code;
    const code = typeof codeValue === "string" || typeof codeValue === "number" ? String(codeValue) : "";
    return { message: typeof message === "string" ? message : null, code };
  }
  return { message: null, code: "" };
}

/**
 * RED is Phantom's block sheet («İstek engellendi» / request blocked).
 * A bare 4001 / user-reject is CANCEL, not RED: the live N1 probe folds
 * those together, and this ladder needs them apart.
 */
export function classifyWalletError(error: unknown): { result: Exclude<MeasureResult, "OK" | "BROADCAST">; screenText: string | null } {
  const { message, code } = errorText(error);
  const screenText = message?.trim() ? message.trim() : null;
  const blob = `${code} ${message ?? ""}`;
  if (/istek engell|request blocked|blocked by phantom|engellendi/i.test(blob)) {
    return { result: "RED", screenText };
  }
  if (/\b4001\b|user rejected|user cancel|rejected the request|declin/i.test(blob)) {
    return { result: "CANCEL", screenText };
  }
  return { result: "FAIL", screenText };
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(bytes: Uint8Array): string {
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

/** Reads a Phantom signAndSend result. Null means we could not see a signature. */
export function readSignature(value: unknown): string | null {
  if (typeof value === "string" && value.length >= 64) return value;
  if (value instanceof Uint8Array && value.length >= 32) return encodeBase58(value);
  if (value && typeof value === "object" && "signature" in value) {
    return readSignature((value as { signature: unknown }).signature);
  }
  return null;
}
