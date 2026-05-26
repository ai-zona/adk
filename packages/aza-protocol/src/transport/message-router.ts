import type { AuditLogger } from "../audit/audit-logger";
import type { DIDResolver } from "../identity/did-resolver";
import { publicKeyFromHex } from "../identity/keypair";
import { isValidSignature } from "../identity/signing";
import { AZAError, AZAErrorCode } from "../types/errors";
import { AZAEnvelopeSchema } from "../types/messages";
import type { AZAEnvelope } from "../types/messages";
import { RedisStreamTransport } from "./redis-streams";

// ──────────────────────────────────────────────────────
// Message Router
// ──────────────────────────────────────────────────────
// Routes validated, signature-verified envelopes to the
// appropriate Redis streams based on addressing fields.
//
// Routing rules:
//   1. If `to` is a DID  -> agent inbox stream
//   2. If `to` is null and metadata.channel is set -> channel stream
//   3. If metadata.team is set -> also publish to team stream
//
// Security model: fail-closed. In production mode,
// unsigned messages are rejected outright.
// ──────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────
// Replay Protection
// ──────────────────────────────────────────────────────
const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const seenMessages = new Map<string, number>(); // messageId -> timestamp

// Cleanup stale entries periodically
const replayCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of seenMessages) {
    if (now - ts > REPLAY_WINDOW_MS * 2) seenMessages.delete(id);
  }
}, REPLAY_WINDOW_MS);

// Allow the process to exit without waiting for this interval
if (typeof replayCleanupInterval === "object" && "unref" in replayCleanupInterval) {
  replayCleanupInterval.unref();
}

function checkReplay(messageId: string, timestamp: number): boolean {
  const now = Date.now();
  if (Math.abs(now - timestamp) > REPLAY_WINDOW_MS) return false;
  if (seenMessages.has(messageId)) return false;
  seenMessages.set(messageId, now);
  return true;
}

export interface MessageRouterOptions {
  /**
   * When true (default), unsigned messages are rejected.
   * Set to false only in test / development environments.
   */
  requireSignature?: boolean;
  /**
   * DID resolver for looking up sender public keys.
   * Required for full signature verification.
   */
  didResolver?: DIDResolver;
}

export class MessageRouter {
  private readonly requireSignature: boolean;
  private readonly didResolver: DIDResolver | null;

  constructor(
    private transport: RedisStreamTransport,
    private auditLogger: AuditLogger,
    options?: MessageRouterOptions,
  ) {
    this.requireSignature = options?.requireSignature ?? true;
    this.didResolver = options?.didResolver ?? null;
  }

  // ────────────────────────────────────────────────────
  // Primary Routing Entry Point
  // ────────────────────────────────────────────────────

