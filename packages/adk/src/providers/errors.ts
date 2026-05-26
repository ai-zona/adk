// ──────────────────────────────────────────────────────
// ADK Provider Error — Normalized error codes for all providers
// ──────────────────────────────────────────────────────

export type ADKProviderErrorCode =
  | "RATE_LIMITED"
  | "CONTEXT_LENGTH_EXCEEDED"
  | "INVALID_API_KEY"
  | "MODEL_NOT_FOUND"
  | "CONTENT_FILTERED"
  | "SERVICE_UNAVAILABLE"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INSUFFICIENT_QUOTA"
  | "UNKNOWN";

export class ADKProviderError extends Error {
  readonly code: ADKProviderErrorCode;
  readonly providerId: string;
  readonly model?: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly statusCode?: number;
  readonly raw?: unknown;

  constructor(params: {
    code: ADKProviderErrorCode;
    message: string;
    providerId: string;
    model?: string;
    retryable?: boolean;
    retryAfterMs?: number;
    statusCode?: number;
    raw?: unknown;
  }) {
    super(params.message);
    this.name = "ADKProviderError";
    this.code = params.code;
    this.providerId = params.providerId;
    this.model = params.model;
    this.retryable = params.retryable ?? false;
    this.retryAfterMs = params.retryAfterMs;
    this.statusCode = params.statusCode;
    this.raw = params.raw;
  }

  static rateLimited(providerId: string, retryAfterMs?: number, raw?: unknown): ADKProviderError {
    return new ADKProviderError({
      code: "RATE_LIMITED",
      message: `Rate limited by ${providerId}`,
      providerId,
      retryable: true,
      retryAfterMs,
      statusCode: 429,
      raw,
    });
  }

  static contextExceeded(providerId: string, model?: string, raw?: unknown): ADKProviderError {
    return new ADKProviderError({
      code: "CONTEXT_LENGTH_EXCEEDED",
      message: `Context length exceeded for ${model ?? "unknown"} on ${providerId}`,
      providerId,
      model,
      retryable: false,
      statusCode: 413,
      raw,
    });
  }

  static invalidApiKey(providerId: string, raw?: unknown): ADKProviderError {
    return new ADKProviderError({
      code: "INVALID_API_KEY",
      message: `Invalid API key for ${providerId}`,
      providerId,
      retryable: false,
      statusCode: 401,
      raw,
    });
  }

  static modelNotFound(providerId: string, model: string, raw?: unknown): ADKProviderError {
    return new ADKProviderError({
      code: "MODEL_NOT_FOUND",
      message: `Model ${model} not found on ${providerId}`,
      providerId,
      model,
      retryable: false,
      statusCode: 404,
      raw,
    });
  }

  static contentFiltered(providerId: string, raw?: unknown): ADKProviderError {
    return new ADKProviderError({
      code: "CONTENT_FILTERED",
      message: `Content was filtered by ${providerId}`,
      providerId,
      retryable: false,
      statusCode: 400,
      raw,
    });
  }

  static serviceUnavailable(providerId: string, raw?: unknown): ADKProviderError {
    return new ADKProviderError({
      code: "SERVICE_UNAVAILABLE",
      message: `${providerId} is unavailable`,
      providerId,
      retryable: true,
      statusCode: 503,
      raw,
    });
  }

  static timeout(providerId: string, raw?: unknown): ADKProviderError {
    return new ADKProviderError({
      code: "TIMEOUT",
      message: `Request to ${providerId} timed out`,
      providerId,
      retryable: true,
      raw,
    });
  }

  static networkError(providerId: string, raw?: unknown): ADKProviderError {
    return new ADKProviderError({
      code: "NETWORK_ERROR",
      message: `Network error connecting to ${providerId}`,
      providerId,
      retryable: true,
      raw,
    });
  }

  static insufficientQuota(providerId: string, raw?: unknown): ADKProviderError {
    return new ADKProviderError({
      code: "INSUFFICIENT_QUOTA",
      message: `Insufficient quota for ${providerId}`,
      providerId,
      retryable: false,
      statusCode: 402,
      raw,
    });
  }

  static unknown(providerId: string, raw?: unknown): ADKProviderError {
    const message = raw instanceof Error ? raw.message : String(raw);
    return new ADKProviderError({
      code: "UNKNOWN",
      message: `Unknown error from ${providerId}: ${message}`,
      providerId,
      retryable: false,
      raw,
    });
  }
}
