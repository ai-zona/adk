import { db } from "../db";
import type Redis from "ioredis";
import { ExecutionLogger } from "./execution-logger";
import { ExternalAgentRegistrationSchema } from "./types";
import type { ExternalAgentRegistration } from "./types";

// ──────────────────────────────────────────────────────
// External Agent Manager
// ──────────────────────────────────────────────────────
// Manages registration and health monitoring of externally
// hosted agents that participate in the AZA protocol but
// run outside the platform's sandbox infrastructure.
//
// External agents must provide a signed Agent Card (JWS)
// to prove their identity. The signature is verified against
// the agent's public key resolved from its DID.
// ──────────────────────────────────────────────────────

/** Default health check timeout in milliseconds. */
const HEALTH_CHECK_TIMEOUT_MS = 10000;

/**
 * A record for an externally-registered agent deployment.
 */
export type ExternalAgentRecord = Awaited<ReturnType<typeof db.agentDeployment.findUniqueOrThrow>>;

/**
 * Manages registration, verification, and health monitoring of external agents.
 *
 * External agents are agents that run outside the platform's managed runtime
 * (e.g., self-hosted, cloud functions, third-party services). They register
 * by providing a signed Agent Card, and the platform monitors their health
 * via HTTP probes.
 */
export class ExternalAgentManager {
  private logger: ExecutionLogger;

  constructor(private redis: Redis) {
    this.logger = new ExecutionLogger(redis);
  }

  // ────────────────────────────────────────────────────
  // Registration
  // ────────────────────────────────────────────────────

  /**
   * Register an external agent with the platform.
   *
   * Steps:
   * 1. Validate the registration payload.
   * 2. Verify the agent card signature against the agent's public key.
   * 3. Create or update an AgentDeployment record with type EXTERNAL.
   * 4. Log the registration event.
   *
   * @param registration - The external agent registration payload.
   * @throws Error if the agent card signature is invalid.
   */
  async register(registration: ExternalAgentRegistration): Promise<void> {
    const validated = ExternalAgentRegistrationSchema.parse(registration);

    // 1. Verify the agent card signature
    const isValid = await this.verifyAgentCard(validated.agentDid, validated.agentCardSignature);
    if (!isValid) {
      throw new Error(`Agent card signature verification failed for DID "${validated.agentDid}"`);
    }

    // 2. Look up or resolve the agent record
    // Find the agent by looking up their identity
    const agentIdentity = await db.agentIdentity.findFirst({
      where: { did: validated.agentDid },
    });

    if (!agentIdentity) {
      throw new Error(`No agent identity found for DID "${validated.agentDid}"`);
    }

    // 3. Upsert the AgentRuntime for external type
    await db.agentRuntime.upsert({
      where: { agentId: agentIdentity.id },
      create: {
        agentId: agentIdentity.id,
        runtimeType: "external",
        networkPolicy: "full",
        env: {} as any,
      },
      update: {
        runtimeType: "external",
      },
    });

    // 4. Upsert the AgentDeployment with type EXTERNAL
    const existingDeployment = await db.agentDeployment.findFirst({
      where: {
        agentId: agentIdentity.id,
        deploymentType: "EXTERNAL",
      },
    });

    if (existingDeployment) {
      await db.agentDeployment.update({
        where: { id: existingDeployment.id },
        data: {
          url: validated.url,
          status: "RUNNING",
          healthCheckUrl: validated.healthCheckUrl ?? null,
          config: {
            runtimeType: "external",
            agentDid: validated.agentDid,
            registeredAt: Date.now(),
          } as any,
        },
      });

      await this.logger.log(existingDeployment.id, {
        timestamp: Date.now(),
        level: "info",
        message: `External agent re-registered at ${validated.url}`,
        metadata: { agentDid: validated.agentDid },
      });
    } else {
      const deployment = await db.agentDeployment.create({
        data: {
          agentId: agentIdentity.id,
          deploymentType: "EXTERNAL",
          status: "RUNNING",
          url: validated.url,
          healthCheckUrl: validated.healthCheckUrl ?? null,
          config: {
            runtimeType: "external",
            agentDid: validated.agentDid,
            registeredAt: Date.now(),
          } as any,
          metrics: {} as any,
        },
      });

      await this.logger.log(deployment.id, {
        timestamp: Date.now(),
        level: "info",
        message: `External agent registered at ${validated.url}`,
        metadata: { agentDid: validated.agentDid },
      });
    }
  }

  // ────────────────────────────────────────────────────
  // Unregistration
  // ────────────────────────────────────────────────────

