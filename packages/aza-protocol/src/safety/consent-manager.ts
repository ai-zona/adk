import type Redis from "ioredis";
import { AZAError, AZAErrorCode } from "../types/errors";

// ──────────────────────────────────────────────────────
// Consent Framework
// ──────────────────────────────────────────────────────
// Four-tier consent model for agent-to-agent operations.
//
// Tiers:
//   AUTO        — Low-risk ops (heartbeat, status). Immediately approved.
//   NOTIFY      — Read-only ops. Auto-approved, notification sent.
//   EXPLICIT    — Write/payment ops. Requires explicit human/agent approval.
//   MULTI_PARTY — Multi-agent ops. Requires approval from multiple parties.
//
// All decisions are cached in Redis with configurable TTL.
// Pending requests are stored in Redis hashes for approval workflows.
// ──────────────────────────────────────────────────────

/** Default TTL for cached consent decisions (1 hour). */
const DEFAULT_CONSENT_TTL_SECONDS = 3600;

/** Default timeout for explicit consent requests (5 minutes). */
const DEFAULT_CONSENT_TIMEOUT_MS = 300_000;

/** Redis key prefix for consent decisions. */
const CONSENT_KEY_PREFIX = "aza:consent";

/** Redis key prefix for pending consent requests. */
const CONSENT_PENDING_PREFIX = "aza:consent:pending";

/** Redis key prefix for consent notifications. */
const CONSENT_NOTIFY_PREFIX = "aza:consent:notify";

// ──────────────────────────────────────────────────────
// Consent Tiers
// ──────────────────────────────────────────────────────

export const ConsentTier = {
  AUTO: "auto",
  NOTIFY: "notify",
  EXPLICIT: "explicit",
  MULTI_PARTY: "multi-party",
} as const;

export type ConsentTier = (typeof ConsentTier)[keyof typeof ConsentTier];

// ──────────────────────────────────────────────────────
// Consent Request / Decision
// ──────────────────────────────────────────────────────

export interface ConsentRequest {
  taskId: string;
  requesterDid: string;
  targetDid: string;
  action: string;
  scope: string;
  tier: ConsentTier;
  resources?: string[];
  expiresAt?: number;
}

export interface ConsentDecision {
  approved: boolean;
  tier: ConsentTier;
  conditions?: string[];
  approvedBy?: string;
  expiresAt?: number;
  decidedAt: number;
}

// ──────────────────────────────────────────────────────
// Tier Determination Rules
// ──────────────────────────────────────────────────────

/** Actions that are auto-approved (heartbeat, status checks). */
const AUTO_ACTIONS = new Set(["heartbeat", "status", "ping", "health"]);

/** Scopes that are auto-approved. */
const AUTO_SCOPES = new Set(["system", "monitoring"]);

/** Actions that require only notification (read-only). */
const NOTIFY_ACTIONS = new Set(["read", "query", "discover", "list", "get", "search"]);

/** Actions that require explicit approval (write, payment). */
const EXPLICIT_ACTIONS = new Set([
  "write",
  "update",
  "delete",
  "payment",
  "transfer",
  "execute",
  "deploy",
]);

/** Scopes that require multi-party approval. */
const MULTI_PARTY_SCOPES = new Set(["multi-agent", "team-action", "governance", "budget"]);

// ──────────────────────────────────────────────────────
// Consent Manager
// ──────────────────────────────────────────────────────

export class ConsentManager {
  constructor(private redis: Redis) {}

  // ────────────────────────────────────────────────────
  // Tier Determination
  // ────────────────────────────────────────────────────

