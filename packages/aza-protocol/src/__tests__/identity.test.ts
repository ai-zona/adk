import { describe, expect, it } from "vitest";
import { AZANetwork, createDID, createDIDFromHex, parseDID, validateDID } from "../identity/did";
import {
  generateKeypair,
  generateKeypairSync,
  keypairFromHex,
  keypairToHex,
  publicKeyFromHex,
  publicKeyFromPrivateKey,
  publicKeyToHex,
} from "../identity/keypair";
import {
  isValidSignature,
  isValidSignatureSync,
  signMessage,
  signMessageSync,
  verifySignature,
  verifySignatureSync,
} from "../identity/signing";

// ──────────────────────────────────────────────────────
// Keypair Generation & Hex Conversion
// ──────────────────────────────────────────────────────

describe("keypair", () => {
  describe("generateKeypair (async)", () => {
    it("should produce a keypair with 32-byte public and private keys", async () => {
      const kp = await generateKeypair();
      expect(kp.publicKey).toBeInstanceOf(Uint8Array);
      expect(kp.privateKey).toBeInstanceOf(Uint8Array);
      expect(kp.publicKey.length).toBe(32);
      expect(kp.privateKey.length).toBe(32);
    });

    it("should generate unique keypairs on each call", async () => {
      const kp1 = await generateKeypair();
      const kp2 = await generateKeypair();
      expect(publicKeyToHex(kp1.publicKey)).not.toBe(publicKeyToHex(kp2.publicKey));
    });
  });

  describe("generateKeypairSync", () => {
    it("should produce a keypair with 32-byte public and private keys", () => {
      const kp = generateKeypairSync();
      expect(kp.publicKey).toBeInstanceOf(Uint8Array);
      expect(kp.privateKey).toBeInstanceOf(Uint8Array);
      expect(kp.publicKey.length).toBe(32);
      expect(kp.privateKey.length).toBe(32);
    });
  });

  describe("publicKeyFromPrivateKey", () => {
    it("should derive the same public key as the one in the generated keypair", async () => {
      const kp = await generateKeypair();
      const derivedPub = await publicKeyFromPrivateKey(kp.privateKey);
      expect(publicKeyToHex(derivedPub)).toBe(publicKeyToHex(kp.publicKey));
    });
  });

  describe("publicKeyToHex / publicKeyFromHex roundtrip", () => {
    it("should roundtrip a public key through hex encoding", async () => {
      const kp = await generateKeypair();
      const hex = publicKeyToHex(kp.publicKey);
      expect(hex).toMatch(/^[0-9a-f]{64}$/);
      const restored = publicKeyFromHex(hex);
      expect(publicKeyToHex(restored)).toBe(hex);
    });

    it("should throw on invalid hex (wrong length)", () => {
      expect(() => publicKeyFromHex("abcdef")).toThrow("Invalid public key hex");
    });

    it("should throw on invalid hex (non-hex characters)", () => {
      expect(() =>
        publicKeyFromHex("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"),
      ).toThrow("Invalid public key hex");
    });
  });

  describe("keypairToHex / keypairFromHex roundtrip", () => {
    it("should roundtrip a full keypair through hex encoding", async () => {
      const kp = await generateKeypair();
      const hexKp = keypairToHex(kp);
      expect(hexKp.publicKey).toMatch(/^[0-9a-f]{64}$/);
      expect(hexKp.privateKey).toMatch(/^[0-9a-f]{64}$/);

      const restored = keypairFromHex(hexKp);
      expect(publicKeyToHex(restored.publicKey)).toBe(hexKp.publicKey);
      expect(restored.privateKey.length).toBe(32);
    });
  });
});

// ──────────────────────────────────────────────────────
// DID Creation & Parsing
// ──────────────────────────────────────────────────────

