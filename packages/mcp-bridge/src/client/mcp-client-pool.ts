import type { MCPClientPoolConfig, MCPServerConfig, PoolStats } from "../types";
import { MCPClient } from "./mcp-client";

interface PoolEntry {
  client: MCPClient;
  /** Whether this client is currently checked out */
  inUse: boolean;
  /** Timestamp of last release back to pool */
  lastUsedAt: number;
  /** Idle timeout handle */
  idleTimer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_POOL_CONFIG: MCPClientPoolConfig = {
  maxClientsPerServer: 5,
  idleTimeoutMs: 300_000, // 5 minutes
};

/**
 * MCPClientPool manages a pool of MCPClient instances per server,
 * enabling connection reuse and limiting concurrent connections.
 *
 * Clients are lazily created on acquire and automatically disconnected
 * after being idle for the configured timeout period.
 */
export class MCPClientPool {
  private pools: Map<string, PoolEntry[]> = new Map();
  private config: MCPClientPoolConfig;

  constructor(config?: Partial<MCPClientPoolConfig>) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
  }

  /**
   * Acquires a connected MCPClient for the given server.
   *
   * First attempts to reuse an idle client from the pool.
   * If none are available and the pool is not at capacity, creates a new client.
   * If the pool is at capacity, waits briefly and retries.
   *
   * @param serverConfig - Configuration for the target MCP server
   * @returns A connected MCPClient ready for use
   * @throws If no client can be acquired (pool exhausted)
   */
  async acquire(serverConfig: MCPServerConfig): Promise<MCPClient> {
    const serverId = serverConfig.id;
    let pool = this.pools.get(serverId);

    if (!pool) {
      pool = [];
      this.pools.set(serverId, pool);
    }

    // 1. Try to find an idle, connected client
    for (const entry of pool) {
      if (!entry.inUse && entry.client.isConnected()) {
        entry.inUse = true;
        if (entry.idleTimer) {
          clearTimeout(entry.idleTimer);
          entry.idleTimer = undefined;
        }
        return entry.client;
      }
    }

    // 2. Clean up disconnected entries
    const disconnected = pool.filter((e) => !e.inUse && !e.client.isConnected());
    for (const entry of disconnected) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
      }
      const idx = pool.indexOf(entry);
      if (idx !== -1) {
        pool.splice(idx, 1);
      }
    }

    // 3. Create a new client if under capacity
    if (pool.length < this.config.maxClientsPerServer) {
      const client = new MCPClient(serverConfig);
      await client.connect();

      const entry: PoolEntry = {
        client,
        inUse: true,
        lastUsedAt: Date.now(),
      };
      pool.push(entry);
      return client;
    }

    // 4. Pool is at capacity; throw
    throw new Error(
      `Connection pool exhausted for server ${serverId}. ` +
        `Max ${this.config.maxClientsPerServer} clients allowed.`,
    );
  }

  /**
   * Releases a client back to the pool, making it available for reuse.
   * Starts the idle timeout timer; if the client is not reused within
   * the timeout period, it will be disconnected and removed from the pool.
   *
   * @param serverId - The server ID the client belongs to
   * @param client - The MCPClient to release
   */
  async release(serverId: string, client: MCPClient): Promise<void> {
    const pool = this.pools.get(serverId);
    if (!pool) {
      // Pool was already destroyed, just disconnect
      await client.disconnect();
      return;
    }

    const entry = pool.find((e) => e.client === client);
    if (!entry) {
      // Client not in pool, disconnect it
      await client.disconnect();
      return;
    }

    entry.inUse = false;
    entry.lastUsedAt = Date.now();

    // Start idle timer
    entry.idleTimer = setTimeout(async () => {
      // Only clean up if still idle
      if (!entry.inUse) {
        try {
          await entry.client.disconnect();
        } catch {
          // Ignore disconnect errors during cleanup
        }
        const currentPool = this.pools.get(serverId);
        if (currentPool) {
          const idx = currentPool.indexOf(entry);
          if (idx !== -1) {
            currentPool.splice(idx, 1);
          }
          if (currentPool.length === 0) {
            this.pools.delete(serverId);
          }
        }
      }
    }, this.config.idleTimeoutMs);
  }

  /**
   * Destroys all pools and disconnects all clients.
   * Should be called during application shutdown.
   */
  async destroyAll(): Promise<void> {
    const disconnectPromises: Promise<void>[] = [];

    for (const [_serverId, pool] of this.pools) {
      for (const entry of pool) {
        if (entry.idleTimer) {
          clearTimeout(entry.idleTimer);
        }
        disconnectPromises.push(
          entry.client.disconnect().catch(() => {
            // Ignore individual disconnect errors during bulk destroy
          }),
        );
      }
    }

    this.pools.clear();

    await Promise.all(disconnectPromises);
  }

  /**
   * Returns pool statistics for all servers.
   *
   * @returns An array of pool stats per server
   */
  getPoolStats(): PoolStats[] {
    const stats: PoolStats[] = [];

    for (const [serverId, pool] of this.pools) {
      const active = pool.filter((e) => e.inUse).length;
      const idle = pool.filter((e) => !e.inUse).length;
      stats.push({ serverId, active, idle });
    }

    return stats;
  }
}
