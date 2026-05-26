import type { AZAEnvelope } from "@aizona/aza-protocol";
import { AZA_CLIENT_VERSION } from "./index";

// ──────────────────────────────────────────────────────
// Heartbeat Sender
// ──────────────────────────────────────────────────────
// Periodically sends system.heartbeat envelopes so the
// platform knows the agent is alive and healthy.
// ──────────────────────────────────────────────────────

export interface HeartbeatConfig {
  /** The agent's DID for heartbeat identification. */
  agentDid: string;
  /** Interval in milliseconds between heartbeats. */
  intervalMs: number;
  /** Protocol version string included in the heartbeat payload. */
  version: string;
}

/**
 * Sends periodic heartbeat messages on behalf of an agent.
 *
 * Usage:
 * ```ts
 * const sender = new HeartbeatSender({
 *   agentDid: "did:aza:devnet:abc123",
 *   intervalMs: 30_000,
 *   version: "2.0.0",
 * });
 *
 * sender.start(async (envelope) => {
 *   await transport.publish(streamKey, envelope as AZAEnvelope);
 * });
 *
 * // Later...
 * sender.stop();
 * ```
 */
export class HeartbeatSender {
  private intervalId?: ReturnType<typeof setInterval>;
  private readonly startTime: number;

  constructor(private readonly config: HeartbeatConfig) {
    this.startTime = Date.now();
  }

  /**
   * Start sending heartbeats at the configured interval.
   *
   * @param sendFn - An async function that sends the heartbeat envelope
   *                 over the transport layer. The envelope is a partial
   *                 AZAEnvelope containing the heartbeat fields; the caller
   *                 should fill in `id`, `signature`, etc. as needed.
   */
  start(sendFn: (envelope: Partial<AZAEnvelope>) => Promise<void>): void {
    if (this.intervalId) {
      return; // Already running
    }

    // Send an initial heartbeat immediately
    void this.sendHeartbeat(sendFn);

    this.intervalId = setInterval(() => {
      void this.sendHeartbeat(sendFn);
    }, this.config.intervalMs);
  }

  /**
   * Stop sending heartbeats and clear the interval timer.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Returns true if the heartbeat sender is actively running.
   */
  isRunning(): boolean {
    return this.intervalId !== undefined;
  }

  /**
   * Get the uptime in seconds since this sender was created.
   */
  getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  // ────────────────────────────────────────────────────
  // Internal
  // ────────────────────────────────────────────────────

  private async sendHeartbeat(
    sendFn: (envelope: Partial<AZAEnvelope>) => Promise<void>,
  ): Promise<void> {
    const uptimeSeconds = this.getUptimeSeconds();

    const envelope: Partial<AZAEnvelope> = {
      from: this.config.agentDid,
      to: null,
      timestamp: Date.now(),
      type: "system.heartbeat" as const,
      payload: {
        agentDid: this.config.agentDid,
        uptime: uptimeSeconds,
        version: this.config.version || AZA_CLIENT_VERSION,
      },
      metadata: {
        protocolVersion: this.config.version || AZA_CLIENT_VERSION,
      },
    };

    try {
      await sendFn(envelope);
    } catch (error) {
      // Heartbeat failures are non-fatal — log and continue
      console.warn(
        `[HeartbeatSender] Failed to send heartbeat for ${this.config.agentDid}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}
