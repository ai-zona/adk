// ──────────────────────────────────────────────────────
// ADK Memory Module — Vector memory system
// ──────────────────────────────────────────────────────

// Types
export type {
  MemoryType,
  MemoryEntry,
  MemorySearchResult,
  MemoryBackend,
  EmbeddingConfig,
  EmbedApiResponse,
} from "./types";

// Embedding service
export { EmbeddingService } from "./embedding";

// Memory manager
export { MemoryManager } from "./memory-manager";
export type { MemoryManagerConfig } from "./memory-manager";

// PgVector backend
export { PgVectorMemoryBackend } from "./pgvector-backend";
export type { PgVectorDatabaseClient } from "./pgvector-backend";

// Shared memory (cross-agent)
export type {
  SharedMemoryScope,
  SharedMemoryNamespace,
  SharedMemoryEntry,
  SharedMemoryStore,
} from "./shared-memory";
export { InMemorySharedStore } from "./in-memory-shared-store";

// Decay policy
export { MemoryDecayManager } from "./decay-policy";
export type { DecayPolicy } from "./decay-policy";
