// ──────────────────────────────────────────────────────
// API Key Authentication Middleware
// ──────────────────────────────────────────────────────

import { hashApiKey } from "@aizonaai/adk";
import type { Context, Next } from "hono";
import type { ApiKeyRecord } from "../server";

/**
 * API key auth middleware. Validates the Authorization header
 * and sets `c.set("apiKey", record)` for downstream handlers.
 */
export function apiKeyAuth(validateFn: (keyHash: string) => Promise<ApiKeyRecord | null>) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "Missing Authorization header" }, 401);
    }

    // Support "Bearer <key>" and raw key
    const key = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();

    if (!key) {
      return c.json({ error: "Missing API key" }, 401);
    }

    const keyHash = hashApiKey(key);
    const record = await validateFn(keyHash);

    if (!record) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    if (!record.active) {
      return c.json({ error: "API key is revoked" }, 403);
    }

    if (record.expiresAt && record.expiresAt < new Date()) {
      return c.json({ error: "API key has expired" }, 403);
    }

    c.set("apiKey", record);
    await next();
  };
}