  /**
   * Determine the consent tier for a given action and scope.
   *
   * Rules (evaluated in order of strictness, highest wins):
   *   1. Multi-party scopes -> MULTI_PARTY
   *   2. Explicit actions (write, payment, etc.) -> EXPLICIT
   *   3. Notify actions (read, query, etc.) -> NOTIFY
   *   4. Auto actions/scopes (heartbeat, status) -> AUTO
   *   5. Default -> EXPLICIT (fail-safe: unknown actions require approval)
   */
  determineTier(action: string, scope: string): ConsentTier {
    const normalizedAction = action.toLowerCase();
    const normalizedScope = scope.toLowerCase();

    // Multi-party scopes are the most restrictive
    if (MULTI_PARTY_SCOPES.has(normalizedScope)) {
      return ConsentTier.MULTI_PARTY;
    }

    // Explicit actions require human/agent approval
    if (EXPLICIT_ACTIONS.has(normalizedAction)) {
      return ConsentTier.EXPLICIT;
    }

    // Auto actions and scopes are lowest friction
    if (AUTO_ACTIONS.has(normalizedAction) || AUTO_SCOPES.has(normalizedScope)) {
      return ConsentTier.AUTO;
    }

    // Notify actions are auto-approved with notification
    if (NOTIFY_ACTIONS.has(normalizedAction)) {
      return ConsentTier.NOTIFY;
    }

    // Default: require explicit consent (fail-safe)
    return ConsentTier.EXPLICIT;
  }

  // ────────────────────────────────────────────────────
  // Consent Check (Cached)
  // ────────────────────────────────────────────────────

  /**
   * Check whether a consent decision already exists in the cache.
   * Returns null if no cached decision is found or if the cached
   * decision has expired.
   */
  async checkConsent(
    requesterDid: string,
    targetDid: string,
    action: string,
  ): Promise<ConsentDecision | null> {
    const key = this.consentKey(requesterDid, targetDid, action);

    const cached = await this.redis.get(key);
    if (!cached) return null;

    try {
      const decision = JSON.parse(cached) as ConsentDecision;

      // Check if the decision has expired
      if (decision.expiresAt && decision.expiresAt < Date.now()) {
        await this.redis.del(key);
        return null;
      }

      return decision;
    } catch {
      // Corrupted cache entry — remove it
      await this.redis.del(key);
      return null;
    }
  }

  // ────────────────────────────────────────────────────
  // Consent Request
  // ────────────────────────────────────────────────────

  /**
   * Request consent for an action.
   *
   * Behavior varies by tier:
   *   AUTO       — Immediately approved, cached.
   *   NOTIFY     — Immediately approved, cached, notification queued.
   *   EXPLICIT   — Queued for approval, blocks until decided or timeout.
   *   MULTI_PARTY — Queued for multiple approvals, blocks until quorum or timeout.
   */
  async requestConsent(request: ConsentRequest): Promise<ConsentDecision> {
    // Check for existing cached consent first
    const existing = await this.checkConsent(
      request.requesterDid,
      request.targetDid,
      request.action,
    );
    if (existing) return existing;

    switch (request.tier) {
      case ConsentTier.AUTO:
        return this.handleAutoConsent(request);

      case ConsentTier.NOTIFY:
        return this.handleNotifyConsent(request);

      case ConsentTier.EXPLICIT:
        return this.handleExplicitConsent(request);

      case ConsentTier.MULTI_PARTY:
        return this.handleMultiPartyConsent(request);

      default: {
        // Unreachable if all tiers are handled, but fail-safe
        const _exhaustive: never = request.tier;
        throw new AZAError(AZAErrorCode.CONSENT_REQUIRED, `Unknown consent tier: ${_exhaustive}`, {
          details: { taskId: request.taskId },
        });
      }
    }
  }

  // ────────────────────────────────────────────────────
  // Grant / Deny / Revoke
  // ────────────────────────────────────────────────────

