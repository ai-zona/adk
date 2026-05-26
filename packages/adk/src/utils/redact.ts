// ──────────────────────────────────────────────────────
// ADK Log Redaction — Mask sensitive data in log output
// ──────────────────────────────────────────────────────

export interface RedactOptions {
  /** Additional patterns to match (merged with defaults unless `patternsOnly` is set) */
  patterns?: RegExp[];
  /** Fixed replacement string — if omitted, values are partially masked */
  replacement?: string;
}

const DEFAULT_PATTERNS: RegExp[] = [
  // API keys with common prefixes
  /\b(sk-[a-zA-Z0-9]{20,})\b/g,
  /\b(AIza[a-zA-Z0-9_-]{30,})\b/g,
  /\b(xai-[a-zA-Z0-9]{20,})\b/g,
  /\b(pcp_[a-zA-Z0-9]{20,})\b/g,
  /\b(key-[a-zA-Z0-9]{20,})\b/g,
  /\b(Bearer\s+[a-zA-Z0-9._-]{20,})\b/g,
  // Connection strings
  /\b(postgres(?:ql)?:\/\/[^\s]+)\b/g,
  /\b(redis:\/\/[^\s]+)\b/g,
  /\b(mongodb(?:\+srv)?:\/\/[^\s]+)\b/g,
  // Email addresses
  /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
  // JWT tokens
  /\b(eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/g,
];

function maskValue(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

/**
 * Redact sensitive information from a text string.
 * By default masks API keys, connection strings, emails, and JWTs.
 */
export function redact(text: string, options?: RedactOptions): string {
  const patterns = options?.patterns ?? DEFAULT_PATTERNS;
  let result = text;
  for (const pattern of patterns) {
    // Create a fresh RegExp to reset lastIndex (global flag state)
    const fresh = new RegExp(pattern.source, pattern.flags);
    result = result.replace(fresh, (match) => {
      if (options?.replacement) return options.replacement;
      return maskValue(match);
    });
  }
  return result;
}
