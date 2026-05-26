import { describe, expect, it } from "vitest";
import { OutputSanitizer } from "../safety/output-sanitizer";

describe("OutputSanitizer", () => {
  const sanitizer = new OutputSanitizer();

  // ── Clean output ─────────────────────────────────

  it("passes clean output through unchanged with empty redactions", () => {
    const result = sanitizer.sanitize({
      message: "Hello, this is a normal response.",
      count: 42,
    });

    expect(result.sanitized).toEqual({
      message: "Hello, this is a normal response.",
      count: 42,
    });
    expect(result.redactions).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.originalSize).toBeGreaterThan(0);
  });

  // ── Email redaction ──────────────────────────────

  it("redacts email addresses", () => {
    const result = sanitizer.sanitize({
      contact: "Reach me at user@example.com please.",
    });

    expect(result.sanitized).toEqual({
      contact: "Reach me at [EMAIL_REDACTED] please.",
    });
    expect(result.redactions).toContain("email");
  });

  // ── Phone number redaction ───────────────────────

  it("redacts phone numbers", () => {
    const result = sanitizer.sanitize({
      phone: "Call me at 555-123-4567.",
    });

    const sanitized = result.sanitized as Record<string, string>;
    expect(sanitized.phone).toContain("[PHONE_REDACTED]");
    expect(sanitized.phone).not.toContain("555-123-4567");
    expect(result.redactions).toContain("phone");
  });

  // ── SSN redaction ────────────────────────────────

  it("redacts SSN patterns", () => {
    const result = sanitizer.sanitize({
      ssn: "My SSN is 123-45-6789.",
    });

    const sanitized = result.sanitized as Record<string, string>;
    expect(sanitized.ssn).toContain("[SSN_REDACTED]");
    expect(sanitized.ssn).not.toContain("123-45-6789");
    expect(result.redactions).toContain("ssn");
  });

  // ── Credit card redaction ────────────────────────

  it("redacts credit card numbers", () => {
    const result = sanitizer.sanitize({
      card: "Payment card: 4111-1111-1111-1111.",
    });

    const sanitized = result.sanitized as Record<string, string>;
    expect(sanitized.card).toContain("[CARD_REDACTED]");
    expect(sanitized.card).not.toContain("4111-1111-1111-1111");
    expect(result.redactions).toContain("credit_card");
  });

  // ── API key / credential redaction ───────────────

  it("redacts API keys / credentials", () => {
    // The regex matches: (sk|pk|api|key|token|secret|password|bearer)[-_]?[a-zA-Z0-9]{20,}
    const result = sanitizer.sanitize({
      key: "Use this key: skAbcdef0123456789AbCdEfGh.",
    });

    const sanitized = result.sanitized as Record<string, string>;
    expect(sanitized.key).toContain("[CREDENTIAL_REDACTED]");
    expect(sanitized.key).not.toContain("skAbcdef0123456789AbCdEfGh");
    expect(result.redactions).toContain("api_key");
  });

  // ── Private key (PEM) redaction ──────────────────

  it("redacts PEM private keys", () => {
    const pem = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7
-----END PRIVATE KEY-----`;

    const result = sanitizer.sanitize({ secret: pem });

    const sanitized = result.sanitized as Record<string, string>;
    expect(sanitized.secret).toContain("[PRIVATE_KEY_REDACTED]");
    expect(sanitized.secret).not.toContain("BEGIN PRIVATE KEY");
    expect(result.redactions).toContain("private_key");
  });

  // ── JWT redaction ────────────────────────────────

  it("redacts JWTs", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

    const result = sanitizer.sanitize({ token: jwt });

    const sanitized = result.sanitized as Record<string, string>;
    expect(sanitized.token).toContain("[JWT_REDACTED]");
    expect(sanitized.token).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(result.redactions).toContain("jwt");
  });

  // ── Nested objects / arrays ──────────────────────

  it("redacts sensitive data in nested objects and arrays", () => {
    const result = sanitizer.sanitize({
      users: [
        { name: "Alice", email: "alice@example.com" },
        { name: "Bob", email: "bob@test.org" },
      ],
      meta: {
        admin: {
          ssn: "987-65-4321",
        },
      },
    });

    const sanitized = result.sanitized as Record<string, unknown>;
    const users = sanitized.users as Array<Record<string, string>>;
    expect(users[0]?.email).toBe("[EMAIL_REDACTED]");
    expect(users[1]?.email).toBe("[EMAIL_REDACTED]");

    const meta = sanitized.meta as Record<string, Record<string, string>>;
    expect(meta.admin?.ssn).toBe("[SSN_REDACTED]");

    expect(result.redactions).toContain("email");
    expect(result.redactions).toContain("ssn");
  });

  // ── Redactions list includes category names ──────

  it("includes the category name in the redactions list", () => {
    const result = sanitizer.sanitize({
      data: "user@example.com and 123-45-6789",
    });

    expect(result.redactions).toContain("email");
    expect(result.redactions).toContain("ssn");
  });

  // ── Non-serializable output ──────────────────────

  it("returns [UNSERIALIZABLE_OUTPUT] for non-serializable values", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    const result = sanitizer.sanitize(circular);

    expect(result.sanitized).toBe("[UNSERIALIZABLE_OUTPUT]");
    expect(result.redactions).toContain("unserializable output replaced");
    expect(result.originalSize).toBe(0);
  });

  // ── Multiple sensitive items in one string ───────

  it("redacts multiple sensitive items in a single string", () => {
    const result = sanitizer.sanitize({
      report: "Contact user@example.com or call 555-123-4567. SSN is 111-22-3333.",
    });

    const sanitized = result.sanitized as Record<string, string>;
    expect(sanitized.report).toContain("[EMAIL_REDACTED]");
    expect(sanitized.report).toContain("[SSN_REDACTED]");
    expect(sanitized.report).not.toContain("user@example.com");
    expect(sanitized.report).not.toContain("111-22-3333");
    expect(result.redactions).toContain("email");
    expect(result.redactions).toContain("ssn");
  });
});
