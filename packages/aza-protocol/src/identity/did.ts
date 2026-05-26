import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { publicKeyToHex } from "./keypair";

// ──────────────────────────────────────────────────────
// DID Format: did:aza:<network>:<32-hex-chars>
// (accepts legacy 24-hex-char DIDs for backward compat)
// ──────────────────────────────────────────────────────

export const AZA_DID_METHOD = "aza";

/**
 * Supported AZA network identifiers.
 */
export const AZANetwork = {
  MAINNET: "mainnet",
  TESTNET: "testnet",
  DEVNET: "devnet",
} as const;

export type AZANetwork = (typeof AZANetwork)[keyof typeof AZANetwork];

export const AZANetworkSchema = z.enum([AZANetwork.MAINNET, AZANetwork.TESTNET, AZANetwork.DEVNET]);

/**
 * Regex pattern for validating an AZA DID.
 * Format: did:aza:(mainnet|testnet|devnet):<24 or 32 lowercase hex chars>
 * Accepts both legacy 24-char (12-byte) and new 32-char (16-byte) identifiers.
 */
const AZA_DID_REGEX = /^did:aza:(mainnet|testnet|devnet):[0-9a-f]{24,32}$/;

/**
 * Zod schema for validating AZA DID strings.
 */
export const AZADIDSchema = z
  .string()
  .regex(AZA_DID_REGEX, "Invalid AZA DID format. Expected: did:aza:<network>:<24-or-32-hex-chars>");

export type AZADID = z.infer<typeof AZADIDSchema>;

// ──────────────────────────────────────────────────────
// Parsed DID
// ──────────────────────────────────────────────────────

export interface ParsedDID {
  /** The DID method (always "aza"). */
  method: string;
  /** The network identifier (mainnet, testnet, devnet). */
  network: AZANetwork;
  /** The hex identifier derived from the public key hash (24 or 32 chars). */
  identifier: string;
}

export const ParsedDIDSchema = z.object({
  method: z.literal("aza"),
  network: AZANetworkSchema,
  identifier: z
    .string()
    .regex(/^[0-9a-f]{24,32}$/, "Identifier must be 24 or 32 lowercase hex characters"),
});

// ──────────────────────────────────────────────────────
// DID Creation
// ──────────────────────────────────────────────────────

/**
 * Create a DID from a network identifier and an Ed25519 public key.
 *
 * The identifier is the first 16 bytes (32 hex chars) of the SHA-256 hash
 * of the public key. This provides 2^64 birthday attack resistance.
 *
 * @param network - The target network (mainnet, testnet, devnet).
 * @param publicKey - The Ed25519 public key (Uint8Array, 32 bytes).
 * @returns The full DID string, e.g., "did:aza:testnet:abcdef0123456789abcdef0123456789"
 */
export function createDID(network: AZANetwork, publicKey: Uint8Array): string {
  const hash = sha256(publicKey);
  // Take first 16 bytes (32 hex characters) of the SHA-256 hash
  const identifier = bytesToHex(hash.slice(0, 16));
  return `did:${AZA_DID_METHOD}:${network}:${identifier}`;
}

/**
 * Parse and validate a DID string.
 *
 * @param did - The DID string to parse.
 * @returns The parsed DID components.
 * @throws Error if the DID is invalid.
 */
export function parseDID(did: string): ParsedDID {
  if (!AZA_DID_REGEX.test(did)) {
    throw new Error(
      `Invalid AZA DID: "${did}". Expected format: did:aza:<network>:<24-or-32-hex-chars>`,
    );
  }

  const parts = did.split(":");
  // parts: ["did", "aza", "<network>", "<identifier>"]
  const method = parts[1]!;
  const network = parts[2]! as AZANetwork;
  const identifier = parts[3]!;

  return { method, network, identifier };
}

/**
 * Validate a DID string without throwing.
 *
 * @param did - The string to validate.
 * @returns true if the string is a valid AZA DID, false otherwise.
 */
export function validateDID(did: string): boolean {
  return AZA_DID_REGEX.test(did);
}

/**
 * Create a DID from a hex-encoded public key.
 *
 * @param network - The target network.
 * @param publicKeyHex - The public key as a hex string (64 chars).
 * @returns The full DID string.
 */
export function createDIDFromHex(network: AZANetwork, publicKeyHex: string): string {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) {
    throw new Error("Invalid public key hex: must be exactly 64 hex characters (32 bytes)");
  }
  const publicKey = hexToBytes(publicKeyHex);
  return createDID(network, publicKey);
}

// ──────────────────────────────────────────────────────
// Internal hex helpers (avoid importing ed.etc in this module)
// ──────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
