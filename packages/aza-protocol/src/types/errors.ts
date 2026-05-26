import { z } from "zod";

// ──────────────────────────────────────────────────────
// Error Code Ranges
// ──────────────────────────────────────────────────────
// AZA-1XXX: Protocol errors
// AZA-2XXX: Transport errors
// AZA-3XXX: Task errors
// AZA-4XXX: Team errors
// AZA-5XXX: Channel errors
// AZA-6XXX: Safety errors
// ──────────────────────────────────────────────────────

export const AZAErrorCode = {
  // Protocol errors (1XXX)
  INVALID_MESSAGE: "AZA-1000",
  INVALID_MESSAGE_TYPE: "AZA-1001",
  INVALID_SIGNATURE: "AZA-1002",
  INVALID_DID: "AZA-1003",
  INVALID_PAYLOAD: "AZA-1004",
  VERSION_MISMATCH: "AZA-1005",
  SCHEMA_VALIDATION_FAILED: "AZA-1006",
  INVALID_ENVELOPE: "AZA-1007",
  MISSING_CORRELATION_ID: "AZA-1008",
  DUPLICATE_MESSAGE: "AZA-1009",

  // Transport errors (2XXX)
  CONNECTION_FAILED: "AZA-2000",
  CONNECTION_TIMEOUT: "AZA-2001",
  CONNECTION_CLOSED: "AZA-2002",
  QUEUE_FULL: "AZA-2003",
  DELIVERY_FAILED: "AZA-2004",
  SERIALIZATION_ERROR: "AZA-2005",
  DESERIALIZATION_ERROR: "AZA-2006",
  TRANSPORT_UNAVAILABLE: "AZA-2007",
  MESSAGE_TOO_LARGE: "AZA-2008",
  NETWORK_ERROR: "AZA-2009",

  // Task errors (3XXX)
  TASK_NOT_FOUND: "AZA-3000",
  TASK_INVALID_STATE: "AZA-3001",
  TASK_INVALID_TRANSITION: "AZA-3002",
  TASK_EXPIRED: "AZA-3003",
  TASK_ALREADY_ASSIGNED: "AZA-3004",
  TASK_MAX_RETRIES: "AZA-3005",
  TASK_CAPABILITY_MISMATCH: "AZA-3006",
  TASK_INPUT_INVALID: "AZA-3007",
  TASK_OUTPUT_INVALID: "AZA-3008",
  TASK_TIMEOUT: "AZA-3009",
  TASK_CANCELED: "AZA-3010",
  TASK_ARTIFACT_NOT_FOUND: "AZA-3011",

  // Team errors (4XXX)
  TEAM_NOT_FOUND: "AZA-4000",
  TEAM_PERMISSION_DENIED: "AZA-4001",
  TEAM_CONSENSUS_FAILED: "AZA-4002",
  TEAM_FULL: "AZA-4003",
  TEAM_ALREADY_MEMBER: "AZA-4004",
  TEAM_NOT_MEMBER: "AZA-4005",
  TEAM_INVALID_ROLE: "AZA-4006",
  TEAM_DISSOLVED: "AZA-4007",
  TEAM_CONTEXT_NOT_FOUND: "AZA-4008",
  TEAM_COORDINATOR_REQUIRED: "AZA-4009",

  // Channel errors (5XXX)
  CHANNEL_NOT_FOUND: "AZA-5000",
  CHANNEL_NOT_SUBSCRIBED: "AZA-5001",
  CHANNEL_ALREADY_SUBSCRIBED: "AZA-5002",
  CHANNEL_ARCHIVED: "AZA-5003",
  CHANNEL_RATE_LIMITED: "AZA-5004",
  CHANNEL_FILTER_INVALID: "AZA-5005",
  CHANNEL_PUBLISH_FAILED: "AZA-5006",

  // Safety errors (6XXX)
  RATE_LIMITED: "AZA-6000",
  CIRCUIT_OPEN: "AZA-6001",
  CONSENT_DENIED: "AZA-6002",
  CONSENT_EXPIRED: "AZA-6003",
  CONSENT_REQUIRED: "AZA-6004",
  BUDGET_EXCEEDED: "AZA-6005",
  TRUST_THRESHOLD_NOT_MET: "AZA-6006",
  SAFETY_VIOLATION: "AZA-6007",
  BLACKLISTED_AGENT: "AZA-6008",
} as const;

export type AZAErrorCode = (typeof AZAErrorCode)[keyof typeof AZAErrorCode];

