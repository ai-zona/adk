import type { AZAEnvelope, AZAMessageType } from "@aizona/aza-protocol";
import {
  MessageHandler,
  RedisStreamTransport,
  TaskStatus,
  closeRedis,
  createRedisClient,
  privateKeyFromHex,
  signMessage,
} from "@aizona/aza-protocol";
import type Redis from "ioredis";
import { HeartbeatSender } from "./heartbeat";
import { AZA_CLIENT_VERSION } from "./index";

// ──────────────────────────────────────────────────────
// AZA Agent SDK
// ──────────────────────────────────────────────────────
// High-level SDK for building agents that participate in
// the AZA protocol. Wraps the transport layer, message
// handling, heartbeats, and task lifecycle operations
// into a single easy-to-use class.
// ──────────────────────────────────────────────────────

/**
 * Configuration for creating an AZAAgent instance.
 */
export interface AZAAgentConfig {
  /** The agent's DID identity (e.g., "did:aza:devnet:abc123"). */
  agentDid: string;
  /** Hex-encoded Ed25519 private key for signing messages. */
  privateKeyHex?: string;
  /** Redis connection URL. Defaults to "redis://localhost:6379". */
  redisUrl?: string;
  /** Whether to automatically send heartbeats. Default: true. */
  autoHeartbeat?: boolean;
  /** Interval between heartbeats in milliseconds. Default: 30000. */
  heartbeatIntervalMs?: number;
  /** Consumer group name override. Default: auto-generated from DID. */
  consumerGroup?: string;
  /** Consumer ID within the group. Default: "consumer-1". */
  consumerId?: string;
  /** Maximum message processing retries before DLQ. Default: 3. */
  maxRetries?: number;
}

/**
 * Handler for incoming task request envelopes.
 */
export type TaskRequestHandler = (envelope: AZAEnvelope) => Promise<void>;

/**
 * Handler for any incoming message envelope.
 */
export type MessageHandler_ = (envelope: AZAEnvelope) => Promise<void>;

/**
 * High-level SDK agent class for the AZA protocol.
 *
 * Provides a simple interface for:
 * - Connecting to the message transport (Redis Streams)
 * - Sending and receiving protocol messages
 * - Managing task lifecycle (accept, complete, fail, cancel)
 * - Using tools via the MCP bridge
 * - Automatic heartbeat broadcasting
 *
 * @example
 * ```ts
 * const agent = new AZAAgent({
 *   agentDid: "did:aza:devnet:my-agent",
 *   redisUrl: "redis://localhost:6379",
 * });
 *
 * agent.onTaskRequest(async (envelope) => {
 *   const taskId = envelope.payload.taskId;
 *   await agent.acceptTask(taskId);
 *   // ... do work ...
 *   await agent.completeTask(taskId, { result: "done" });
 * });
 *
 * await agent.connect();
 * ```
 */
export class AZAAgent {
  private readonly config: AZAAgentConfig;
  private readonly handlers: Map<string, MessageHandler_>;
  private connected: boolean;

  // Transport layer
  private redis: Redis | null;
  private subscriberRedis: Redis | null;
  private transport: RedisStreamTransport | null;
  private messageHandler: MessageHandler | null;

  // Heartbeat
  private heartbeatSender: HeartbeatSender | null;

  constructor(config: AZAAgentConfig) {
    this.config = {
      autoHeartbeat: true,
      heartbeatIntervalMs: 30_000,
      redisUrl: "redis://localhost:6379",
      maxRetries: 3,
      consumerId: "consumer-1",
      ...config,
    };

    this.handlers = new Map();
    this.connected = false;
    this.redis = null;
    this.subscriberRedis = null;
    this.transport = null;
    this.messageHandler = null;
    this.heartbeatSender = null;
  }

  // ────────────────────────────────────────────────────
  // Connection Lifecycle
  // ────────────────────────────────────────────────────