  /**
   * Unregister an external agent.
   *
   * Marks the deployment as STOPPED and cleans up associated logs/metrics.
   *
   * @param agentDid - The DID of the agent to unregister.
   */
  async unregister(agentDid: string): Promise<void> {
    const agentIdentity = await db.agentIdentity.findFirst({
      where: { did: agentDid },
    });

    if (!agentIdentity) {
      throw new Error(`No agent identity found for DID "${agentDid}"`);
    }

    const deployment = await db.agentDeployment.findFirst({
      where: {
        agentId: agentIdentity.id,
        deploymentType: "EXTERNAL",
      },
    });

    if (!deployment) {
      throw new Error(`No external deployment found for DID "${agentDid}"`);
    }

    await db.agentDeployment.update({
      where: { id: deployment.id },
      data: { status: "STOPPED" },
    });

    await this.logger.log(deployment.id, {
      timestamp: Date.now(),
      level: "info",
      message: "External agent unregistered",
      metadata: { agentDid },
    });

    // Clean up Redis data
    await this.logger.cleanup(deployment.id);
  }

  // ────────────────────────────────────────────────────
  // Agent Card Verification
  // ────────────────────────────────────────────────────

  /**
   * Verify an agent card signature against the agent's public key.
   *
   * Resolves the agent's DID to obtain the public key, then verifies
   * the JWS signature on the agent card.
   *
   * @param agentDid - The agent's DID to resolve the public key for.
   * @param signature - The JWS-format agent card signature to verify.
   * @returns true if the signature is valid, false otherwise.
   */
  async verifyAgentCard(agentDid: string, signature: string): Promise<boolean> {
    try {
      // Look up the agent's public key from their identity record
      const agentIdentity = await db.agentIdentity.findFirst({
        where: { did: agentDid },
      });

      if (!agentIdentity?.publicKey) {
        return false;
      }

      // Import the verification function dynamically to avoid circular deps
      const { isValidSignature } = await import("../identity/signing");
      const { publicKeyFromHex } = await import("../identity/keypair");

      const publicKey = publicKeyFromHex(agentIdentity.publicKey);
      return await isValidSignature(signature, publicKey);
    } catch {
      return false;
    }
  }

  // ────────────────────────────────────────────────────
  // Query
  // ────────────────────────────────────────────────────

  /**
   * List all registered external agent deployments.
   *
   * @returns An array of EXTERNAL deployment records.
   */
  async getExternalAgents(): Promise<ExternalAgentRecord[]> {
    return db.agentDeployment.findMany({
      where: { deploymentType: "EXTERNAL" },
      orderBy: { createdAt: "desc" },
    });
  }

  // ────────────────────────────────────────────────────
  // Health Checks
  // ────────────────────────────────────────────────────

  /**
   * Perform an HTTP health check against a registered external agent.
   *
   * Uses the agent's healthCheckUrl if available, otherwise falls
   * back to the agent's main URL.
   *
   * @param agentDid - The DID of the external agent to health-check.
   * @returns The health status and round-trip latency in milliseconds.
   */
  async checkHealth(agentDid: string): Promise<{ healthy: boolean; latencyMs: number }> {
    const agentIdentity = await db.agentIdentity.findFirst({
      where: { did: agentDid },
    });

    if (!agentIdentity) {
      throw new Error(`No agent identity found for DID "${agentDid}"`);
    }

    const deployment = await db.agentDeployment.findFirst({
      where: {
        agentId: agentIdentity.id,
        deploymentType: "EXTERNAL",
      },
    });

    if (!deployment) {
      throw new Error(`No external deployment found for DID "${agentDid}"`);
    }

    const checkUrl = deployment.healthCheckUrl ?? deployment.url;
    if (!checkUrl) {
      throw new Error(`No URL available for health check of DID "${agentDid}"`);
    }

    const startTime = performance.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(checkUrl, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const latencyMs = Math.round(performance.now() - startTime);
      const healthy = response.ok;

      // Update metrics in Redis
      await this.logger.captureMetrics(deployment.id, {
        lastHealthCheck: Date.now(),
        healthStatus: healthy ? "healthy" : "unhealthy",
      });

      // Update deployment record
      await db.agentDeployment.update({
        where: { id: deployment.id },
        data: { lastHealthCheck: new Date() },
      });

      if (!healthy) {
        await this.logger.log(deployment.id, {
          timestamp: Date.now(),
          level: "warn",
          message: `Health check failed with status ${response.status}`,
          metadata: { url: checkUrl, latencyMs },
        });
      }

      return { healthy, latencyMs };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);

      await this.logger.captureMetrics(deployment.id, {
        lastHealthCheck: Date.now(),
        healthStatus: "unhealthy",
      });

      await this.logger.log(deployment.id, {
        timestamp: Date.now(),
        level: "error",
        message: `Health check error: ${error instanceof Error ? error.message : String(error)}`,
        metadata: { url: checkUrl, latencyMs },
      });

      return { healthy: false, latencyMs };
    }
  }
}
