import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { z } from "zod";

// ──────────────────────────────────────────────────────
// Configure @noble/ed25519 to use sha512 from @noble/hashes
// (required for environments without Web Crypto API)
// ──────────────────────────────────────────────────────

/**
 * Initialize the synchronous sha512 hash for @noble/ed25519 v3.
 * This must be called before any synchronous operations (getPublicKey, sign, verify).
 */
export function initSyncHash(): void {
  if (!ed.hashes.sha512) {
    ed.hashes.sha512 = (message: Uint8Array) => sha512(message);
  }
}

// Auto-initialize on module load
initSyncHash();

// ──────────────────────────────────────────────────────
// KeyPair Type
// ──────────────────────────────────────────────────────

export interface KeyPair {
  /** Ed25519 public key (32 bytes). */
  publicKey: Uint8Array;
  /** Ed25519 private key / seed (32 bytes). */
  privateKey: Uint8Array;
}

export const KeyPairHexSchema = z.object({
  publicKey: z.string().regex(/^[0-9a-f]{64}$/i, "Public key must be 64 hex characters (32 bytes)"),
  privateKey: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "Private key must be 64 hex characters (32 bytes)"),
});

export type KeyPairHex = z.infer<typeof KeyPairHexSchema>;

// ──────────────────────────────────────────────────────
// Key Generation
// ──────────────────────────────────────────────────────

/**
 * Generate a new Ed25519 keypair.
 *
 * Uses cryptographically secure random bytes for the private key seed.
 * The public key is derived deterministically from the private key.
 */
export async function generateKeypair(): Promise<KeyPair> {
  const privateKey = ed.utils.randomSecretKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { publicKey, privateKey };
}

/**
 * Synchronous variant of generateKeypair (uses sha512Sync).
 */
export function generateKeypairSync(): KeyPair {
  const privateKey = ed.utils.randomSecretKey();
  const publicKey = ed.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

/**
 * Derive the public key from a private key.
 */
export async function publicKeyFromPrivateKey(privateKey: Uint8Array): Promise<Uint8Array> {
  return ed.getPublicKeyAsync(privateKey);
}

/**
 * Synchronous variant of publicKeyFromPrivateKey.
 */
export function publicKeyFromPrivateKeySync(privateKey: Uint8Array): Uint8Array {
  return ed.getPublicKey(privateKey);
}

// ──────────────────────────────────────────────────────
// Hex Conversion Helpers
// ──────────────────────────────────────────────────────

/**
 * Convert a public key (Uint8Array) to a lowercase hex string.
 */
export function publicKeyToHex(publicKey: Uint8Array): string {
  return ed.etc.bytesToHex(publicKey);
}

/**
 * Convert a private key (Uint8Array) to a lowercase hex string.
 */
export function privateKeyToHex(privateKey: Uint8Array): string {
  return ed.etc.bytesToHex(privateKey);
}

/**
 * Convert a hex string to a public key Uint8Array.
 * Validates that the hex string is exactly 64 characters (32 bytes).
 */
export function publicKeyFromHex(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("Invalid public key hex: must be exactly 64 hex characters (32 bytes)");
  }
  return ed.etc.hexToBytes(hex);
}

/**
 * Convert a hex string to a private key Uint8Array.
 * Validates that the hex string is exactly 64 characters (32 bytes).
 */
export function privateKeyFromHex(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("Invalid private key hex: must be exactly 64 hex characters (32 bytes)");
  }
  return ed.etc.hexToBytes(hex);
}

/**
 * Convert a KeyPair to hex representation.
 */
export function keypairToHex(keypair: KeyPair): KeyPairHex {
  return {
    publicKey: publicKeyToHex(keypair.publicKey),
    privateKey: privateKeyToHex(keypair.privateKey),
  };
}

/**
 * Convert a hex KeyPair back to Uint8Array representation.
 */
export function keypairFromHex(hex: KeyPairHex): KeyPair {
  return {
    publicKey: publicKeyFromHex(hex.publicKey),
    privateKey: privateKeyFromHex(hex.privateKey),
  };
}