  /**
   * Connect to the Redis transport, initialize the message consumer,
   * and optionally start the heartbeat sender.
   *
   * This starts a blocking XREADGROUP consumer loop in the background.
   * Messages are dispatched to registered handlers.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error("AZAAgent is already connected");
    }

    // Create Redis connections (one for commands, one for blocking subscribe)
    this.redis = createRedisClient(this.config.redisUrl);
    this.subscriberRedis = createRedisClient(this.config.redisUrl);

    // Initialize transport on the subscriber connection (for blocking reads)
    this.transport = new RedisStreamTransport(this.subscriberRedis);

    // Build the MessageHandler with all registered handlers
    this.messageHandler = new MessageHandler({
      agentDid: this.config.agentDid,
      transport: this.transport,
      redis: this.redis,
      handlers: this.handlers,
      maxRetries: this.config.maxRetries,
      consumerGroup: this.config.consumerGroup,
      consumerId: this.config.consumerId,
    });

    // Start the consumer loop in the background (non-blocking)
    void this.messageHandler.start().catch((error) => {
      console.error(
        `[AZAAgent] Message handler crashed for ${this.config.agentDid}:`,
        error instanceof Error ? error.message : error,
      );
    });

    // Start heartbeat if enabled
    if (this.config.autoHeartbeat) {
      this.heartbeatSender = new HeartbeatSender({
        agentDid: this.config.agentDid,
        intervalMs: this.config.heartbeatIntervalMs!,
        version: AZA_CLIENT_VERSION,
      });

      // The heartbeat sender uses the command Redis connection to publish
      const commandTransport = new RedisStreamTransport(this.redis);
      this.heartbeatSender.start(async (partialEnvelope) => {
        // Broadcast heartbeat to the agent's own stream (platform monitors it)
        const streamKey = RedisStreamTransport.agentStream(this.config.agentDid);
        // Build a complete envelope for publishing
        const envelope: AZAEnvelope = {
          id: crypto.randomUUID(),
          from: this.config.agentDid,
          to: null,
          correlationId: crypto.randomUUID(),
          timestamp: Date.now(),
          priority: "NORMAL",
          ...partialEnvelope,
        } as AZAEnvelope;
        await commandTransport.publish(streamKey, envelope);
      });
    }

    this.connected = true;
    console.log(`[AZAAgent] Connected: ${this.config.agentDid}`);
  }

  /**
   * Gracefully disconnect the agent.
   *
   * Stops the heartbeat sender, the message consumer loop,
   * and closes both Redis connections.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    // Stop heartbeat
    if (this.heartbeatSender) {
      this.heartbeatSender.stop();
      this.heartbeatSender = null;
    }

    // Stop message consumer
    if (this.messageHandler) {
      await this.messageHandler.stop();
      this.messageHandler = null;
    }

    // Close Redis connections
    if (this.subscriberRedis) {
      this.subscriberRedis.disconnect();
      this.subscriberRedis = null;
    }

    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
    }

    this.transport = null;
    this.connected = false;
    console.log(`[AZAAgent] Disconnected: ${this.config.agentDid}`);
  }

  // ────────────────────────────────────────────────────
  // Task Operations
  // ────────────────────────────────────────────────────

  /**
   * Accept a task that was assigned to this agent.
   * Sends a task.accept message back to the requester.
   */
  async acceptTask(taskId: string): Promise<void> {
    await this.sendMessage("task.accept" as AZAMessageType, {
      taskId,
      message: "Task accepted",
    });
  }

  /**
   * Mark a task as completed with the given output data.
   * Sends a task.complete message back to the requester.
   */
  async completeTask(taskId: string, output: unknown): Promise<void> {
    await this.sendMessage("task.complete" as AZAMessageType, {
      taskId,
      output,
      durationMs: 0, // Caller should track actual duration
    });
  }

