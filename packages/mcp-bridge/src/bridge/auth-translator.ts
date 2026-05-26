import type Redis from "ioredis";

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

/**
 * Identity context for an AZA agent making a tool request.
 */
export interface AuthContext {
  /** The agent's DID (decentralized identifier). */
  agentDid: string;
  /** The agent's database ID. */
  agentId: string;
  /** The target MCP server ID. */
  serverId: string;
}

/**
 * Authentication headers to attach to an outgoing MCP request.
 */
export interface MCPAuthHeaders {
  headers: Record<string, string>;
}

// ──────────────────────────────────────────────────────
// Redis key layout
// ──────────────────────────────────────────────────────
// Credentials are stored as Redis hashes:
//   mcp:creds:<serverId>:<agentId> -> { key1: val1, key2: val2 }

const CREDS_PREFIX = "mcp:creds:";

/**
 * Default TTL for stored credentials: 24 hours.
 * Credentials must be re-provisioned periodically.
 */
const CREDS_TTL_SECONDS = 24 * 60 * 60;

// ──────────────────────────────────────────────────────
// Supported auth type constants
// ──────────────────────────────────────────────────────

export const MCPServerAuthType = {
  NONE: "NONE",
  BEARER: "BEARER",
  API_KEY: "API_KEY",
  OAUTH2: "OAUTH2",
} as const;

export type MCPServerAuthType = (typeof MCPServerAuthType)[keyof typeof MCPServerAuthType];

// ──────────────────────────────────────────────────────
// AuthTranslator
// ──────────────────────────────────────────────────────

/**
 * Translates AZA agent identity into MCP server authentication headers.
 *
 * Each MCP server may require a different authentication mechanism.
 * The AuthTranslator looks up stored credentials for the agent/server
 * pair and produces the appropriate HTTP headers.
 *
 * Credentials are stored in Redis with a 24-hour TTL and must be
 * provisioned by the agent's owner or by platform automation.
 */
export class AuthTranslator {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  // ── Public API ────────────────────────────────────

  /**
   * Generates authentication headers for an MCP server request based on
   * the server's auth type and the agent's stored credentials.
   *
   * @param ctx            - The agent's auth context (DID, agentId, serverId)
   * @param serverAuthType - The MCP server's authentication type
   * @param credentials    - Optional inline credentials (overrides stored creds)
   * @returns Headers to include in the outgoing MCP request
   */
  async translate(
    ctx: AuthContext,
    serverAuthType: string,
    credentials?: Record<string, string>,
  ): Promise<MCPAuthHeaders> {
    // Use inline credentials if provided, otherwise look up stored ones
    const creds = credentials ?? (await this.getCredentials(ctx.serverId, ctx.agentId));

    switch (serverAuthType.toUpperCase()) {
      case MCPServerAuthType.NONE:
        return { headers: {} };

      case MCPServerAuthType.BEARER:
        return this.translateBearer(creds);

      case MCPServerAuthType.API_KEY:
        return this.translateApiKey(creds);

      case MCPServerAuthType.OAUTH2:
        return this.translateOAuth2(ctx, creds);

      default:
        // Unknown auth type: return empty headers and let the server reject
        return { headers: {} };
    }
  }

  /**
   * Stores credentials for a server/agent pair in Redis.
   *
   * Credentials are stored as a Redis hash with a TTL. They should
   * contain only the minimum necessary fields (e.g., a token or API key).
   *
   * @param serverId    - The MCP server ID
   * @param agentId     - The agent's database ID
   * @param credentials - Key-value credential pairs
   */
  async storeCredentials(
    serverId: string,
    agentId: string,
    credentials: Record<string, string>,
  ): Promise<void> {
    const key = this.credentialsKey(serverId, agentId);

    // Clear any existing credentials first
    await this.redis.del(key);

    if (Object.keys(credentials).length > 0) {
      await this.redis.hset(key, credentials);
      await this.redis.expire(key, CREDS_TTL_SECONDS);
    }
  }

  /**
   * Retrieves stored credentials for a server/agent pair.
   *
   * @param serverId - The MCP server ID
   * @param agentId  - The agent's database ID
   * @returns The stored credentials, or null if none exist
   */
  async getCredentials(serverId: string, agentId: string): Promise<Record<string, string> | null> {
    const key = this.credentialsKey(serverId, agentId);
    const raw = await this.redis.hgetall(key);

    if (!raw || Object.keys(raw).length === 0) {
      return null;
    }

    return raw;
  }

  /**
   * Removes stored credentials for a server/agent pair.
   *
   * @param serverId - The MCP server ID
   * @param agentId  - The agent's database ID
   */
  async removeCredentials(serverId: string, agentId: string): Promise<void> {
    const key = this.credentialsKey(serverId, agentId);
    await this.redis.del(key);
  }

  // ── Private helpers ───────────────────────────────

  /**
   * Produces Bearer token auth headers.
   *
   * Expects `creds.token` to contain the bearer token.
   */
  private translateBearer(creds: Record<string, string> | null): MCPAuthHeaders {
    const token = creds?.token;
    if (!token) {
      return { headers: {} };
    }

    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  }

  /**
   * Produces API key auth headers.
   *
   * Expects `creds.apiKey` for the key value and optionally
   * `creds.headerName` for a custom header (defaults to `X-API-Key`).
   */
  private translateApiKey(creds: Record<string, string> | null): MCPAuthHeaders {
    const apiKey = creds?.apiKey;
    if (!apiKey) {
      return { headers: {} };
    }

    const headerName = creds?.headerName ?? "X-API-Key";

    return {
      headers: {
        [headerName]: apiKey,
      },
    };
  }

  /**
   * Produces OAuth2 auth headers.
   *
   * For now this performs a simple token passthrough. Full OAuth2
   * flows (client credentials, authorization code) will be added
   * in a future iteration.
   *
   * Expects `creds.accessToken` to contain a valid OAuth2 access token.
   * If the token is expired and `creds.refreshToken` is present, a
   * token refresh could be attempted (future work).
   */
  private translateOAuth2(_ctx: AuthContext, creds: Record<string, string> | null): MCPAuthHeaders {
    const accessToken = creds?.accessToken;
    if (!accessToken) {
      return { headers: {} };
    }

    return {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };
  }

  /**
   * Generates the Redis key for a server/agent credential pair.
   */
  private credentialsKey(serverId: string, agentId: string): string {
    return `${CREDS_PREFIX}${serverId}:${agentId}`;
  }
}
