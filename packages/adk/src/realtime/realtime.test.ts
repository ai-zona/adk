import { describe, expect, it, vi } from "vitest";
import {
  AudioStreamBuffer,
  calculateVolume,
  pcm16FromArrayBuffer,
  pcm16ToArrayBuffer,
} from "./audio-stream";
import { RealtimeAgent } from "./realtime-agent";

// ── AudioStreamBuffer ──

describe("AudioStreamBuffer", () => {
  it("creates with default config", () => {
    const buffer = new AudioStreamBuffer();
    expect(buffer.sampleRate).toBe(24000);
    expect(buffer.channels).toBe(1);
    expect(buffer.isEmpty).toBe(true);
    expect(buffer.available).toBe(0);
  });

  it("creates with custom config", () => {
    const buffer = new AudioStreamBuffer({
      sampleRate: 16000,
      channels: 2,
      bufferSize: 1600,
    });
    expect(buffer.sampleRate).toBe(16000);
    expect(buffer.channels).toBe(2);
  });

  it("writes and reads samples", () => {
    const buffer = new AudioStreamBuffer({ bufferSize: 100 });
    const samples = new Int16Array([100, -200, 300, -400, 500]);

    const written = buffer.write(samples);
    expect(written).toBe(5);
    expect(buffer.available).toBe(5);

    const read = buffer.read(3);
    expect(read.length).toBe(3);
    expect(read[0]).toBe(100);
    expect(read[1]).toBe(-200);
    expect(read[2]).toBe(300);
    expect(buffer.available).toBe(2);
  });

  it("respects buffer capacity", () => {
    const buffer = new AudioStreamBuffer({ bufferSize: 3 });
    const samples = new Int16Array([1, 2, 3, 4, 5]);

    const written = buffer.write(samples);
    expect(written).toBe(3);
    expect(buffer.isFull).toBe(true);
  });

  it("calculates duration", () => {
    const buffer = new AudioStreamBuffer({ sampleRate: 24000, bufferSize: 48000 });
    buffer.write(new Int16Array(12000)); // 12000 samples at 24kHz = 500ms
    expect(buffer.durationMs).toBe(500);
  });

  it("clears buffer", () => {
    const buffer = new AudioStreamBuffer({ bufferSize: 100 });
    buffer.write(new Int16Array([1, 2, 3]));
    buffer.clear();
    expect(buffer.isEmpty).toBe(true);
    expect(buffer.available).toBe(0);
  });

  it("reads empty buffer returns empty array", () => {
    const buffer = new AudioStreamBuffer();
    const read = buffer.read(10);
    expect(read.length).toBe(0);
  });
});

// ── pcm16 utilities ──

describe("PCM16 utilities", () => {
  it("converts ArrayBuffer to Int16Array and back", () => {
    const original = new Int16Array([100, -200, 300]);
    const arrayBuffer = pcm16ToArrayBuffer(original);
    const restored = pcm16FromArrayBuffer(arrayBuffer);

    expect(restored.length).toBe(3);
    expect(restored[0]).toBe(100);
    expect(restored[1]).toBe(-200);
    expect(restored[2]).toBe(300);
  });
});

describe("calculateVolume", () => {
  it("returns 0 for silence", () => {
    const silence = new Int16Array(100); // all zeros
    expect(calculateVolume(silence)).toBe(0);
  });

  it("returns > 0 for non-silent audio", () => {
    const loud = new Int16Array(100).fill(16384); // half max volume
    const volume = calculateVolume(loud);
    expect(volume).toBeGreaterThan(0);
    expect(volume).toBeLessThanOrEqual(1);
  });

  it("returns higher value for louder audio", () => {
    const quiet = new Int16Array(100).fill(1000);
    const loud = new Int16Array(100).fill(20000);
    expect(calculateVolume(loud)).toBeGreaterThan(calculateVolume(quiet));
  });

  it("handles empty array", () => {
    expect(calculateVolume(new Int16Array(0))).toBe(0);
  });
});

// ── RealtimeAgent ──

describe("RealtimeAgent", () => {
  it("creates with config", () => {
    const agent = new RealtimeAgent({
      name: "voice-bot",
      instructions: "You are a voice assistant",
      voice: "nova",
      audioFormat: "pcm16",
      realtimeProvider: "openai",
    });

    expect(agent.config.name).toBe("voice-bot");
    expect(agent.config.voice).toBe("nova");
    expect(agent.getState()).toBe("disconnected");
  });

  it("registers event handlers", () => {
    const agent = new RealtimeAgent({
      name: "voice-bot",
      instructions: "Test",
    });

    const audioHandler = vi.fn();
    const textHandler = vi.fn();
    const toolHandler = vi.fn();
    const eventHandler = vi.fn();

    const unsub1 = agent.onAudio(audioHandler);
    const unsub2 = agent.onText(textHandler);
    const unsub3 = agent.onToolCall(toolHandler);
    const unsub4 = agent.onEvent(eventHandler);

    // Unsubscribe
    unsub1();
    unsub2();
    unsub3();
    unsub4();
  });

  it("throws when sending audio while disconnected", () => {
    const agent = new RealtimeAgent({
      name: "voice-bot",
      instructions: "Test",
    });

    expect(() => agent.sendAudio(new ArrayBuffer(0))).toThrow("Not connected");
  });

  it("throws when sending text while disconnected", () => {
    const agent = new RealtimeAgent({
      name: "voice-bot",
      instructions: "Test",
    });

    expect(() => agent.sendText("hello")).toThrow("Not connected");
  });
});