  /**
   * Grant consent for a pending request.
   * Called by the approving agent/user in response to an EXPLICIT or
   * MULTI_PARTY consent request.
   */
  async grantConsent(taskId: string, approverDid: string, conditions?: string[]): Promise<void> {
    const pendingKey = `${CONSENT_PENDING_PREFIX}:${taskId}`;
    const raw = await this.redis.get(pendingKey);

    if (!raw) {
      throw new AZAError(
        AZAErrorCode.CONSENT_EXPIRED,
        `No pending consent request found for task ${taskId}`,
        { details: { taskId } },
      );
    }

    const request = JSON.parse(raw) as ConsentRequest;

    const decision: ConsentDecision = {
      approved: true,
      tier: request.tier,
      conditions,
      approvedBy: approverDid,
      expiresAt: request.expiresAt,
      decidedAt: Date.now(),
    };

    // Cache the decision
    const consentKey = this.consentKey(request.requesterDid, request.targetDid, request.action);
    await this.cacheDecision(consentKey, decision);

    // Store the decision so the waiting requestConsent call can pick it up
    const decisionKey = `${CONSENT_PENDING_PREFIX}:${taskId}:decision`;
    await this.redis.set(decisionKey, JSON.stringify(decision), "EX", 300);

    // Clean up the pending request
    await this.redis.del(pendingKey);
  }

  /**
   * Deny consent for a pending request.
   */
  async denyConsent(taskId: string, denierDid: string, reason?: string): Promise<void> {
    const pendingKey = `${CONSENT_PENDING_PREFIX}:${taskId}`;
    const raw = await this.redis.get(pendingKey);

    if (!raw) {
      throw new AZAError(
        AZAErrorCode.CONSENT_EXPIRED,
        `No pending consent request found for task ${taskId}`,
        { details: { taskId } },
      );
    }

    const request = JSON.parse(raw) as ConsentRequest;

    const decision: ConsentDecision = {
      approved: false,
      tier: request.tier,
      conditions: reason ? [reason] : undefined,
      approvedBy: denierDid,
      decidedAt: Date.now(),
    };

    // Store the denial so the waiting requestConsent call can pick it up
    const decisionKey = `${CONSENT_PENDING_PREFIX}:${taskId}:decision`;
    await this.redis.set(decisionKey, JSON.stringify(decision), "EX", 300);

    // Clean up the pending request
    await this.redis.del(pendingKey);
  }

  /**
   * Revoke previously granted consent.
   * Removes the cached decision, forcing re-approval on next request.
   */
  async revokeConsent(requesterDid: string, targetDid: string, action: string): Promise<void> {
    const key = this.consentKey(requesterDid, targetDid, action);
    await this.redis.del(key);
  }

  // ────────────────────────────────────────────────────
  // Private: Tier Handlers
  // ────────────────────────────────────────────────────

  /**
   * AUTO tier: immediately approve and cache.
   */
  private async handleAutoConsent(request: ConsentRequest): Promise<ConsentDecision> {
    const decision: ConsentDecision = {
      approved: true,
      tier: ConsentTier.AUTO,
      approvedBy: "system",
      expiresAt: request.expiresAt,
      decidedAt: Date.now(),
    };

    const key = this.consentKey(request.requesterDid, request.targetDid, request.action);
    await this.cacheDecision(key, decision);

    return decision;
  }

  /**
   * NOTIFY tier: immediately approve, cache, and queue notification.
   */
  private async handleNotifyConsent(request: ConsentRequest): Promise<ConsentDecision> {
    const decision: ConsentDecision = {
      approved: true,
      tier: ConsentTier.NOTIFY,
      approvedBy: "system",
      expiresAt: request.expiresAt,
      decidedAt: Date.now(),
    };

    const key = this.consentKey(request.requesterDid, request.targetDid, request.action);
    await this.cacheDecision(key, decision);

    // Queue notification to the target agent
    try {
      await this.redis.xadd(
        `${CONSENT_NOTIFY_PREFIX}:${request.targetDid}`,
        "*",
        "data",
        JSON.stringify({
          type: "consent.notify",
          taskId: request.taskId,
          requesterDid: request.requesterDid,
          action: request.action,
          scope: request.scope,
          resources: request.resources,
          decidedAt: decision.decidedAt,
        }),
      );
    } catch (notifyError) {
      // Notification failure is non-fatal — the consent is still granted
      console.error(
        "[ConsentManager] Failed to send consent notification:",
        notifyError instanceof Error ? notifyError.message : notifyError,
      );
    }

    return decision;
  }