describe("DID", () => {
  describe("createDID", () => {
    it("should produce a DID in the format did:aza:<network>:<32-hex-chars>", async () => {
      const kp = await generateKeypair();
      const did = createDID(AZANetwork.TESTNET, kp.publicKey);
      expect(did).toMatch(/^did:aza:testnet:[0-9a-f]{32}$/);
    });

    it("should produce deterministic DIDs for the same public key", async () => {
      const kp = await generateKeypair();
      const did1 = createDID(AZANetwork.MAINNET, kp.publicKey);
      const did2 = createDID(AZANetwork.MAINNET, kp.publicKey);
      expect(did1).toBe(did2);
    });

    it("should produce different DIDs for different networks with the same key", async () => {
      const kp = await generateKeypair();
      const mainDid = createDID(AZANetwork.MAINNET, kp.publicKey);
      const testDid = createDID(AZANetwork.TESTNET, kp.publicKey);
      // The identifier portion is the same (derived from key hash), but the network segment differs
      expect(mainDid).not.toBe(testDid);
      expect(mainDid).toContain("mainnet");
      expect(testDid).toContain("testnet");
    });
  });

  describe("parseDID", () => {
    it("should correctly parse a valid DID into method, network, and identifier", async () => {
      const kp = await generateKeypair();
      const did = createDID(AZANetwork.DEVNET, kp.publicKey);
      const parsed = parseDID(did);

      expect(parsed.method).toBe("aza");
      expect(parsed.network).toBe("devnet");
      expect(parsed.identifier).toMatch(/^[0-9a-f]{32}$/);
    });

    it("should throw on invalid DID format (wrong prefix)", () => {
      expect(() => parseDID("did:other:mainnet:abcdef0123456789abcdef01")).toThrow(
        "Invalid AZA DID",
      );
    });

    it("should throw on invalid DID format (too short identifier)", () => {
      expect(() => parseDID("did:aza:mainnet:abcdef")).toThrow("Invalid AZA DID");
    });

    it("should throw on invalid DID format (random string)", () => {
      expect(() => parseDID("not-a-did")).toThrow("Invalid AZA DID");
    });

    it("should throw on invalid DID format (bad network)", () => {
      expect(() => parseDID("did:aza:localnet:abcdef0123456789abcdef01")).toThrow(
        "Invalid AZA DID",
      );
    });
  });

  describe("validateDID", () => {
    it("should return true for a valid DID", async () => {
      const kp = await generateKeypair();
      const did = createDID(AZANetwork.MAINNET, kp.publicKey);
      expect(validateDID(did)).toBe(true);
    });

    it("should return false for an invalid DID", () => {
      expect(validateDID("not-a-did")).toBe(false);
      expect(validateDID("did:aza:mainnet:short")).toBe(false);
      expect(validateDID("did:other:mainnet:abcdef0123456789abcdef01")).toBe(false);
    });
  });

  describe("createDIDFromHex", () => {
    it("should produce the same DID as createDID with equivalent key bytes", async () => {
      const kp = await generateKeypair();
      const hex = publicKeyToHex(kp.publicKey);
      const didFromBytes = createDID(AZANetwork.TESTNET, kp.publicKey);
      const didFromHex = createDIDFromHex(AZANetwork.TESTNET, hex);
      expect(didFromHex).toBe(didFromBytes);
    });

    it("should throw on invalid hex string", () => {
      expect(() => createDIDFromHex(AZANetwork.TESTNET, "invalid")).toThrow(
        "Invalid public key hex",
      );
    });
  });
});

// ──────────────────────────────────────────────────────
// Message Signing & Verification
// ──────────────────────────────────────────────────────