  /**
   * Mark a task as failed with an error description.
   * Sends a task.fail message back to the requester.
   */
  async failTask(taskId: string, error: string): Promise<void> {
    await this.sendMessage("task.fail" as AZAMessageType, {
      taskId,
      errorCode: "AGENT_ERROR",
      errorMessage: error,
      retryable: false,
    });
  }

  /**
   * Cancel a task. Optionally provide a reason.
   * Sends a task.cancel message.
   */
  async cancelTask(taskId: string, reason?: string): Promise<void> {
    await this.sendMessage("task.cancel" as AZAMessageType, {
      taskId,
      reason: reason ?? "Canceled by agent",
      canceledBy: this.config.agentDid,
    });
  }

  /**
   * Report progress on a task.
   * Sends a task.progress message with an optional percentage and message.
   */
  async reportProgress(taskId: string, progress: number, message?: string): Promise<void> {
    await this.sendMessage("task.progress" as AZAMessageType, {
      taskId,
      status: TaskStatus.WORKING,
      progress,
      message,
    });
  }

  // ────────────────────────────────────────────────────
  // Tool Usage
  // ────────────────────────────────────────────────────

  /**
   * Invoke an MCP tool by name with the given arguments.
   *
   * Uses a two-tier dispatch strategy:
   *
   * 1. **Direct MCP** (preferred): If `@aizona/mcp-bridge` is installed, creates
   *    an MCPClient connection to the appropriate server and calls the tool
   *    synchronously. Server URL is resolved from environment variables using
   *    the convention `MCP_SERVER_<SERVER>_URL` or `MCP_DEFAULT_SERVER_URL`.
   *
   * 2. **Protocol dispatch** (fallback): If the bridge is not installed but the
   *    agent is connected to the AZA transport, dispatches a `tool.request`
   *    message over Redis Streams. The result arrives asynchronously as a
   *    `tool.result` message.
   *
   * @param toolName - Fully qualified tool name ("server.tool") or plain tool name
   * @param args - Arguments to pass to the tool
   * @returns The tool execution result (direct) or a pending acknowledgment (protocol)
   */
  async useTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    // Parse the fully qualified tool name: "serverName.toolName" → [serverName, toolName]
    const dotIdx = toolName.indexOf(".");
    const serverHint = dotIdx > 0 ? toolName.slice(0, dotIdx) : undefined;
    const mcpToolName = dotIdx > 0 ? toolName.slice(dotIdx + 1) : toolName;

