import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "./token-crypto";

beforeEach(() => vi.stubEnv("NEXTAUTH_SECRET", "test-secret"));
afterEach(() => vi.unstubAllEnvs());

describe("token-crypto", () => {
  it("round-trips and never stores the plaintext", () => {
    const enc = encryptSecret("1//refresh-token");
    expect(enc).not.toContain("refresh-token");
    expect(decryptSecret(enc)).toBe("1//refresh-token");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("rejects tampering and a rotated secret", () => {
    const enc = encryptSecret("token");
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
    vi.stubEnv("NEXTAUTH_SECRET", "rotated");
    expect(() => decryptSecret(enc)).toThrow();
  });

  it("fails loudly without a secret", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");
    expect(() => encryptSecret("x")).toThrow(/NEXTAUTH_SECRET/);
  });
});
