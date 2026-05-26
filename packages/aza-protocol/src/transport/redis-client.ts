import Redis from "ioredis";

// ──────────────────────────────────────────────────────
// Redis Client Factory
// ──────────────────────────────────────────────────────
// Provides a singleton Redis instance for shared use
// and a factory for creating dedicated connections
// (e.g., for XREADGROUP blocking consumers).
// ──────────────────────────────────────────────────────

let redisInstance: Redis | null = null;

/**
 * Returns the shared singleton Redis instance.
 * Creates it lazily on first call using REDIS_URL env var
 * (defaults to redis://localhost:6379).
 *
 * Uses lazyConnect so the connection is not established until
 * the first command is issued.
 */
export function getRedisClient(): Redis {
  if (!redisInstance) {
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    redisInstance = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 200, 5000);
      },
      lazyConnect: true,
    });
  }
  return redisInstance;
}

/**
 * Creates a new, independent Redis connection.
 * Use this when you need a dedicated connection that won't
 * interfere with the singleton (e.g., for blocking XREADGROUP).
 */
export function createRedisClient(url?: string): Redis {
  return new Redis(url || process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(times * 200, 5000);
    },
  });
}

/**
 * Gracefully close the singleton Redis connection.
 * After calling this, the next call to getRedisClient()
 * will create a fresh connection.
 */
export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}
