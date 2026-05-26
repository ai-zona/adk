// ──────────────────────────────────────────────────────
// ADK API Key — Generation, parsing, validation
// ──────────────────────────────────────────────────────

import { createHash, randomBytes } from "node:crypto";

const KEY_PREFIX_LIVE = "aiz_live_";
const KEY_PREFIX_TEST = "aiz_test_";
const KEY_LENGTH = 32; // 32 random bytes = 64 hex chars

/** Generate a new API key */
export function generateApiKey(type: "live" | "test" = "live"): {
  key: string;
  hash: string;
  prefix: string;
} {
  const prefix = type === "live" ? KEY_PREFIX_LIVE : KEY_PREFIX_TEST;
  const randomPart = randomBytes(KEY_LENGTH).toString("hex");
  const key = `${prefix}${randomPart}`;
  const hash = hashApiKey(key);

  return { key, hash, prefix };
}

/** Hash an API key (for storage — never store the raw key) */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Parse an API key into its parts */
export function parseApiKey(key: string): {
  type: "live" | "test";
  prefix: string;
  hash: string;
} | null {
  if (key.startsWith(KEY_PREFIX_LIVE)) {
    return { type: "live", prefix: KEY_PREFIX_LIVE, hash: hashApiKey(key) };
  }
  if (key.startsWith(KEY_PREFIX_TEST)) {
    return { type: "test", prefix: KEY_PREFIX_TEST, hash: hashApiKey(key) };
  }
  return null;
}

/** Validate API key format */
export function validateApiKeyFormat(key: string): boolean {
  if (!key.startsWith(KEY_PREFIX_LIVE) && !key.startsWith(KEY_PREFIX_TEST)) {
    return false;
  }
  const prefix = key.startsWith(KEY_PREFIX_LIVE) ? KEY_PREFIX_LIVE : KEY_PREFIX_TEST;
  const randomPart = key.slice(prefix.length);
  // Should be exactly 64 hex characters
  return /^[a-f0-9]{64}$/.test(randomPart);
}
