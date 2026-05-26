// AZA Protocol SDK v2
export const AZA_PROTOCOL_VERSION = "2.0.0";

// Type definitions
export * from "./types/index";

// Identity module
export * from "./identity/index";

// Transport module (Redis Streams backbone)
export * from "./transport/index";

// Audit module (dual-write audit trail)
export * from "./audit/index";

// Task lifecycle module (state machine, manager, timeouts, artifacts)
export * from "./task/index";

// Communication patterns (fan-out, aggregation, pub/sub)
export * from "./patterns/index";

// Runtime module (agent lifecycle, sandboxing, external agents)
export * from "./runtime/index";

// Safety module (consent, rate limiting, circuit breaker, message pipeline)
export * from "./safety/index";

// Team module (N:N agent teams, context, consensus)
export * from "./team/index";
