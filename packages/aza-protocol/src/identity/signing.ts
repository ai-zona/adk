import * as ed from "@noble/ed25519";
import canonicalize from "canonicalize";
import { initSyncHash } from "./keypair";

// ──────────────────────────────────────────────────────
// Ensure sha512 sync hash is configured for @noble/ed25519
// ──────────────────────────────────────────────────────
initSyncHash();

// ──────────────────────────────────────────────────────
// JWS-like Signature Format
// ──────────────────────────────────────────────────────
// Format: base64url(header).base64url(payload).base64url(signature)
//
// Header: { "alg": "EdDSA", "typ": "AZA" }
// Payload: Canonical JSON of the message payload
// Signature: Ed25519 signature over `header.payload`
// ──────────────────────────────────────────────────────

const JWS_HEADER = { alg: "EdDSA", typ: "AZA" };
const ENCODED_HEADER = base64UrlEncode(JSON.stringify(JWS_HEADER));

/**
 * Sign a message payload with an Ed25519 private key.
 *
 * The payload is first canonicalized using RFC 8785 (JCS) to ensure
 * deterministic serialization, then signed using EdDSA.
 *
 * @param payload - The message payload to sign (any JSON-serializable value).
 * @param privateKey - The Ed25519 private key (32 bytes).
 * @returns A JWS-like compact serialization: header.payload.signature
 */
export async function signMessage(payload: unknown, privateKey: Uint8Array): Promise<string> {
  const canonicalPayload = canonicalize(payload);
  if (canonicalPayload === undefined) {
    throw new Error("Failed to canonicalize payload: value is not JSON-serializable");
  }

  const encodedPayload = base64UrlEncode(canonicalPayload);
  const signingInput = `${ENCODED_HEADER}.${encodedPayload}`;

  const messageBytes = new TextEncoder().encode(signingInput);
  const signature = await ed.signAsync(messageBytes, privateKey);
  const encodedSignature = base64UrlEncodeBytes(signature);

  return `${ENCODED_HEADER}.${encodedPayload}.${encodedSignature}`;
}

/**
 * Synchronous variant of signMessage.
 */
export function signMessageSync(payload: unknown, privateKey: Uint8Array): string {
  const canonicalPayload = canonicalize(payload);
  if (canonicalPayload === undefined) {
    throw new Error("Failed to canonicalize payload: value is not JSON-serializable");
  }

  const encodedPayload = base64UrlEncode(canonicalPayload);
  const signingInput = `${ENCODED_HEADER}.${encodedPayload}`;

  const messageBytes = new TextEncoder().encode(signingInput);
  const signature = ed.sign(messageBytes, privateKey);
  const encodedSignature = base64UrlEncodeBytes(signature);

  return `${ENCODED_HEADER}.${encodedPayload}.${encodedSignature}`;
}

/**
 * Verify a JWS-like signature and return the decoded payload.
 *
 * @param jws - The JWS compact serialization to verify.
 * @param publicKey - The Ed25519 public key (32 bytes).
 * @returns The decoded and verified payload as a parsed JSON value.
 * @throws Error if the signature is invalid, the JWS format is malformed,
 *         or the header algorithm is not EdDSA.
 */
export async function verifySignature(jws: string, publicKey: Uint8Array): Promise<unknown> {
  const { signingInput, signature, payload } = parseJWS(jws);

  const messageBytes = new TextEncoder().encode(signingInput);
  const isValid = await ed.verifyAsync(signature, messageBytes, publicKey);

  if (!isValid) {
    throw new Error("Signature verification failed: invalid signature");
  }

  return payload;
}

/**
 * Synchronous variant of verifySignature.
 */
export function verifySignatureSync(jws: string, publicKey: Uint8Array): unknown {
  const { signingInput, signature, payload } = parseJWS(jws);

  const messageBytes = new TextEncoder().encode(signingInput);
  const isValid = ed.verify(signature, messageBytes, publicKey);

  if (!isValid) {
    throw new Error("Signature verification failed: invalid signature");
  }

  return payload;
}

/**
 * Verify a JWS-like signature without decoding the payload.
 * Returns true if valid, false otherwise (does not throw).
 */
export async function isValidSignature(jws: string, publicKey: Uint8Array): Promise<boolean> {
  try {
    const { signingInput, signature } = parseJWS(jws);
    const messageBytes = new TextEncoder().encode(signingInput);
    return await ed.verifyAsync(signature, messageBytes, publicKey);
  } catch {
    return false;
  }
}

/**
 * Synchronous variant of isValidSignature.
 */
export function isValidSignatureSync(jws: string, publicKey: Uint8Array): boolean {
  try {
    const { signingInput, signature } = parseJWS(jws);
    const messageBytes = new TextEncoder().encode(signingInput);
    return ed.verify(signature, messageBytes, publicKey);
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────
// Internal Helpers
// ──────────────────────────────────────────────────────

interface ParsedJWS {
  signingInput: string;
  signature: Uint8Array;
  payload: unknown;
}

function parseJWS(jws: string): ParsedJWS {
  const parts = jws.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWS format: expected 3 dot-separated parts");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  // Verify header
  const headerJson = base64UrlDecode(encodedHeader);
  let header: unknown;
  try {
    header = JSON.parse(headerJson);
  } catch {
    throw new Error("Invalid JWS header: not valid JSON");
  }

  if (
    typeof header !== "object" ||
    header === null ||
    !("alg" in header) ||
    (header as Record<string, unknown>).alg !== "EdDSA"
  ) {
    throw new Error("Invalid JWS header: expected EdDSA algorithm");
  }

  // Decode payload
  const payloadJson = base64UrlDecode(encodedPayload);
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    throw new Error("Invalid JWS payload: not valid JSON");
  }

  // Decode signature
  const signature = base64UrlDecodeBytes(encodedSignature);

  const signingInput = `${encodedHeader}.${encodedPayload}`;

  return { signingInput, signature, payload };
}

// ──────────────────────────────────────────────────────
// Base64URL Encoding/Decoding
// ──────────────────────────────────────────────────────

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return base64UrlEncodeBytes(bytes);
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  // Convert to regular base64 first, then to base64url
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(encoded: string): string {
  const bytes = base64UrlDecodeBytes(encoded);
  return new TextDecoder().decode(bytes);
}

function base64UrlDecodeBytes(encoded: string): Uint8Array {
  // Restore base64 padding and characters
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad === 2) base64 += "==";
  else if (pad === 3) base64 += "=";

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
