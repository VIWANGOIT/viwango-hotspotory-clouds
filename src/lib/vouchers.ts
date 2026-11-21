import { randomInt } from "node:crypto";

// No 0/O/1/I/L: these are the characters customers mistype from a printed slip.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const DEFAULT_VOUCHER_LENGTH = 8;

export function generateVoucherCode(length = DEFAULT_VOUCHER_LENGTH): string {
  if (length < 4 || length > 32) throw new RangeError("Voucher length must be between 4 and 32");
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

export function generateVoucherBatch(count: number, length = DEFAULT_VOUCHER_LENGTH): string[] {
  const unique = new Set<string>();
  const target = Math.max(1, Math.min(count, 5000));
  let guard = 0;
  while (unique.size < target && guard < target * 20) {
    unique.add(generateVoucherCode(length));
    guard += 1;
  }
  return [...unique];
}

export function normalizeVoucherCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidVoucherCodeShape(input: string): boolean {
  const code = normalizeVoucherCode(input);
  return code.length >= 4 && code.length <= 32;
}

export function formatVoucherCode(input: string): string {
  const code = normalizeVoucherCode(input);
  if (code.length <= 4) return code;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
