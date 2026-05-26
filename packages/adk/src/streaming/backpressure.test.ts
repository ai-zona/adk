import { afterEach, describe, expect, it, vi } from "vitest";
import { BackpressuredStream } from "./backpressure";

describe("BackpressuredStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers pushed items via async iteration", async () => {
    const stream = new BackpressuredStream<string>();
    stream.push("a");
    stream.push("b");
    stream.end();

    const items: string[] = [];
    for await (const item of stream) {
      items.push(item);
    }
    expect(items).toEqual(["a", "b"]);
  });

  it("delivers directly when consumer is waiting", async () => {
    const stream = new BackpressuredStream<number>();

    // Start reading before pushing
    const readPromise = (async () => {
      const items: number[] = [];
      for await (const item of stream) {
        items.push(item);
        if (items.length === 2) break;
      }
      return items;
    })();

    // Small delay then push
    await new Promise((r) => setTimeout(r, 10));
    stream.push(1);
    stream.push(2);

    const items = await readPromise;
    expect(items).toEqual([1, 2]);
    stream.end();
  });

  it("drops oldest items when buffer is full (lossy backpressure)", () => {
    const stream = new BackpressuredStream<number>({ bufferLimit: 3 });
    stream.push(1);
    stream.push(2);
    stream.push(3);
    expect(stream.bufferSize).toBe(3);
    expect(stream.isFull).toBe(true);

    // Push a 4th — should drop oldest (1)
    stream.push(4);
    expect(stream.bufferSize).toBe(3);
  });

  it("reads dropped-buffer correctly", async () => {
    const stream = new BackpressuredStream<number>({ bufferLimit: 2 });
    stream.push(1);
    stream.push(2);
    stream.push(3); // drops 1
    stream.end();

    const items: number[] = [];
    for await (const item of stream) {
      items.push(item);
    }
    expect(items).toEqual([2, 3]);
  });

  it("returns false when pushing after end", () => {
    const stream = new BackpressuredStream<string>();
    stream.end();
    expect(stream.push("late")).toBe(false);
  });

  it("resolves waiting consumer on end()", async () => {
    const stream = new BackpressuredStream<string>();
    const readPromise = (async () => {
      const items: string[] = [];
      for await (const item of stream) {
        items.push(item);
      }
      return items;
    })();

    await new Promise((r) => setTimeout(r, 10));
    stream.end();

    const items = await readPromise;
    expect(items).toEqual([]);
  });

  it("exposes isDone", () => {
    const stream = new BackpressuredStream<string>();
    expect(stream.isDone).toBe(false);
    stream.end();
    expect(stream.isDone).toBe(true);
  });

  it("starts and stops keepalive timer", () => {
    vi.useFakeTimers();
    const stream = new BackpressuredStream<string>({ keepaliveIntervalMs: 100 });
    const fn = vi.fn();

    stream.startKeepalive(fn);
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(2);

    stream.stopKeepalive();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(2); // No more calls

    vi.useRealTimers();
  });

  it("stops keepalive on end()", () => {
    vi.useFakeTimers();
    const stream = new BackpressuredStream<string>({ keepaliveIntervalMs: 100 });
    const fn = vi.fn();

    stream.startKeepalive(fn);
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);

    stream.end();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1); // Stopped by end()

    vi.useRealTimers();
  });

  it("uses default bufferLimit of 100", () => {
    const stream = new BackpressuredStream<number>();
    for (let i = 0; i < 100; i++) {
      stream.push(i);
    }
    expect(stream.bufferSize).toBe(100);
    expect(stream.isFull).toBe(true);
  });
});
