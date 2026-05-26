import { describe, expect, it } from "vitest";
import { generateKeypairSync } from "../identity/keypair";
import { signMessageSync, verifySignatureSync } from "../identity/signing";

// ──────────────────────────────────────────────────────
// JWS Signature Integrity Suite (Rank 19)
// ──────────────────────────────────────────────────────
// These tests verify the cryptographic integrity guarantees of the
// signMessage / verifySignature pair against the AZA protocol's
// stated security properties.

// Deterministic test keypair (generated inside the test run;
// NOT a real secret and NEVER persisted).
const testKp = generateKeypairSync();

describe("signing integrity", () => {
  // ── Test 1: JWS round-trip ──────────────────────────

  it("round-trips an arbitrary JSON payload through sign + verify", () => {
    const payload = {
      kind: "task.request",
      taskId: "task-001",
      from: "did:aza:testnet:alice",
      to: "did:aza:testnet:bob",
      nonce: 42,
      resources: ["mcp:read", "mcp:call"],
    };

    const jws = signMessageSync(payload, testKp.privateKey);

    // Format check: 3 dot-separated base64url segments
    expect(jws.split(".").length).toBe(3);

    const verified = verifySignatureSync(jws, testKp.publicKey);
    expect(verified).toEqual(payload);
  });

  // ── Test 2: tampered-payload detection ──────────────

  it("rejects a JWS whose payload segment has been tampered with", () => {
    const original = { amount: 10, to: "did:aza:testnet:carol" };
    const jws = signMessageSync(original, testKp.privateKey);

    // Swap the payload segment for a different (same-structure) payload's base64url
    const malicious = signMessageSync(
      { amount: 10_000, to: "did:aza:testnet:mallory" },
      testKp.privateKey,
    );
    const [header, , sig] = jws.split(".");
    const [, maliciousPayload] = malicious.split(".");
    const tampered = `${header}.${maliciousPayload}.${sig}`;

    // Verification must fail — the signature does not cover the new payload
    expect(() => verifySignatureSync(tampered, testKp.publicKey)).toThrow(
      "Signature verification failed",
    );
  });

  // ── Test 3: wrong-key verification fail ─────────────

  it("rejects a valid signature when verified with a different public key", () => {
    const otherKp = generateKeypairSync();
    const payload = { op: "transfer", amount: 1 };

    const jws = signMessageSync(payload, testKp.privateKey);

    expect(() => verifySignatureSync(jws, otherKp.publicKey)).toThrow(
      "Signature verification failed",
    );
  });

  // ── Test 4: canonical JSON ordering stability ────────

  it("produces identical JWS for object payloads regardless of key order", () => {
    // Canonical JSON (RFC 8785) sorts keys lexicographically, so two payloads
    // with the same keys but different declared orders MUST produce identical
    // signed output.
    const a = { alpha: 1, beta: 2, gamma: 3 };
    const b = { gamma: 3, alpha: 1, beta: 2 };
    const c = { beta: 2, gamma: 3, alpha: 1 };

    const jwsA = signMessageSync(a, testKp.privateKey);
    const jwsB = signMessageSync(b, testKp.privateKey);
    const jwsC = signMessageSync(c, testKp.privateKey);

    expect(jwsA).toBe(jwsB);
    expect(jwsA).toBe(jwsC);

    // And all three verify against the same public key
    expect(verifySignatureSync(jwsA, testKp.publicKey)).toEqual(a);

    // Nested objects: insertion order inside nested values also must not matter
    const nested1 = { outer: { k1: "x", k2: "y" }, top: 1 };
    const nested2 = { top: 1, outer: { k2: "y", k1: "x" } };
    expect(signMessageSync(nested1, testKp.privateKey)).toBe(
      signMessageSync(nested2, testKp.privateKey),
    );
  });
});
