import type { AuditLogger } from "../audit/audit-logger";
import { signMessage } from "../identity/signing";
import type { MessageRouter } from "../transport/message-router";
import { AZAError, AZAErrorCode } from "../types/errors";
import type { AZAEnvelope } from "../types/messages";
import type { AZACircuitBreaker } from "./circuit-breaker";
import { ConsentTier } from "./consent-manager";
import type { ConsentManager, ConsentRequest } from "./consent-manager";
import type { AZARateLimiter } from "./rate-limiter";

// ──────────────────────────────────────────────────────
// Message Pipeline
// ──────────────────────────────────────────────────────
// Full send/receive pipeline that enforces safety checks
// in a strict, fail-closed order:
//
// SEND pipeline:
//   1. Circuit breaker check
//   2. Outbound rate limit check
//   3. Consent check (cached) or request consent
//   4. Sign the envelope (if signing key provided)
//   5. Audit log
//   6. Route via MessageRouter
//   7. Record success/failure for circuit breaker
//
// RECEIVE pipeline:
//   1. Inbound rate limit check
//   2. Verify signature (presence check; full verification deferred to router)
//   3. Audit log
//   4. Deliver to handler
// ──────────────────────────────────────────────────────

export class MessagePipeline {
  constructor(
    private circuitBreaker: AZACircuitBreaker,
    private rateLimiter: AZARateLimiter,
    private consentManager: ConsentManager,
    private auditLogger: AuditLogger,
    private router: MessageRouter,
    private signingKey?: Uint8Array,
  ) {}

  // ────────────────────────────────────────────────────
  // Send Pipeline
  // ────────────────────────────────────────────────────

  /**
   * Send an envelope through the full safety pipeline.
   *
   * The pipeline enforces circuit breaker, rate limiting, consent,
   * signing, auditing, and routing in strict order. Any failure
   * at any stage short-circuits the pipeline and throws an AZAError.
   */
  async send(envelope: AZAEnvelope): Promise<void> {
    const senderDid = envelope.from;

    // ── Step 1: Circuit breaker check ──
    const circuitOpen = !(await this.circuitBreaker.canSend(senderDid));
    if (circuitOpen) {
      throw new AZAError(
        AZAErrorCode.CIRCUIT_OPEN,
        `Circuit breaker is open for agent ${senderDid}`,
        {
          details: { agentDid: senderDid, envelopeId: envelope.id },
          retryable: true,
          retryAfterMs: 60_000,
        },
      );
    }

    // ── Step 2: Outbound rate limit ──
    const rateResult = await this.rateLimiter.checkOutbound(senderDid);
    if (!rateResult.allowed) {
      throw new AZAError(
        AZAErrorCode.RATE_LIMITED,
        `Outbound rate limit exceeded for agent ${senderDid}`,
        {
          details: {
            agentDid: senderDid,
            remaining: rateResult.remaining,
            resetMs: rateResult.resetMs,
          },
          retryable: true,
          retryAfterMs: rateResult.retryAfterMs,
        },
      );
    }

    // ── Step 3: Consent check ──
    if (envelope.to) {
      await this.ensureConsent(envelope);
    }

    // ── Step 4: Sign the envelope ──
    let signedEnvelope = envelope;
    if (this.signingKey && !envelope.signature) {
      const signature = await signMessage(envelope.payload, this.signingKey);
      signedEnvelope = { ...envelope, signature };
    }

    // ── Step 5 & 6: Route (the router handles audit internally) ──
    try {
      await this.router.route(signedEnvelope);

      // ── Step 7a: Record success ──
      await this.circuitBreaker.recordSuccess(senderDid);
    } catch (routeError) {
      // ── Step 7b: Record failure ──
      await this.circuitBreaker.recordFailure(senderDid);

      // Audit-log the error
      if (routeError instanceof Error) {
        await this.auditLogger.logError(
          routeError instanceof AZAError
            ? routeError
            : new AZAError(AZAErrorCode.DELIVERY_FAILED, routeError.message, {
                cause: routeError,
              }),
          {
            envelopeId: envelope.id,
            action: "pipeline.send.route_failed",
          },
        );
      }

      throw routeError;
    }
  }

  // ────────────────────────────────────────────────────
  // Receive Pipeline
  // ────────────────────────────────────────────────────

