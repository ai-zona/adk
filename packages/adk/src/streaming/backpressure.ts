// ──────────────────────────────────────────────────────
// Stream Backpressure — bounded buffer with lossy drop
// ──────────────────────────────────────────────────────
// Provides an async-iterable stream with configurable buffer limits.
// When the buffer is full, the oldest item is dropped (lossy backpressure).
// Includes optional SSE keepalive support for long-lived connections.
// ──────────────────────────────────────────────────────

export interface BackpressureOptions {
  /** Max items in buffer before dropping oldest (default: 100) */
  bufferLimit?: number;
  /** SSE keepalive interval in ms (default: 15000) */
  keepaliveIntervalMs?: number;
}

export class BackpressuredStream<T> {
  private buffer: T[] = [];
  private resolve: ((value: IteratorResult<T>) => void) | null = null;
  private done = false;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private readonly bufferLimit: number;

  constructor(private options: BackpressureOptions = {}) {
    this.bufferLimit = options.bufferLimit ?? 100;
  }

  /**
   * Push an item into the stream.
   * If a consumer is waiting, delivers directly.
   * If buffer is full, drops the oldest item (lossy backpressure).
   * Returns false if stream is already ended.
   */
  push(item: T): boolean {
    if (this.done) return false;
    if (this.resolve) {
      // Consumer is waiting — deliver directly
      const r = this.resolve;
      this.resolve = null;
      r({ value: item, done: false });
      return true;
    }
    if (this.buffer.length >= this.bufferLimit) {
      // Buffer full — drop oldest (lossy backpressure)
      this.buffer.shift();
    }
    this.buffer.push(item);
    return true;
  }

  /** Signal end-of-stream. Resolves any waiting consumer. */
  end(): void {
    this.done = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: undefined as unknown as T, done: true });
    }
    this.stopKeepalive();
  }

  /** Start an interval that calls onKeepalive periodically (for SSE `:keepalive` comments). */
  startKeepalive(onKeepalive: () => void): void {
    const interval = this.options.keepaliveIntervalMs ?? 15000;
    this.keepaliveTimer = setInterval(onKeepalive, interval);
  }

  /** Stop the keepalive timer. */
  stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  /** Current number of buffered items. */
  get bufferSize(): number {
    return this.buffer.length;
  }

  /** True when buffer has reached its limit. */
  get isFull(): boolean {
    return this.buffer.length >= this.bufferLimit;
  }

  /** Whether the stream has been ended. */
  get isDone(): boolean {
    return this.done;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift() as T, done: false });
        }
        if (this.done) {
          return Promise.resolve({
            value: undefined as unknown as T,
            done: true,
          });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolve = resolve;
        });
      },
    };
  }
}
