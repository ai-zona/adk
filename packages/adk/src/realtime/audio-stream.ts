// ──────────────────────────────────────────────────────
// ADK Audio Stream — Buffer management for PCM16 audio
// ──────────────────────────────────────────────────────

/** Audio buffer configuration */
export interface AudioBufferConfig {
  /** Sample rate in Hz (default: 24000) */
  sampleRate?: number;
  /** Number of channels (default: 1, mono) */
  channels?: number;
  /** Buffer size in samples (default: 4800, 200ms at 24kHz) */
  bufferSize?: number;
}

/**
 * AudioStreamBuffer — Manages a ring buffer for PCM16 audio data.
 * Used for smoothing audio playback from realtime streams.
 */
export class AudioStreamBuffer {
  private buffer: Int16Array;
  private writePos = 0;
  private readPos = 0;
  private count = 0;
  readonly sampleRate: number;
  readonly channels: number;

  constructor(config?: AudioBufferConfig) {
    this.sampleRate = config?.sampleRate ?? 24000;
    this.channels = config?.channels ?? 1;
    const bufferSize = config?.bufferSize ?? 4800;
    this.buffer = new Int16Array(bufferSize);
  }

  /** Write PCM16 samples to the buffer */
  write(samples: Int16Array): number {
    const capacity = this.buffer.length;
    let written = 0;

    for (let i = 0; i < samples.length; i++) {
      if (this.count >= capacity) break;
      this.buffer[this.writePos] = samples[i]!;
      this.writePos = (this.writePos + 1) % capacity;
      this.count++;
      written++;
    }

    return written;
  }

  /** Read PCM16 samples from the buffer */
  read(numSamples: number): Int16Array {
    const toRead = Math.min(numSamples, this.count);
    const result = new Int16Array(toRead);

    for (let i = 0; i < toRead; i++) {
      result[i] = this.buffer[this.readPos]!;
      this.readPos = (this.readPos + 1) % this.buffer.length;
      this.count--;
    }

    return result;
  }

  /** Number of samples available to read */
  get available(): number {
    return this.count;
  }

  /** Whether the buffer is empty */
  get isEmpty(): boolean {
    return this.count === 0;
  }

  /** Whether the buffer is full */
  get isFull(): boolean {
    return this.count >= this.buffer.length;
  }

  /** Duration of buffered audio in milliseconds */
  get durationMs(): number {
    return (this.count / this.sampleRate) * 1000;
  }

  /** Clear the buffer */
  clear(): void {
    this.writePos = 0;
    this.readPos = 0;
    this.count = 0;
  }
}

/**
 * Convert an ArrayBuffer (raw bytes) to Int16Array (PCM16).
 * Assumes little-endian 16-bit signed integer format.
 */
export function pcm16FromArrayBuffer(buffer: ArrayBuffer): Int16Array {
  return new Int16Array(buffer);
}

/**
 * Convert Int16Array (PCM16) to ArrayBuffer (raw bytes).
 */
export function pcm16ToArrayBuffer(samples: Int16Array): ArrayBuffer {
  return (samples.buffer as ArrayBuffer).slice(
    samples.byteOffset,
    samples.byteOffset + samples.byteLength,
  );
}

/**
 * Calculate RMS volume level from PCM16 samples.
 * Returns a value between 0.0 (silence) and 1.0 (max volume).
 */
export function calculateVolume(samples: Int16Array): number {
  if (samples.length === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i]! / 32768;
    sumSquares += normalized * normalized;
  }

  return Math.sqrt(sumSquares / samples.length);
}
