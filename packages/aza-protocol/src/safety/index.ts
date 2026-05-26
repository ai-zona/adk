// ──────────────────────────────────────────────────────
// AZA Protocol Safety Module
// ──────────────────────────────────────────────────────
// Consent framework, rate limiting, circuit breaker,
// and the unified message pipeline.
// ──────────────────────────────────────────────────────

// Consent framework
export { ConsentTier, ConsentManager } from "./consent-manager";
export type { ConsentRequest, ConsentDecision } from "./consent-manager";

// Rate limiting
export { AZARateLimiter } from "./rate-limiter";
export type { AZARateLimitConfig, RateLimitResult } from "./rate-limiter";

// Circuit breaker
export { AZACircuitBreaker } from "./circuit-breaker";
export type { CircuitState, AZACircuitBreakerConfig } from "./circuit-breaker";

// Message pipeline
export { MessagePipeline } from "./message-pipeline";