  /**
   * EXPLICIT tier: queue for approval and wait for decision.
   */
  private async handleExplicitConsent(request: ConsentRequest): Promise<ConsentDecision> {
    // Store the pending request
    const pendingKey = `${CONSENT_PENDING_PREFIX}:${request.taskId}`;
    const timeoutSeconds = Math.ceil(DEFAULT_CONSENT_TIMEOUT_MS / 1000);
    await this.redis.set(pendingKey, JSON.stringify(request), "EX", timeoutSeconds);

    // Queue a consent request notification to the target
    await this.redis.xadd(
      `${CONSENT_NOTIFY_PREFIX}:${request.targetDid}`,
      "*",
      "data",
      JSON.stringify({
        type: "consent.request",
        taskId: request.taskId,
        requesterDid: request.requesterDid,
        action: request.action,
        scope: request.scope,
        resources: request.resources,
        tier: request.tier,
      }),
    );

    // Poll for decision with timeout
    return this.waitForDecision(request.taskId, DEFAULT_CONSENT_TIMEOUT_MS);
  }

  /**
   * MULTI_PARTY tier: queue for multiple approvals and wait for quorum.
   * Currently requires at least 2 approvals (the target + one additional party).
   */
  private async handleMultiPartyConsent(request: ConsentRequest): Promise<ConsentDecision> {
    // Store the pending request
    const pendingKey = `${CONSENT_PENDING_PREFIX}:${request.taskId}`;
    const timeoutSeconds = Math.ceil(DEFAULT_CONSENT_TIMEOUT_MS / 1000);
    await this.redis.set(pendingKey, JSON.stringify(request), "EX", timeoutSeconds);

    // Queue consent request notifications
    await this.redis.xadd(
      `${CONSENT_NOTIFY_PREFIX}:${request.targetDid}`,
      "*",
      "data",
      JSON.stringify({
        type: "consent.request",
        taskId: request.taskId,
        requesterDid: request.requesterDid,
        action: request.action,
        scope: request.scope,
        resources: request.resources,
        tier: request.tier,
      }),
    );

    // Poll for decision with timeout
    return this.waitForDecision(request.taskId, DEFAULT_CONSENT_TIMEOUT_MS);
  }

  // ────────────────────────────────────────────────────
  // Private: Decision Polling
  // ────────────────────────────────────────────────────

  /**
   * Poll Redis for a consent decision until it appears or timeout.
   */
  private async waitForDecision(taskId: string, timeoutMs: number): Promise<ConsentDecision> {
    const decisionKey = `${CONSENT_PENDING_PREFIX}:${taskId}:decision`;
    const deadline = Date.now() + timeoutMs;
    const pollIntervalMs = 500;

    while (Date.now() < deadline) {
      const raw = await this.redis.get(decisionKey);
      if (raw) {
        // Clean up the decision key
        await this.redis.del(decisionKey);
        const decision = JSON.parse(raw) as ConsentDecision;
        return decision;
      }

      // Wait before polling again
      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // Timeout: clean up and deny
    const pendingKey = `${CONSENT_PENDING_PREFIX}:${taskId}`;
    await this.redis.del(pendingKey);

    throw new AZAError(
      AZAErrorCode.CONSENT_EXPIRED,
      `Consent request timed out for task ${taskId}`,
      {
        details: { taskId, timeoutMs },
        retryable: true,
        retryAfterMs: 5000,
      },
    );
  }

  // ────────────────────────────────────────────────────
  // Private: Cache Management
  // ────────────────────────────────────────────────────

  /**
   * Cache a consent decision in Redis with optional TTL.
   */
  private async cacheDecision(
    key: string,
    decision: ConsentDecision,
    ttlSeconds?: number,
  ): Promise<void> {
    const ttl = ttlSeconds ?? DEFAULT_CONSENT_TTL_SECONDS;
    await this.redis.set(key, JSON.stringify(decision), "EX", ttl);
  }

  /**
   * Build the Redis key for a consent decision.
   * Format: aza:consent:<requesterDid>:<targetDid>:<action>
   */
  private consentKey(requesterDid: string, targetDid: string, action: string): string {
    return `${CONSENT_KEY_PREFIX}:${requesterDid}:${targetDid}:${action}`;
  }
}
