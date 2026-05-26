// ──────────────────────────────────────────────────────
// CORS Middleware
// ──────────────────────────────────────────────────────

import type { Context, Next } from "hono";

/**
 * CORS middleware for the ADK server.
 *
 * In production, requires explicit origin configuration via the
 * `allowedOrigins` parameter or the `ADK_CORS_ORIGINS` env var
 * (comma-separated). In development, falls back to `["*"]`.
 */
export function corsMiddleware(allowedOrigins?: string[]) {
  const origins =
    allowedOrigins ??
    process.env.ADK_CORS_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ??
    [];

  // In production with no configured origins, reject CORS requests
  const isProduction = process.env.NODE_ENV === "production";
  const effectiveOrigins = origins.length === 0 && !isProduction ? ["*"] : origins;

  return async (c: Context, next: Next) => {
    const requestOrigin = c.req.header("Origin") ?? "";

    // In production with no configured origins, block cross-origin requests
    if (effectiveOrigins.length === 0 && isProduction) {
      if (requestOrigin) {
        // Origin header present but no origins configured — reject
        if (c.req.method === "OPTIONS") {
          return c.body(null, 403);
        }
        // For non-preflight, continue without CORS headers (browser will block)
        await next();
        return;
      }
      // No Origin header — same-origin request, allow through
      await next();
      return;
    }

    const allowed = effectiveOrigins.includes("*") || effectiveOrigins.includes(requestOrigin);

    if (allowed) {
      c.header("Access-Control-Allow-Origin", effectiveOrigins.includes("*") ? "*" : requestOrigin);
    }

    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
    c.header("Access-Control-Max-Age", "86400");

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    await next();
  };
}
