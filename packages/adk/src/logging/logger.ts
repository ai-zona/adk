// ──────────────────────────────────────────────────────
// ADK Structured Logger
// ──────────────────────────────────────────────────────
// Zero-dependency JSON logger with pluggable transports.
// JSON in production (NODE_ENV=production), pretty in dev.
// ──────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

/** Structured fields attached to log records. */
export interface LogContext {
  runId?: string;
  agentName?: string;
  turnNumber?: number;
  provider?: string;
  model?: string;
  duration?: number;
  sessionId?: string;
  traceId?: string;
  [key: string]: unknown;
}

/** A single log record passed to a transport. */
export interface LogRecord {
  level: LogLevel;
  message: string;
  timestamp: string;
  context: LogContext;
  error?: { name: string; message: string; stack?: string };
}

/** Pluggable sink for log records. */
export interface LogTransport {
  log(record: LogRecord): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  transport?: LogTransport;
  context?: LogContext;
  /** Override pretty/json detection (default: pretty when NODE_ENV !== "production") */
  pretty?: boolean;
}

/** stdout transport that picks JSON or pretty format based on env. */
export class ConsoleTransport implements LogTransport {
  constructor(private readonly pretty: boolean) {}

  log(record: LogRecord): void {
    if (this.pretty) {
      const ctx = Object.keys(record.context).length
        ? ` ${JSON.stringify(record.context)}`
        : "";
      const err = record.error ? ` ${record.error.name}: ${record.error.message}` : "";
      // biome-ignore lint/suspicious/noConsole: this transport's job is to write to stdout/stderr
      const out = record.level === "error" || record.level === "fatal" ? console.error : console.log;
      out(`[${record.timestamp}] ${record.level.toUpperCase()} ${record.message}${ctx}${err}`);
    } else {
      // biome-ignore lint/suspicious/noConsole: structured JSON to stdout is intentional
      console.log(JSON.stringify(record));
    }
  }
}

/** In-memory transport — useful for testing and audit buffering. */
export class MemoryTransport implements LogTransport {
  public readonly records: LogRecord[] = [];
  log(record: LogRecord): void {
    this.records.push(record);
  }
  clear(): void {
    this.records.length = 0;
  }
}

export class Logger {
  private readonly level: LogLevel;
  private readonly transport: LogTransport;
  private readonly baseContext: LogContext;

  constructor(opts: LoggerOptions = {}) {
    this.level = opts.level ?? ((process.env.LOG_LEVEL as LogLevel | undefined) ?? "info");
    const pretty = opts.pretty ?? process.env.NODE_ENV !== "production";
    this.transport = opts.transport ?? new ConsoleTransport(pretty);
    this.baseContext = opts.context ?? {};
  }

  /** Return a new logger that always includes these context fields. */
  child(context: LogContext): Logger {
    return new Logger({
      level: this.level,
      transport: this.transport,
      context: { ...this.baseContext, ...context },
    });
  }

  debug(message: string, context?: LogContext): void {
    this.write("debug", message, context);
  }
  info(message: string, context?: LogContext): void {
    this.write("info", message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.write("warn", message, context);
  }
  error(message: string, errorOrContext?: unknown, context?: LogContext): void {
    this.write("error", message, context, errorOrContext);
  }
  fatal(message: string, errorOrContext?: unknown, context?: LogContext): void {
    this.write("fatal", message, context, errorOrContext);
  }

  private write(
    level: LogLevel,
    message: string,
    context?: LogContext,
    errorLike?: unknown,
  ): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;

    const record: LogRecord = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: { ...this.baseContext, ...(context ?? {}) },
    };

    if (errorLike instanceof Error) {
      record.error = {
        name: errorLike.name,
        message: errorLike.message,
        stack: errorLike.stack,
      };
    } else if (errorLike !== undefined) {
      // Caller passed a context object instead of an Error
      record.context = { ...record.context, ...(errorLike as LogContext) };
    }

    this.transport.log(record);
  }
}

/** Process-wide default logger. Lazily initialized so env vars are respected. */
let defaultLogger: Logger | undefined;
export function getDefaultLogger(): Logger {
  if (!defaultLogger) defaultLogger = new Logger();
  return defaultLogger;
}
export function setDefaultLogger(logger: Logger): void {
  defaultLogger = logger;
}