  /**
   * Validate, verify, and route an envelope to the correct stream(s).
   *
   * 1. Parse + validate the envelope schema (Zod).
   * 2. Verify signature if present; reject unsigned in production.
   * 3. Route based on addressing fields.
   * 4. Audit-log every routing decision.
   */
  async route(envelope: AZAEnvelope): Promise<void> {
    // ── Step 1: Validate envelope schema ──
    const parseResult = AZAEnvelopeSchema.safeParse(envelope);
    if (!parseResult.success) {
      const error = new AZAError(
        AZAErrorCode.INVALID_ENVELOPE,
        "Envelope failed schema validation",
        {
          details: {
            envelopeId: envelope.id,
            errors: parseResult.error.issues.map((i) => i.message),
          },
        },
      );
      await this.auditLogger.logError(error, {
        envelopeId: envelope.id,
        action: "route.validate",
      });
      throw error;
    }

    const validEnvelope = parseResult.data;

    // ── Step 2: Replay protection ──
    if (!checkReplay(validEnvelope.id, validEnvelope.timestamp)) {
      const error = new AZAError(
        AZAErrorCode.INVALID_ENVELOPE,
        "Message rejected: expired timestamp or duplicate message ID (replay detected)",
        {
          details: {
            envelopeId: validEnvelope.id,
            from: validEnvelope.from,
            timestamp: validEnvelope.timestamp,
          },
        },
      );
      await this.auditLogger.logError(error, {
        envelopeId: validEnvelope.id,
        action: "route.replay_rejected",
      });
      throw error;
    }

    // ── Step 3: Verify signature (fail-closed) ──
    if (!validEnvelope.signature) {
      if (this.requireSignature) {
        const error = new AZAError(
          AZAErrorCode.INVALID_SIGNATURE,
          "Unsigned messages are not allowed in production",
          {
            details: { envelopeId: validEnvelope.id, from: validEnvelope.from },
          },
        );
        await this.auditLogger.logError(error, {
          envelopeId: validEnvelope.id,
          action: "route.signature_missing",
        });
        throw error;
      }
      // In non-strict mode, log a warning but allow the message through
    } else {
      // Signature is present — verify it cryptographically
      await this.verifyEnvelopeSignature(validEnvelope);
    }

    // ── Step 4: Route to appropriate streams ──
    const routedTo: string[] = [];

    if (validEnvelope.to) {
      // Direct message to a specific agent
      await this.routeToAgent(validEnvelope.to, validEnvelope);
      routedTo.push(`agent:${validEnvelope.to}`);
    } else if (validEnvelope.metadata?.channel) {
      // Broadcast to a channel
      await this.routeToChannel(validEnvelope.metadata.channel, validEnvelope);
      routedTo.push(`channel:${validEnvelope.metadata.channel}`);
    }

    // If the message has a team context, also publish to the team stream
    if (validEnvelope.metadata?.team) {
      await this.routeToTeam(validEnvelope.metadata.team, validEnvelope);
      routedTo.push(`team:${validEnvelope.metadata.team}`);
    }

    // If the message has no destination at all, that's an error
    if (routedTo.length === 0) {
      const error = new AZAError(
        AZAErrorCode.DELIVERY_FAILED,
        "Envelope has no routable destination (no 'to', no channel, no team)",
        {
          details: { envelopeId: validEnvelope.id },
        },
      );
      await this.auditLogger.logError(error, {
        envelopeId: validEnvelope.id,
        action: "route.no_destination",
      });
      throw error;
    }

    // ── Step 5: Audit-log the successful routing ──
    await this.auditLogger.logMessage(validEnvelope, {
      routedTo: routedTo.join(", "),
      action: "route.success",
    });
  }

  // ────────────────────────────────────────────────────
  // Signature Verification
  // ────────────────────────────────────────────────────

  /**
   * Verify the Ed25519 signature on an envelope by resolving the sender's
   * public key from their DID document via the DIDResolver.
   *
   * If no DID resolver is configured, signature verification is skipped
   * (presence-only check was already done above).
   */
  private async verifyEnvelopeSignature(envelope: AZAEnvelope): Promise<void> {
    if (!this.didResolver) {
      // No resolver configured — cannot verify, but signature is present.
      // In strict setups, callers should provide a DIDResolver.
      return;
    }

    const senderDid = envelope.from;
    const didDocument = await this.didResolver.resolve(senderDid);

    if (!didDocument) {
      const error = new AZAError(
        AZAErrorCode.INVALID_SIGNATURE,
        `Cannot verify signature: DID document not found for ${senderDid}`,
        {
          details: { envelopeId: envelope.id, from: senderDid },
        },
      );
      await this.auditLogger.logError(error, {
        envelopeId: envelope.id,
        action: "route.signature_no_did_doc",
      });
      throw error;
    }

    const publicKey = publicKeyFromHex(didDocument.publicKey);
    const valid = await isValidSignature(envelope.signature!, publicKey);

    if (!valid) {
      const error = new AZAError(
        AZAErrorCode.INVALID_SIGNATURE,
        `Signature verification failed for envelope ${envelope.id} from ${senderDid}`,
        {
          details: { envelopeId: envelope.id, from: senderDid },
        },
      );
      await this.auditLogger.logError(error, {
        envelopeId: envelope.id,
        action: "route.signature_invalid",
      });
      throw error;
    }
  }

  // ────────────────────────────────────────────────────
  // Targeted Routing Methods
  // ────────────────────────────────────────────────────

  /**
   * Publish an envelope to a specific agent's inbox stream.
   */
  async routeToAgent(did: string, envelope: AZAEnvelope): Promise<void> {
    const streamKey = RedisStreamTransport.agentStream(did);
    await this.transport.publish(streamKey, envelope);
  }

  /**
   * Publish an envelope to a channel stream.
   */
  async routeToChannel(channelId: string, envelope: AZAEnvelope): Promise<void> {
    const streamKey = RedisStreamTransport.channelStream(channelId);
    await this.transport.publish(streamKey, envelope);
  }

  /**
   * Publish an envelope to a team stream.
   */
  async routeToTeam(teamId: string, envelope: AZAEnvelope): Promise<void> {
    const streamKey = RedisStreamTransport.teamStream(teamId);
    await this.transport.publish(streamKey, envelope);
  }
}
