import { beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryReadTool,
  createMemorySearchTool,
  createMemoryWriteTool,
} from "../tools/built-in/memory-tools";
import { AgenticMemory, InMemoryBackend } from "./agentic-memory";

const stubCtx = { runContext: {} as any, toolCallId: "tc1", agentName: "test" };

describe("AgenticMemory", () => {
  let memory: AgenticMemory;

  beforeEach(() => {
    memory = new AgenticMemory();
  });

  it("stores and retrieves values", async () => {
    await memory.set("key1", "value1");
    expect(await memory.get("key1")).toBe("value1");
  });

  it("returns undefined for missing keys", async () => {
    expect(await memory.get("nonexistent")).toBeUndefined();
  });

  it("deletes values", async () => {
    await memory.set("key1", "value1");
    const deleted = await memory.delete("key1");
    expect(deleted).toBe(true);
    expect(await memory.get("key1")).toBeUndefined();
  });

  it("searches by prefix", async () => {
    await memory.set("user:name", "Alice");
    await memory.set("user:age", "30");
    await memory.set("config:theme", "dark");
    const results = await memory.search("user:");
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.key).sort()).toEqual(["user:age", "user:name"]);
  });

  it("lists all keys", async () => {
    await memory.set("a", "1");
    await memory.set("b", "2");
    const keys = await memory.list();
    expect(keys.sort()).toEqual(["a", "b"]);
  });

  it("persists across calls with same instance", async () => {
    await memory.set("persistent", "yes");
    // Simulate "another run" using same memory instance
    const value = await memory.get("persistent");
    expect(value).toBe("yes");
  });
});

describe("InMemoryBackend", () => {
  it("implements all required operations", async () => {
    const backend = new InMemoryBackend();
    await backend.set("k", "v");
    expect(await backend.get("k")).toBe("v");
    expect(await backend.list()).toEqual(["k"]);
    expect(await backend.list("k")).toEqual(["k"]);
    expect(await backend.list("x")).toEqual([]);
    await backend.delete("k");
    expect(await backend.get("k")).toBeUndefined();
  });
});

describe("Memory Tools", () => {
  let memory: AgenticMemory;

  beforeEach(() => {
    memory = new AgenticMemory();
  });

  it("memory_write stores a value", async () => {
    const tool = createMemoryWriteTool(memory);
    const result = await tool.execute({ key: "test", value: "hello" }, stubCtx);
    expect((result as any).written).toBe(true);
    expect(await memory.get("test")).toBe("hello");
  });

  it("memory_read retrieves a value", async () => {
    await memory.set("test", "hello");
    const tool = createMemoryReadTool(memory);
    const result = await tool.execute({ key: "test" }, stubCtx);
    expect((result as any).value).toBe("hello");
    expect((result as any).found).toBe(true);
  });

  it("memory_read returns null for missing key", async () => {
    const tool = createMemoryReadTool(memory);
    const result = await tool.execute({ key: "missing" }, stubCtx);
    expect((result as any).value).toBeNull();
    expect((result as any).found).toBe(false);
  });

  it("memory_search finds by prefix", async () => {
    await memory.set("project:name", "AIZona");
    await memory.set("project:version", "2.0");
    await memory.set("other:key", "val");
    const tool = createMemorySearchTool(memory);
    const result = await tool.execute({ prefix: "project:" }, stubCtx);
    expect((result as any).count).toBe(2);
  });
});
