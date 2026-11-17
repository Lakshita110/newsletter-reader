import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Symmetric encryption for secrets we must store (the Gmail refresh token).
 * A refresh token grants ongoing read access to the mailbox, so a database
 * dump alone must not be enough to use it: the key comes from NEXTAUTH_SECRET,
 * which lives only in Vercel's env, never in the DB.
 *
 * Format: v1.<iv>.<authTag>.<ciphertext>, each base64url. AES-256-GCM so
 * tampering is detected rather than decrypting to garbage.
 */
const VERSION = "v1";

function key(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set; cannot encrypt or decrypt stored tokens");
  // Domain-separated so this key is never the same bytes NextAuth uses for JWTs.
  return createHash("sha256").update(`gmail-refresh-token:${secret}`).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Throws on a wrong key, tampering, or an unknown format; callers decide how to recover. */
export function decryptSecret(encoded: string): string {
  const [version, iv, tag, ciphertext] = encoded.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("Unrecognized encrypted token format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
