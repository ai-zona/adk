// ──────────────────────────────────────────────────────
// ADK Error Classification & Fingerprinting
// ──────────────────────────────────────────────────────
// Buckets errors so callers can decide retry / report / alert.
// Fingerprint = short stable hash of (category + providerId + message-shape).
// ──────────────────────────────────────────────────────

import { ADKProviderError } from "../providers/errors";

/**
 * - transient: should be retried (network blip, rate limit, 5xx)
 * - permanent: a real bug or bad data; report to error tracking
 * - configuration: operator must fix (missing API key, invalid model)
 */
export type ErrorCategory = "transient" | "permanent" | "configuration";

export interface ClassifiedError {
  category: ErrorCategory;
  fingerprint: string;
  /** Provider id when known, otherwise "unknown". */
  providerId: string;
  /** Provider error code if available. */
  code?: string;
  retryable: boolean;
  message: string;
  /** Underlying Error name (e.g. "TypeError", "ADKProviderError"). */
  errorName: string;
}

/** Stable, non-cryptographic 32-bit hash (FNV-1a). */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Strip numbers, hex IDs, UUIDs, and quoted literals so the same bug fingerprints identically. */
function shapeMessage(message: string): string {
  return message
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "<uuid>")
    .replace(/\b0x[0-9a-fA-F]+\b/g, "<hex>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/"[^"]*"/g, '"<str>"')
    .replace(/'[^']*'/g, "'<str>'")
    .trim()
    .toLowerCase();
}

/** Classify any thrown value into a category + stable fingerprint. */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof ADKProviderError) {
    const category = providerCodeToCategory(err.code);
    const shape = shapeMessage(err.message);
    return {
      category,
      providerId: err.providerId,
      code: err.code,
      retryable: err.retryable,
      message: err.message,
      errorName: err.name,
      fingerprint: fnv1a(`${err.code}|${err.providerId}|${shape}`),
    };
  }

  if (err instanceof Error) {
    const shape = shapeMessage(err.message);
    const category = nameToCategory(err.name, err.message);
    return {
      category,
      providerId: "unknown",
      retryable: category === "transient",
      message: err.message,
      errorName: err.name,
      fingerprint: fnv1a(`${err.name}|unknown|${shape}`),
    };
  }

  const message = String(err);
  const shape = shapeMessage(message);
  return {
    category: "permanent",
    providerId: "unknown",
    retryable: false,
    message,
    errorName: "UnknownError",
    fingerprint: fnv1a(`UnknownError|unknown|${shape}`),
  };
}

function providerCodeToCategory(code: string): ErrorCategory {
  switch (code) {
    case "RATE_LIMITED":
    case "SERVICE_UNAVAILABLE":
    case "TIMEOUT":
    case "NETWORK_ERROR":
      return "transient";
    case "INVALID_API_KEY":
    case "MODEL_NOT_FOUND":
    case "INSUFFICIENT_QUOTA":
      return "configuration";
    default:
      return "permanent";
  }
}

function nameToCategory(name: string, message: string): ErrorCategory {
  if (name === "AbortError") return "transient";
  // Generic patterns we've all seen often enough to bucket
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(message)) return "transient";
  if (/missing.*api[_ ]?key|not configured|invalid configuration/i.test(message))
    return "configuration";
  return "permanent";
}