describe("signing", () => {
  const testPayload = { action: "test", value: 42 };

  describe("signMessage (async)", () => {
    it("should produce a JWS-like string with 3 dot-separated parts", async () => {
      const kp = await generateKeypair();
      const jws = await signMessage(testPayload, kp.privateKey);
      const parts = jws.split(".");
      expect(parts.length).toBe(3);
      // Each part should be a non-empty base64url string
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0);
      }
    });

    it("should produce deterministic output for the same payload and key", async () => {
      const kp = await generateKeypair();
      const jws1 = await signMessage(testPayload, kp.privateKey);
      const jws2 = await signMessage(testPayload, kp.privateKey);
      expect(jws1).toBe(jws2);
    });
  });

  describe("signMessageSync", () => {
    it("should produce a JWS-like string with 3 dot-separated parts", () => {
      const kp = generateKeypairSync();
      const jws = signMessageSync(testPayload, kp.privateKey);
      const parts = jws.split(".");
      expect(parts.length).toBe(3);
    });

    it("should produce the same output as the async variant", async () => {
      const kp = await generateKeypair();
      const jwsAsync = await signMessage(testPayload, kp.privateKey);
      const jwsSync = signMessageSync(testPayload, kp.privateKey);
      expect(jwsAsync).toBe(jwsSync);
    });
  });

  describe("verifySignature (async)", () => {
    it("should return the original payload on successful verification", async () => {
      const kp = await generateKeypair();
      const jws = await signMessage(testPayload, kp.privateKey);
      const result = await verifySignature(jws, kp.publicKey);
      expect(result).toEqual(testPayload);
    });

    it("should throw with a wrong public key", async () => {
      const kp1 = await generateKeypair();
      const kp2 = await generateKeypair();
      const jws = await signMessage(testPayload, kp1.privateKey);
      await expect(verifySignature(jws, kp2.publicKey)).rejects.toThrow(
        "Signature verification failed",
      );
    });
  });

  describe("verifySignatureSync", () => {
    it("should return the original payload on successful verification", () => {
      const kp = generateKeypairSync();
      const jws = signMessageSync(testPayload, kp.privateKey);
      const result = verifySignatureSync(jws, kp.publicKey);
      expect(result).toEqual(testPayload);
    });

    it("should throw with a wrong public key", () => {
      const kp1 = generateKeypairSync();
      const kp2 = generateKeypairSync();
      const jws = signMessageSync(testPayload, kp1.privateKey);
      expect(() => verifySignatureSync(jws, kp2.publicKey)).toThrow(
        "Signature verification failed",
      );
    });
  });

  describe("isValidSignature (async)", () => {
    it("should return true for a valid signature", async () => {
      const kp = await generateKeypair();
      const jws = await signMessage(testPayload, kp.privateKey);
      expect(await isValidSignature(jws, kp.publicKey)).toBe(true);
    });

    it("should return false for an invalid signature (wrong key)", async () => {
      const kp1 = await generateKeypair();
      const kp2 = await generateKeypair();
      const jws = await signMessage(testPayload, kp1.privateKey);
      expect(await isValidSignature(jws, kp2.publicKey)).toBe(false);
    });

    it("should return false for malformed JWS", async () => {
      const kp = await generateKeypair();
      expect(await isValidSignature("not.a.valid-jws", kp.publicKey)).toBe(false);
    });
  });

  describe("isValidSignatureSync", () => {
    it("should return true for a valid signature", () => {
      const kp = generateKeypairSync();
      const jws = signMessageSync(testPayload, kp.privateKey);
      expect(isValidSignatureSync(jws, kp.publicKey)).toBe(true);
    });

    it("should return false for an invalid signature (wrong key)", () => {
      const kp1 = generateKeypairSync();
      const kp2 = generateKeypairSync();
      const jws = signMessageSync(testPayload, kp1.privateKey);
      expect(isValidSignatureSync(jws, kp2.publicKey)).toBe(false);
    });
  });

  describe("payload types", () => {
    it("should handle string payloads", async () => {
      const kp = await generateKeypair();
      const jws = await signMessage("hello world", kp.privateKey);
      const result = await verifySignature(jws, kp.publicKey);
      expect(result).toBe("hello world");
    });

    it("should handle nested object payloads", async () => {
      const kp = await generateKeypair();
      const nested = { a: { b: { c: [1, 2, 3] } } };
      const jws = await signMessage(nested, kp.privateKey);
      const result = await verifySignature(jws, kp.publicKey);
      expect(result).toEqual(nested);
    });

    it("should handle numeric payloads", async () => {
      const kp = await generateKeypair();
      const jws = await signMessage(12345, kp.privateKey);
      const result = await verifySignature(jws, kp.publicKey);
      expect(result).toBe(12345);
    });
  });
});
