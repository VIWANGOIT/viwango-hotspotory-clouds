import { describe, expect, it } from "vitest";
import {
  formatVoucherCode,
  generateVoucherBatch,
  generateVoucherCode,
  isValidVoucherCodeShape,
  normalizeVoucherCode,
} from "@/lib/vouchers";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

describe("voucher codes", () => {
  it("avoids characters that customers misread", () => {
    for (let index = 0; index < 200; index += 1) {
      const code = generateVoucherCode(10);
      expect(code).toHaveLength(10);
      for (const character of code) {
        expect(ALPHABET).toContain(character);
      }
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it("generates unique codes in a batch", () => {
    const batch = generateVoucherBatch(250, 8);
    expect(batch).toHaveLength(250);
    expect(new Set(batch).size).toBe(250);
  });

  it("normalizes what a customer types", () => {
    expect(normalizeVoucherCode(" abcd-2345 ")).toBe("ABCD2345");
    expect(normalizeVoucherCode("AB CD 23 45")).toBe("ABCD2345");
    expect(formatVoucherCode("abcd2345")).toBe("ABCD-2345");
  });

  it("validates code shape", () => {
    expect(isValidVoucherCodeShape("ABCD2345")).toBe(true);
    expect(isValidVoucherCodeShape("A-B-C-D")).toBe(true);
    expect(isValidVoucherCodeShape("ab")).toBe(false);
  });

  it("rejects unsupported lengths", () => {
    expect(() => generateVoucherCode(3)).toThrow(RangeError);
    expect(() => generateVoucherCode(33)).toThrow(RangeError);
  });
});