export const AZAErrorCodeSchema = z.enum([
  AZAErrorCode.INVALID_MESSAGE,
  AZAErrorCode.INVALID_MESSAGE_TYPE,
  AZAErrorCode.INVALID_SIGNATURE,
  AZAErrorCode.INVALID_DID,
  AZAErrorCode.INVALID_PAYLOAD,
  AZAErrorCode.VERSION_MISMATCH,
  AZAErrorCode.SCHEMA_VALIDATION_FAILED,
  AZAErrorCode.INVALID_ENVELOPE,
  AZAErrorCode.MISSING_CORRELATION_ID,
  AZAErrorCode.DUPLICATE_MESSAGE,
  AZAErrorCode.CONNECTION_FAILED,
  AZAErrorCode.CONNECTION_TIMEOUT,
  AZAErrorCode.CONNECTION_CLOSED,
  AZAErrorCode.QUEUE_FULL,
  AZAErrorCode.DELIVERY_FAILED,
  AZAErrorCode.SERIALIZATION_ERROR,
  AZAErrorCode.DESERIALIZATION_ERROR,
  AZAErrorCode.TRANSPORT_UNAVAILABLE,
  AZAErrorCode.MESSAGE_TOO_LARGE,
  AZAErrorCode.NETWORK_ERROR,
  AZAErrorCode.TASK_NOT_FOUND,
  AZAErrorCode.TASK_INVALID_STATE,
  AZAErrorCode.TASK_INVALID_TRANSITION,
  AZAErrorCode.TASK_EXPIRED,
  AZAErrorCode.TASK_ALREADY_ASSIGNED,
  AZAErrorCode.TASK_MAX_RETRIES,
  AZAErrorCode.TASK_CAPABILITY_MISMATCH,
  AZAErrorCode.TASK_INPUT_INVALID,
  AZAErrorCode.TASK_OUTPUT_INVALID,
  AZAErrorCode.TASK_TIMEOUT,
  AZAErrorCode.TASK_CANCELED,
  AZAErrorCode.TASK_ARTIFACT_NOT_FOUND,
  AZAErrorCode.TEAM_NOT_FOUND,
  AZAErrorCode.TEAM_PERMISSION_DENIED,
  AZAErrorCode.TEAM_CONSENSUS_FAILED,
  AZAErrorCode.TEAM_FULL,
  AZAErrorCode.TEAM_ALREADY_MEMBER,
  AZAErrorCode.TEAM_NOT_MEMBER,
  AZAErrorCode.TEAM_INVALID_ROLE,
  AZAErrorCode.TEAM_DISSOLVED,
  AZAErrorCode.TEAM_CONTEXT_NOT_FOUND,
  AZAErrorCode.TEAM_COORDINATOR_REQUIRED,
  AZAErrorCode.CHANNEL_NOT_FOUND,
  AZAErrorCode.CHANNEL_NOT_SUBSCRIBED,
  AZAErrorCode.CHANNEL_ALREADY_SUBSCRIBED,
  AZAErrorCode.CHANNEL_ARCHIVED,
  AZAErrorCode.CHANNEL_RATE_LIMITED,
  AZAErrorCode.CHANNEL_FILTER_INVALID,
  AZAErrorCode.CHANNEL_PUBLISH_FAILED,
  AZAErrorCode.RATE_LIMITED,
  AZAErrorCode.CIRCUIT_OPEN,
  AZAErrorCode.CONSENT_DENIED,
  AZAErrorCode.CONSENT_EXPIRED,
  AZAErrorCode.CONSENT_REQUIRED,
  AZAErrorCode.BUDGET_EXCEEDED,
  AZAErrorCode.TRUST_THRESHOLD_NOT_MET,
  AZAErrorCode.SAFETY_VIOLATION,
  AZAErrorCode.BLACKLISTED_AGENT,
]);

/**
 * Structured error details for AZA protocol errors.
 */
export const AZAErrorDetailsSchema = z.object({
  code: AZAErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  retryable: z.boolean().default(false),
  retryAfterMs: z.number().int().positive().optional(),
  source: z.string().optional(),
  timestamp: z.number(),
});

export type AZAErrorDetails = z.infer<typeof AZAErrorDetailsSchema>;

/**
 * Custom error class for AZA protocol errors.
 * Extends the standard Error class with structured error information.
 */
export class AZAError extends Error {
  public readonly code: AZAErrorCode;
  public readonly details: Record<string, unknown> | undefined;
  public readonly retryable: boolean;
  public readonly retryAfterMs: number | undefined;
  public readonly source: string | undefined;
  public readonly timestamp: number;

  constructor(
    code: AZAErrorCode,
    message: string,
    options?: {
      details?: Record<string, unknown>;
      retryable?: boolean;
      retryAfterMs?: number;
      source?: string;
      cause?: Error;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AZAError";
    this.code = code;
    this.details = options?.details;
    this.retryable = options?.retryable ?? false;
    this.retryAfterMs = options?.retryAfterMs;
    this.source = options?.source;
    this.timestamp = Date.now();

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AZAError.prototype);
  }

  /**
   * Serialize the error to a structured object suitable for protocol transmission.
   */
  toErrorDetails(): AZAErrorDetails {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
      source: this.source,
      timestamp: this.timestamp,
    };
  }

  /**
   * Create an AZAError from structured error details.
   */
  static fromErrorDetails(details: AZAErrorDetails): AZAError {
    return new AZAError(details.code as AZAErrorCode, details.message, {
      details: details.details as Record<string, unknown> | undefined,
      retryable: details.retryable,
      retryAfterMs: details.retryAfterMs,
      source: details.source,
    });
  }

  /**
   * Check whether a given error code falls within a specific category.
   */
  static isProtocolError(code: string): boolean {
    return code.startsWith("AZA-1");
  }

  static isTransportError(code: string): boolean {
    return code.startsWith("AZA-2");
  }

  static isTaskError(code: string): boolean {
    return code.startsWith("AZA-3");
  }

  static isTeamError(code: string): boolean {
    return code.startsWith("AZA-4");
  }

  static isChannelError(code: string): boolean {
    return code.startsWith("AZA-5");
  }

  static isSafetyError(code: string): boolean {
    return code.startsWith("AZA-6");
  }
}