    // Attempt to invoke via @aizona/mcp-bridge if available.
    // The bridge is an optional peer dependency — if not installed, we
    // send the tool call as an AZA protocol message for server-side dispatch.
    try {
      // Use a variable for the module specifier so TypeScript does not attempt
      // compile-time resolution of @aizona/mcp-bridge (optional peer dep).
      const mcpBridgeModule = "@aizona/mcp-bridge";
      // biome-ignore lint/suspicious/noExplicitAny: optional dynamic import
      const { MCPClient } = (await import(/* webpackIgnore: true */ mcpBridgeModule)) as any;

      // Resolve the MCP server config from environment or convention.
      // In a full deployment the server registry would be queried; here
      // we use a convention-based URL from env vars.
      const serverUrl =
        process.env[`MCP_SERVER_${(serverHint ?? "default").toUpperCase()}_URL`] ??
        process.env.MCP_DEFAULT_SERVER_URL;

      if (!serverUrl) {
        throw new Error(
          `No MCP server URL configured for "${serverHint ?? "default"}". ` +
            `Set MCP_SERVER_${(serverHint ?? "default").toUpperCase()}_URL or MCP_DEFAULT_SERVER_URL.`,
        );
      }

      const client = new MCPClient({
        id: serverHint ?? "default",
        name: serverHint ?? "default",
        url: serverUrl,
        transport: "streamable-http",
        auth: { type: "none" },
      });

      try {
        await client.connect();
        const result = await client.callTool(mcpToolName, args);

        if (!result.success) {
          throw new Error(
            `MCP tool "${mcpToolName}" failed: ${result.error?.message ?? "Unknown error"}`,
          );
        }

        return result.data;
      } finally {
        await client.disconnect().catch(() => {
          // Swallow disconnect errors — best effort cleanup
        });
      }
    } catch (importErr) {
      // @aizona/mcp-bridge is not installed — fall back to protocol message dispatch.
      // Send a tool invocation request over the AZA transport so the platform
      // can route it to the appropriate MCP server.
      if (this.connected && this.transport) {
        await this.sendMessage("tool.request" as AZAMessageType, {
          toolName,
          arguments: args,
          requestedBy: this.config.agentDid,
        });

        // Protocol-based tool calls are async (fire-and-forget via streams).
        // The result will arrive as a "tool.result" message routed to this agent.
        return {
          pending: true,
          message: `Tool request "${toolName}" dispatched via AZA protocol. Listen for tool.result messages.`,
        };
      }

      throw new Error(
        `Cannot invoke tool "${toolName}": @aizona/mcp-bridge not installed and agent is not connected to transport. ` +
          `Original error: ${importErr instanceof Error ? importErr.message : String(importErr)}`,
      );
    }
  }

  // ────────────────────────────────────────────────────
  // Message Handling Registration
  // ────────────────────────────────────────────────────

  /**
   * Register a handler for incoming task.request messages.
   * When another agent requests a task from this agent,
   * the handler is called with the full envelope.
   */
  onTaskRequest(handler: TaskRequestHandler): void {
    this.handlers.set("task.request", handler);
  }

  /**
   * Register a handler for a specific message type.
   * Use this for consent requests, team invites, etc.
   *
   * @param type - The AZA message type string (e.g., "consent.request")
   * @param handler - Async function to process the envelope
   */
  onMessage(type: string, handler: MessageHandler_): void {
    this.handlers.set(type, handler);
  }

  /**
   * Remove a previously registered handler for a message type.
   */
  offMessage(type: string): void {
    this.handlers.delete(type);
  }

  // ────────────────────────────────────────────────────
  // Status Queries
  // ────────────────────────────────────────────────────

  /**
   * Returns true if the agent is connected to the transport.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Returns the agent's DID identifier.
   */
  getAgentDid(): string {
    return this.config.agentDid;
  }

  /**
   * Returns the client SDK version.
   */
  getVersion(): string {
    return AZA_CLIENT_VERSION;
  }

  // ────────────────────────────────────────────────────
  // Internal Helpers
  // ────────────────────────────────────────────────────

  /**
   * Send a typed message through the agent's outbound stream.
   * This builds a full AZAEnvelope and publishes it.
   */
  private async sendMessage(
    type: AZAMessageType,
    payload: Record<string, unknown>,
    to?: string,
  ): Promise<void> {
    if (!this.redis || !this.connected) {
      throw new Error("AZAAgent is not connected. Call connect() first.");
    }

    const commandTransport = new RedisStreamTransport(this.redis);

    const envelope: AZAEnvelope = {
      id: crypto.randomUUID(),
      from: this.config.agentDid,
      to: to ?? null,
      correlationId: (payload.taskId as string) ?? crypto.randomUUID(),
      timestamp: Date.now(),
      priority: "NORMAL",
      type,
      payload,
      metadata: {
        protocolVersion: AZA_CLIENT_VERSION,
      },
    } as AZAEnvelope;

    // Sign the envelope if a private key is configured
    if (this.config.privateKeyHex) {
      const privateKey = privateKeyFromHex(this.config.privateKeyHex);
      envelope.signature = await signMessage(envelope.payload, privateKey);
    }

    // Publish to the task stream if there's a taskId, otherwise to the agent's own stream
    const taskId = payload.taskId as string | undefined;
    const streamKey = taskId
      ? RedisStreamTransport.taskStream(taskId)
      : RedisStreamTransport.agentStream(this.config.agentDid);

    await commandTransport.publish(streamKey, envelope);
  }
}
