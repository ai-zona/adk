// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

export interface SanitizationResult {
  /** The sanitized (redacted / truncated) output. */
  sanitized: unknown;
  /** Human-readable list of what was redacted. */
  redactions: string[];
  /** Whether the output was truncated due to size limits. */
  truncated: boolean;
  /** Size (in characters) of the JSON-serialized original output. */
  originalSize: number;
  /** Wall-clock duration of this single sanitize() invocation in ms. */
  latencyMs: number;
}

// ──────────────────────────────────────────────────────
// Sensitive-data patterns
// ──────────────────────────────────────────────────────

interface SensitivePattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

// ──────────────────────────────────────────────────────
// OutputSanitizer
// ──────────────────────────────────────────────────────

/**
 * Sanitizes MCP tool output before it is logged or returned to callers.
 *
 * Responsibilities:
 * - Detect and redact PII (emails, phones, SSNs, credit-card numbers)
 * - Detect and redact credentials (API keys, private keys, JWTs)
 * - Enforce maximum output size (truncate when exceeded)
 * - Report what was redacted and whether truncation occurred
 */
export class OutputSanitizer {
  /** Maximum serialized output size in characters. */
  private static readonly MAX_OUTPUT_SIZE = 5 * 1024 * 1024; // 5 MB

  /**
   * Patterns for PII and credential detection.
   *
   * Each pattern's `RegExp` **must** use the `g` flag so that all
   * occurrences are replaced.  Because we re-use these across calls we
   * create fresh copies at call time (see {@link getFreshPatterns}).
   */
  private static readonly SENSITIVE_PATTERNS: SensitivePattern[] = [
    {
      name: "email",
      pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      replacement: "[EMAIL_REDACTED]",
    },
    {
      name: "phone",
      pattern: /\b(\+?1?\s*[-.]?\s*)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g,
      replacement: "[PHONE_REDACTED]",
    },
    {
      name: "ssn",
      pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
      replacement: "[SSN_REDACTED]",
    },
    {
      name: "credit_card",
      pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
      replacement: "[CARD_REDACTED]",
    },
    {
      name: "api_key",
      pattern: /\b(sk|pk|api|key|token|secret|password|bearer)[-_]?[a-zA-Z0-9]{20,}\b/gi,
      replacement: "[CREDENTIAL_REDACTED]",
    },
    {
      name: "private_key",
      pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\sKEY-----[\s\S]*?-----END/gi,
      replacement: "[PRIVATE_KEY_REDACTED]",
    },
    {
      name: "jwt",
      pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
      replacement: "[JWT_REDACTED]",
    },
  ];

  // ── Public API ────────────────────────────────────

  /**
   * Sanitizes arbitrary MCP tool output.
   *
   * @param output - The raw output value (can be any JSON-compatible type)
   * @returns A {@link SanitizationResult} containing the sanitized output,
   *          a list of redactions applied, and truncation metadata.
   */
  sanitize(output: unknown): SanitizationResult {
    const startNs = performance.now();

    // 1. Measure original size
    let serialized: string;
    try {
      serialized = JSON.stringify(output);
    } catch {
      // Non-serializable output is replaced wholesale
      return {
        sanitized: "[UNSERIALIZABLE_OUTPUT]",
        redactions: ["unserializable output replaced"],
        truncated: false,
        originalSize: 0,
        latencyMs: performance.now() - startNs,
      };
    }

    const originalSize = serialized.length;

    // 2. Deep clone and recursively sanitize string values
    const redactions: string[] = [];
    const sanitized = this.sanitizeValue(output, redactions);

    // 3. Enforce max output size (truncate if needed)
    let truncated = false;
    let finalOutput = sanitized;

    const sanitizedSerialized = JSON.stringify(sanitized);
    if (
      sanitizedSerialized !== undefined &&
      sanitizedSerialized.length > OutputSanitizer.MAX_OUTPUT_SIZE
    ) {
      truncated = true;
      // Truncate at the serialized level and wrap as a string
      finalOutput = `${sanitizedSerialized.slice(0, OutputSanitizer.MAX_OUTPUT_SIZE)}...[TRUNCATED]`;
    }

    return {
      sanitized: finalOutput,
      redactions,
      truncated,
      originalSize,
      latencyMs: performance.now() - startNs,
    };
  }

  // ── Private helpers ───────────────────────────────

  /**
   * Recursively walks a value, sanitizing every string leaf.
   */
  private sanitizeValue(value: unknown, redactions: string[]): unknown {
    if (typeof value === "string") {
      return this.sanitizeString(value, redactions);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item, redactions));
    }

    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.sanitizeValue(val, redactions);
      }
      return result;
    }

    // Numbers, booleans, null - pass through unchanged
    return value;
  }

  /**
   * Applies all sensitive-data patterns to a single string and records
   * which categories were redacted.
   */
  private sanitizeString(value: string, redactions: string[]): string {
    let result = value;

    for (const { name, pattern, replacement } of OutputSanitizer.getFreshPatterns()) {
      const before = result;
      result = result.replace(pattern, replacement);
      if (result !== before) {
        redactions.push(name);
      }
    }

    return result;
  }

  /**
   * Returns a fresh copy of the sensitive-data patterns with reset
   * lastIndex values. This is necessary because RegExp objects with
   * the `g` flag are stateful.
   */
  private static getFreshPatterns(): SensitivePattern[] {
    return OutputSanitizer.SENSITIVE_PATTERNS.map((p) => ({
      ...p,
      pattern: new RegExp(p.pattern.source, p.pattern.flags),
    }));
  }
}
