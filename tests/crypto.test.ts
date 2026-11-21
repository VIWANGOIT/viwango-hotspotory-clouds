import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, hashToken, maskSecret } from "@/lib/crypto";

beforeEach(() => {
  process.env.ROUTER_CREDENTIALS_KEY = randomBytes(32).toString("base64");
});

describe("router credential encryption", () => {
  it("round trips a password", () => {
    const secret = "s3cr3t-p@ssw0rd";
    const payload = encryptSecret(secret);

    expect(payload).not.toContain(secret);
    expect(payload.startsWith("v1:")).toBe(true);
    expect(decryptSecret(payload)).toBe(secret);
  });

  it("uses a fresh IV for every encryption", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("refuses tampered ciphertext", () => {
    const payload = encryptSecret("hunter2");
    const parts = payload.split(":");
    const tampered = Buffer.from(parts[3], "base64");
    tampered[0] ^= 0xff;
    parts[3] = tampered.toString("base64");

    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("fails clearly when the key is missing", () => {
    delete process.env.ROUTER_CREDENTIALS_KEY;
    expect(() => encryptSecret("x")).toThrow(/ROUTER_CREDENTIALS_KEY/);
  });

  it("accepts a hex key", () => {
    process.env.ROUTER_CREDENTIALS_KEY = randomBytes(32).toString("hex");
    expect(decryptSecret(encryptSecret("hex-key"))).toBe("hex-key");
  });

  it("masks secrets for display", () => {
    expect(maskSecret("abcdefgh")).toBe("a******h");
    expect(maskSecret("ab")).toBe("**");
  });

  it("hashes agent tokens deterministically", () => {
    expect(hashToken("token")).toBe(hashToken("token"));
    expect(hashToken("token")).not.toBe(hashToken("other"));
  });
});
