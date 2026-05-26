import { describe, expect, it } from "vitest";
import { redact } from "../redact";

describe("redact", () => {
  describe("API key patterns", () => {
    it("masks sk- prefixed keys", () => {
      const text = "My key is sk-abc123def456ghi789jkl012mno345";
      const result = redact(text);
      expect(result).not.toContain("sk-abc123def456ghi789jkl012mno345");
      expect(result).toContain("sk-a");
      expect(result).toContain("***");
      expect(result).toContain("o345");
    });

    it("masks AIza- prefixed keys (Google)", () => {
      const text = "Using AIzaSyB1234567890abcdefghijklmnopqrstuv";
      const result = redact(text);
      expect(result).not.toContain("AIzaSyB1234567890abcdefghijklmnopqrstuv");
      expect(result).toContain("AIza");
      expect(result).toContain("***");
    });

    it("masks xai- prefixed keys", () => {
      const text = "xai-abc123def456ghi789jkl012";
      const result = redact(text);
      expect(result).not.toContain("xai-abc123def456ghi789jkl012");
      expect(result).toContain("xai-");
      expect(result).toContain("***");
    });

    it("masks pcp_ prefixed keys", () => {
      const text = "pcp_abc123def456ghi789jkl012";
      const result = redact(text);
      expect(result).not.toContain("pcp_abc123def456ghi789jkl012");
      expect(result).toContain("***");
    });

    it("masks key- prefixed keys", () => {
      const text = "key-abc123def456ghi789jkl012";
      const result = redact(text);
      expect(result).not.toContain("key-abc123def456ghi789jkl012");
      expect(result).toContain("***");
    });

    it("masks Bearer tokens", () => {
      const text = "Authorization: Bearer eyABCDEFGHIJKLMNOPQRSTUV.1234567890";
      const result = redact(text);
      expect(result).not.toContain("eyABCDEFGHIJKLMNOPQRSTUV.1234567890");
      expect(result).toContain("***");
    });
  });

  describe("email addresses", () => {
    it("masks email addresses", () => {
      const text = "Contact admin@example.com for help";
      const result = redact(text);
      expect(result).not.toContain("admin@example.com");
      expect(result).toContain("***");
      expect(result).toContain("Contact");
      expect(result).toContain("for help");
    });

    it("masks emails with complex local parts", () => {
      const text = "user.name+tag@long-domain.co.uk";
      const result = redact(text);
      expect(result).not.toContain("user.name+tag@long-domain.co.uk");
      expect(result).toContain("***");
    });
  });

  describe("JWT tokens", () => {
    it("masks JWT tokens", () => {
      const token =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const text = `Token: ${token}`;
      const result = redact(text);
      expect(result).not.toContain(token);
      expect(result).toContain("***");
    });
  });

  describe("connection strings", () => {
    it("masks PostgreSQL connection strings", () => {
      const text = "DATABASE_URL=postgresql://user:pass@host:5432/db";
      const result = redact(text);
      expect(result).not.toContain("postgresql://user:pass@host:5432/db");
      expect(result).toContain("***");
    });

    it("masks postgres:// variant", () => {
      const text = "postgres://admin:secret@localhost/mydb";
      const result = redact(text);
      expect(result).not.toContain("postgres://admin:secret@localhost/mydb");
    });

    it("masks Redis connection strings", () => {
      const text = "REDIS_URL=redis://default:pass@redis.example.com:6379";
      const result = redact(text);
      expect(result).not.toContain("redis://default:pass@redis.example.com:6379");
      expect(result).toContain("***");
    });

    it("masks MongoDB connection strings", () => {
      const text = "mongodb+srv://user:pass@cluster0.abc.mongodb.net/db";
      const result = redact(text);
      expect(result).not.toContain("mongodb+srv://user:pass@cluster0.abc.mongodb.net/db");
      expect(result).toContain("***");
    });
  });

  describe("short values", () => {
    it("fully masks short matched values", () => {
      // Using a custom short pattern to force a short match
      const result = redact("key: AB", {
        patterns: [/\bAB\b/g],
      });
      expect(result).toBe("key: ***");
    });
  });

  describe("passthrough", () => {
    it("passes through text without sensitive data", () => {
      const text = "This is a normal log line with no secrets.";
      expect(redact(text)).toBe(text);
    });

    it("passes through empty strings", () => {
      expect(redact("")).toBe("");
    });
  });

  describe("custom options", () => {
    it("uses custom patterns", () => {
      const result = redact("My SSN is 123-45-6789", {
        patterns: [/\b(\d{3}-\d{2}-\d{4})\b/g],
      });
      expect(result).not.toContain("123-45-6789");
      expect(result).toContain("***");
    });

    it("uses fixed replacement string", () => {
      const text = "key is sk-abc123def456ghi789jkl012mno345";
      const result = redact(text, { replacement: "[REDACTED]" });
      expect(result).toBe("key is [REDACTED]");
    });

    it("custom patterns replace all defaults", () => {
      // Custom patterns means only those patterns, not defaults
      const text = "admin@example.com sk-abc123def456ghi789jkl012mno345";
      const result = redact(text, {
        patterns: [/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g],
      });
      // Email should be masked
      expect(result).not.toContain("admin@example.com");
      // API key should NOT be masked (not in custom patterns)
      expect(result).toContain("sk-abc123def456ghi789jkl012mno345");
    });
  });

  describe("multiple sensitive values", () => {
    it("masks multiple values in the same string", () => {
      const text =
        "key=sk-abc123def456ghi789jkl012mno345 db=postgres://user:p@host/db email=a@b.com";
      const result = redact(text);
      expect(result).not.toContain("sk-abc123def456ghi789jkl012mno345");
      expect(result).not.toContain("postgres://user:p@host/db");
      expect(result).not.toContain("a@b.com");
    });
  });
});