  /**
   * Process a received envelope through the inbound safety pipeline.
   *
   * The pipeline enforces rate limiting, signature presence check,
   * and auditing. The actual message handler is provided by the caller.
   */
  async receive(
    envelope: AZAEnvelope,
    handler: (envelope: AZAEnvelope) => Promise<void>,
  ): Promise<void> {
    const recipientDid = envelope.to;

    // ── Step 1: Inbound rate limit ──
    if (recipientDid) {
      const rateResult = await this.rateLimiter.checkInbound(recipientDid);
      if (!rateResult.allowed) {
        throw new AZAError(
          AZAErrorCode.RATE_LIMITED,
          `Inbound rate limit exceeded for agent ${recipientDid}`,
          {
            details: {
              agentDid: recipientDid,
              remaining: rateResult.remaining,
              resetMs: rateResult.resetMs,
            },
            retryable: true,
            retryAfterMs: rateResult.retryAfterMs,
          },
        );
      }
    }

    // ── Step 2: Signature presence check ──
    // In production, reject unsigned messages entirely.
    // In development, log a warning but still process.
    if (!envelope.signature) {
      if (process.env.NODE_ENV === "production") {
        throw new AZAError(
          AZAErrorCode.INVALID_SIGNATURE,
          `Unsigned envelope ${envelope.id} from ${envelope.from} rejected in production`,
          {
            details: {
              envelopeId: envelope.id,
              from: envelope.from,
            },
          },
        );
      }
      console.warn(
        `[MessagePipeline] Received unsigned envelope ${envelope.id} from ${envelope.from}`,
      );
    }

    // ── Step 3: Audit log ──
    await this.auditLogger.logMessage(envelope, {
      action: "pipeline.receive",
    });

    // ── Step 4: Deliver to handler ──
    await handler(envelope);
  }

  // ────────────────────────────────────────────────────
  // Private: Consent Enforcement
  // ────────────────────────────────────────────────────

  /**
   * Ensure consent is granted for the envelope's action.
   * First checks the cache; if no cached decision, determines
   * the consent tier and requests consent accordingly.
   */
  private async ensureConsent(envelope: AZAEnvelope): Promise<void> {
    const targetDid = envelope.to;
    if (!targetDid) return;

    const action = envelope.type;

    // Check cached consent
    const cached = await this.consentManager.checkConsent(envelope.from, targetDid, action);

    if (cached) {
      if (!cached.approved) {
        throw new AZAError(
          AZAErrorCode.CONSENT_DENIED,
          `Consent denied for action ${action} from ${envelope.from} to ${targetDid}`,
          {
            details: {
              action,
              requesterDid: envelope.from,
              targetDid,
              conditions: cached.conditions,
            },
          },
        );
      }
      return; // Consent is cached and approved
    }

    // No cached decision — determine tier and request consent
    const tier = this.consentManager.determineTier(action, this.extractScope(envelope));

    const consentRequest: ConsentRequest = {
      taskId: envelope.correlationId,
      requesterDid: envelope.from,
      targetDid,
      action,
      scope: this.extractScope(envelope),
      tier,
    };

    const decision = await this.consentManager.requestConsent(consentRequest);

    if (!decision.approved) {
      throw new AZAError(
        AZAErrorCode.CONSENT_DENIED,
        `Consent denied for action ${action} from ${envelope.from} to ${targetDid}`,
        {
          details: {
            action,
            requesterDid: envelope.from,
            targetDid,
            tier,
            conditions: decision.conditions,
          },
        },
      );
    }
  }

  /**
   * Extract a scope string from the envelope for consent tier determination.
   * Uses the message type prefix as a rough scope categorization.
   */
  private extractScope(envelope: AZAEnvelope): string {
    const type = envelope.type;

    if (type.startsWith("system.") || type.startsWith("status.")) {
      return "system";
    }
    if (type.startsWith("task.")) {
      return "task";
    }
    if (type.startsWith("payment.")) {
      return "payment";
    }
    if (type.startsWith("consent.")) {
      return "consent";
    }
    if (type.startsWith("team.")) {
      return "team";
    }
    if (type.startsWith("channel.")) {
      return "channel";
    }
    if (type.startsWith("negotiation.")) {
      return "negotiation";
    }
    if (type.startsWith("discovery.") || type.startsWith("capability.")) {
      return "discovery";
    }
    if (type.startsWith("artifact.")) {
      return "data_access";
    }

    return "unknown";
  }
}
