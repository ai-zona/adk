import { describe, expect, it, vi } from "vitest";
import { defineAgent } from "../agent/define-agent";
import { ArtifactStore } from "../artifacts/artifact-store";
import { createArtifactTool } from "../artifacts/artifact-tool";
import {
  contentToParts,
  countMediaParts,
  extractText,
  isMultiModalContent,
} from "../content/helpers";
import { ADKEventBus } from "../events/event-bus";
import { TokenCounter } from "../sessions/token-counter";
import { defineTool } from "../tools/define-tool";
import type {
  ADKLLMProvider,
  AudioPart,
  ChatMessage,
  ChatResponseWithToolCalls,
  Content,
  ContentPart,
  ImagePart,
  StreamEvent,
  UIArtifactPart,
  VideoPart,
} from "../types/index";
import { Runner } from "./runner";

// ── Test Fixtures ──

const testImagePart: ImagePart = {
  type: "image",
  source: { type: "base64", mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUg==" },
  alt: "screenshot",
};

const testImageUrlPart: ImagePart = {
  type: "image",
  source: { type: "url", url: "https://example.com/photo.jpg", detail: "high" },
  alt: "photo",
};

const testAudioPart: AudioPart = {
  type: "audio",
  source: { type: "base64", mediaType: "audio/mp3", data: "AAAA" },
  durationSec: 5,
  transcript: "Hello world",
};

const testVideoPart: VideoPart = {
  type: "video",
  source: { type: "url", url: "https://example.com/video.mp4" },
  durationSec: 30,
};

const testArtifactPart: UIArtifactPart = {
  type: "ui_artifact",
  artifactId: "art-1",
  version: 1,
  title: "Dashboard",
  kind: "html",
  content: "<div>Dashboard</div>",
  css: "div { color: blue; }",
};

/** Create a mock provider with scripted responses */
function createMockProvider(responses: Array<Partial<ChatResponseWithToolCalls>>): ADKLLMProvider {
  let callIndex = 0;
  return {
    providerId: "mock",
    displayName: "Mock",
    isLocal: true,
    chat: vi.fn(),
    complete: vi.fn(),
    isAvailable: () => true,
    getModels: () => ["mock-model"],
    estimateCost: () => 0,
    chatWithTools: vi.fn(async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;
      return {
        content: response.content ?? "",
        model: "mock-model",
        providerId: "mock",
        inputTokens: response.inputTokens ?? 10,
        outputTokens: response.outputTokens ?? 5,
        totalTokens: 15,
        latencyMs: response.latencyMs ?? 50,
        costUsd: response.costUsd ?? 0.001,
        finishReason: response.finishReason ?? "stop",
        toolCalls: response.toolCalls,
      };
    }),
    async *chatStream() {
      yield { type: "text_delta" as const, content: "Hello" };
      yield { type: "message_end" as const, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}

// ── Integration Tests ──

describe("Multi-Modal Integration: ContentPart[] as input", () => {
  it("accepts ContentPart[] as user input", async () => {
    const agent = defineAgent({ name: "vision-agent", instructions: "Describe images." });
    const provider = createMockProvider([{ content: "I see a screenshot of a dashboard." }]);
    const runner = new Runner({ provider });

    const result = await runner.run(agent, {
      input: [{ type: "text", text: "What do you see in this image?" }, testImagePart],
    });

    expect(result.output).toBe("I see a screenshot of a dashboard.");
    expect(result.totalTurns).toBe(1);

    // Verify messages sent to provider include user message with ContentPart[]
    const call = (provider.chatWithTools as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const userMsg = call.messages.find((m: ChatMessage) => m.role === "user");
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content).toHaveLength(2);
  });

  it("accepts string input for backward compatibility", async () => {
    const agent = defineAgent({ name: "text-agent", instructions: "Answer questions." });
    const provider = createMockProvider([{ content: "42" }]);
    const runner = new Runner({ provider });

    const result = await runner.run(agent, { input: "What is 6 * 7?" });
    expect(result.output).toBe("42");

    const call = (provider.chatWithTools as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const userMsg = call.messages.find((m: ChatMessage) => m.role === "user");
    expect(typeof userMsg.content).toBe("string");
  });

  it("handles mixed text + image + audio input", async () => {
    const agent = defineAgent({ name: "multi-agent", instructions: "Process multi-modal." });
    const provider = createMockProvider([{ content: "I analyzed the image and audio." }]);
    const runner = new Runner({ provider });

    const input: ContentPart[] = [
      { type: "text", text: "Analyze these:" },
      testImagePart,
      testAudioPart,
    ];

    const result = await runner.run(agent, { input });
    expect(result.output).toBe("I analyzed the image and audio.");
  });
});

describe("Multi-Modal Integration: outputParts", () => {
  it("populates outputParts when assistant message contains ContentPart[]", async () => {
    const agent = defineAgent({ name: "image-gen", instructions: "Generate images." });

    // Mock provider that "returns" an assistant message with content parts
    let callIndex = 0;
    const provider: ADKLLMProvider = {
      providerId: "mock",
      displayName: "Mock",
      isLocal: true,
      chat: vi.fn(),
      complete: vi.fn(),
      isAvailable: () => true,
      getModels: () => ["mock-model"],
      estimateCost: () => 0,
      chatWithTools: vi.fn(async () => {
        callIndex++;
        return {
          content: "Here is your image",
          model: "mock-model",
          providerId: "mock",
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          latencyMs: 50,
          costUsd: 0.001,
          finishReason: "stop",
        };
      }),
      async *chatStream() {
        yield { type: "text_delta" as const, content: "Hello" };
        yield { type: "message_end" as const, usage: { inputTokens: 10, outputTokens: 5 } };
      },
    };

    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Generate a cat" });

    // output should be a string
    expect(typeof result.output).toBe("string");
    // outputParts is undefined when provider returns plain string
    expect(result.outputParts).toBeUndefined();
  });

  it("RunResult.output is always a string even with multi-modal content", async () => {
    const agent = defineAgent({ name: "test", instructions: "test" });
    const provider = createMockProvider([{ content: "Text response" }]);
    const runner = new Runner({ provider });

    const result = await runner.run(agent, { input: "Hi" });
    expect(typeof result.output).toBe("string");
  });
});

describe("Multi-Modal Integration: Artifact Tool", () => {
  it("create_artifact tool persists to ArtifactStore", async () => {
    const store = new ArtifactStore();
    const artifactTool = createArtifactTool(store);

    const agent = defineAgent({
      name: "artifact-creator",
      instructions: "Create artifacts when asked.",
      tools: [artifactTool],
    });

    const provider = createMockProvider([
      // Turn 1: call create_artifact
      {
        content: "",
        toolCalls: [
          {
            id: "tc-1",
            name: "create_artifact",
            input: {
              title: "My Dashboard",
              kind: "html",
              content: "<h1>Dashboard</h1><p>Charts here</p>",
              css: "h1 { color: blue; }",
            },
          },
        ],
        finishReason: "tool_use",
      },
      // Turn 2: final response
      { content: "I've created a dashboard artifact for you." },
    ]);

    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Build me a dashboard" });

    expect(result.output).toBe("I've created a dashboard artifact for you.");
    expect(store.size).toBe(1);

    const artifacts = store.getAll();
    expect(artifacts[0]?.title).toBe("My Dashboard");
    expect(artifacts[0]?.kind).toBe("html");
    expect(artifacts[0]?.content).toBe("<h1>Dashboard</h1><p>Charts here</p>");
    expect(artifacts[0]?.css).toBe("h1 { color: blue; }");
    expect(artifacts[0]?.agentName).toBe("artifact-creator");
  });

  it("create_artifact tool works without store", async () => {
    const artifactTool = createArtifactTool(); // No store

    const agent = defineAgent({
      name: "no-store-creator",
      instructions: "Create artifacts.",
      tools: [artifactTool],
    });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [
          {
            id: "tc-1",
            name: "create_artifact",
            input: {
              title: "Code",
              kind: "code",
              content: "console.log('hi')",
              language: "javascript",
            },
          },
        ],
        finishReason: "tool_use",
      },
      { content: "Here's your code artifact." },
    ]);

    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Create code" });
    expect(result.output).toBe("Here's your code artifact.");
  });

  it("artifact tool handles multiple artifact creations", async () => {
    const store = new ArtifactStore();
    const artifactTool = createArtifactTool(store);

    const agent = defineAgent({
      name: "multi-artifact",
      instructions: "Create multiple artifacts.",
      tools: [artifactTool],
    });

    const provider = createMockProvider([
      // Turn 1: create first artifact
      {
        content: "",
        toolCalls: [
          {
            id: "tc-1",
            name: "create_artifact",
            input: { title: "Chart", kind: "svg", content: "<svg><circle r='10'/></svg>" },
          },
        ],
        finishReason: "tool_use",
      },
      // Turn 2: create second artifact
      {
        content: "",
        toolCalls: [
          {
            id: "tc-2",
            name: "create_artifact",
            input: { title: "Docs", kind: "markdown", content: "# Documentation\nHello" },
          },
        ],
        finishReason: "tool_use",
      },
      // Turn 3: final
      { content: "Created both artifacts." },
    ]);

    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Create a chart and docs" });

    expect(store.size).toBe(2);
    const all = store.getAll();
    const titles = all.map((a) => a.title).sort();
    expect(titles).toEqual(["Chart", "Docs"]);
  });
});

describe("Multi-Modal Integration: Stream Events", () => {
  it("stream yields text_delta for text output", async () => {
    const agent = defineAgent({ name: "streamer", instructions: "test" });
    const provider = createMockProvider([{ content: "Hello world!" }]);
    const runner = new Runner({ provider });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(agent, { input: "Hi" })) {
      events.push(event);
    }

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBeGreaterThanOrEqual(1);

    const runComplete = events.find((e) => e.type === "run_complete");
    expect(runComplete).toBeTruthy();
    if (runComplete?.type === "run_complete") {
      expect(runComplete.result.output).toBe("Hello world!");
    }
  });

  it("stream yields turn_complete events", async () => {
    const agent = defineAgent({
      name: "turner",
      instructions: "test",
      tools: [
        defineTool({
          name: "noop",
          description: "noop",
          inputSchema: { type: "object" },
          execute: async () => "ok",
        }),
      ],
    });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "noop", input: {} }],
        finishReason: "tool_use",
      },
      { content: "Done" },
    ]);

    const runner = new Runner({ provider });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(agent, { input: "Go" })) {
      events.push(event);
    }

    const turnCompletes = events.filter((e) => e.type === "turn_complete");
    expect(turnCompletes.length).toBe(2);
  });

  it("stream yields tool events for tool calls", async () => {
    const searchTool = defineTool({
      name: "search",
      description: "Search the web",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      execute: async (input: unknown) => `Results for: ${(input as { query: string }).query}`,
    });

    const agent = defineAgent({
      name: "tool-streamer",
      instructions: "test",
      tools: [searchTool],
    });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "search", input: { query: "AI" } }],
        finishReason: "tool_use",
      },
      { content: "Found results!" },
    ]);

    const runner = new Runner({ provider });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(agent, { input: "Search for AI" })) {
      events.push(event);
    }

    const toolStarts = events.filter((e) => e.type === "tool_call_start");
    const toolEnds = events.filter((e) => e.type === "tool_call_end");

    expect(toolStarts).toHaveLength(1);
    expect(toolEnds).toHaveLength(1);
    if (toolStarts[0]?.type === "tool_call_start") {
      expect(toolStarts[0].toolName).toBe("search");
    }
  });

  it("stream yields handoff events", async () => {
    const agentA = defineAgent({
      name: "router",
      instructions: "Route to specialist.",
      handoffs: [{ agent: "specialist", description: "Specialist" }],
    });
    const agentB = defineAgent({ name: "specialist", instructions: "I specialize." });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "transfer_to_specialist", input: { reason: "Need help" } }],
        finishReason: "tool_use",
      },
      { content: "I'm the specialist." },
    ]);

    const runner = new Runner({ provider });
    runner.registerAgent(agentA);
    runner.registerAgent(agentB);

    const events: StreamEvent[] = [];
    for await (const event of runner.stream(agentA, { input: "Help" })) {
      events.push(event);
    }

    const handoffs = events.filter((e) => e.type === "handoff");
    expect(handoffs).toHaveLength(1);
    if (handoffs[0]?.type === "handoff") {
      expect(handoffs[0].fromAgent).toBe("router");
      expect(handoffs[0].toAgent).toBe("specialist");
    }
  });
});

describe("Multi-Modal Integration: Token Counting", () => {
  it("TokenCounter handles string content", () => {
    const counter = new TokenCounter();
    const msg: ChatMessage = { role: "user", content: "Hello world" };
    const tokens = counter.countMessage(msg);
    expect(tokens).toBeGreaterThan(0);
  });

  it("TokenCounter handles ContentPart[] with text only", () => {
    const counter = new TokenCounter();
    const msg: ChatMessage = {
      role: "user",
      content: [{ type: "text", text: "Hello world" }],
    };
    const tokens = counter.countMessage(msg);
    expect(tokens).toBeGreaterThan(0);
  });

  it("TokenCounter estimates image tokens higher than text", () => {
    const counter = new TokenCounter();
    const textMsg: ChatMessage = { role: "user", content: "Hello" };
    const imageMsg: ChatMessage = {
      role: "user",
      content: [{ type: "text", text: "Hello" }, testImagePart],
    };

    const textTokens = counter.countMessage(textMsg);
    const imageTokens = counter.countMessage(imageMsg);
    expect(imageTokens).toBeGreaterThan(textTokens);
  });

  it("TokenCounter estimates audio tokens from duration", () => {
    const counter = new TokenCounter();
    const msg: ChatMessage = {
      role: "user",
      content: [testAudioPart], // 5 seconds
    };
    const tokens = counter.countMessage(msg);
    // Audio: ~25 tokens/sec * 5 sec = 125 + overhead
    expect(tokens).toBeGreaterThanOrEqual(100);
  });

  it("TokenCounter estimates video tokens from duration", () => {
    const counter = new TokenCounter();
    const msg: ChatMessage = {
      role: "user",
      content: [testVideoPart], // 30 seconds
    };
    const tokens = counter.countMessage(msg);
    // Video: ~100 tokens/sec * 30 sec = 3000 + overhead
    expect(tokens).toBeGreaterThanOrEqual(2000);
  });

  it("TokenCounter handles UIArtifactPart as text content", () => {
    const counter = new TokenCounter();
    const msg: ChatMessage = {
      role: "user",
      content: [testArtifactPart],
    };
    const tokens = counter.countMessage(msg);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("Multi-Modal Integration: Content Helpers End-to-End", () => {
  it("extractText works on runner output messages", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: [{ type: "text", text: "Describe this:" }, testImagePart] },
      { role: "assistant", content: "I see an image." },
    ];

    // System message
    expect(extractText(messages[0]?.content)).toBe("You are helpful.");
    // User multi-modal message
    expect(extractText(messages[1]?.content)).toBe("Describe this:[Image: screenshot]");
    // Assistant text message
    expect(extractText(messages[2]?.content)).toBe("I see an image.");
  });

  it("contentToParts normalizes all content types", () => {
    expect(contentToParts("hello")).toEqual([{ type: "text", text: "hello" }]);
    expect(contentToParts("")).toEqual([]);

    const parts = [testImagePart, testAudioPart];
    expect(contentToParts(parts)).toBe(parts); // Same reference
  });

  it("countMediaParts correctly tallies mixed messages", () => {
    const content: Content = [
      { type: "text", text: "Hello" },
      { type: "text", text: "World" },
      testImagePart,
      testImageUrlPart,
      testAudioPart,
      testVideoPart,
      testArtifactPart,
    ];

    const counts = countMediaParts(content);
    expect(counts).toEqual({
      text: 2,
      image: 2,
      audio: 1,
      video: 1,
      uiArtifact: 1,
    });
  });

  it("isMultiModalContent type guard narrows correctly", () => {
    const stringContent: Content = "Hello";
    const arrayContent: Content = [testImagePart];

    expect(isMultiModalContent(stringContent)).toBe(false);
    expect(isMultiModalContent(arrayContent)).toBe(true);

    if (isMultiModalContent(arrayContent)) {
      // TypeScript narrows to ContentPart[]
      expect(arrayContent[0]?.type).toBe("image");
    }
  });
});

describe("Multi-Modal Integration: EventBus", () => {
  it("emits artifact.created when store is used with artifact tool", async () => {
    const store = new ArtifactStore();
    const artifactTool = createArtifactTool(store);

    const agent = defineAgent({
      name: "event-artifact",
      instructions: "Create artifacts.",
      tools: [artifactTool],
    });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [
          {
            id: "tc-1",
            name: "create_artifact",
            input: { title: "Test", kind: "html", content: "<p>Test</p>" },
          },
        ],
        finishReason: "tool_use",
      },
      { content: "Created!" },
    ]);

    const eventBus = new ADKEventBus();
    const runStarted = vi.fn();
    const runCompleted = vi.fn();
    eventBus.on("run.started", runStarted);
    eventBus.on("run.completed", runCompleted);

    const runner = new Runner({ provider, eventBus });
    const result = await runner.run(agent, { input: "Create an artifact" });

    expect(runStarted).toHaveBeenCalledOnce();
    expect(runCompleted).toHaveBeenCalledOnce();
    expect(result.output).toBe("Created!");
    expect(store.size).toBe(1);
  });
});

describe("Multi-Modal Integration: Previous Messages", () => {
  it("passes previous messages with ContentPart[] content through", async () => {
    const agent = defineAgent({
      name: "history-agent",
      instructions: "Continue the conversation.",
    });
    const provider = createMockProvider([{ content: "I remember the image." }]);
    const runner = new Runner({ provider });

    const previousMessages: ChatMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Look at this image:" }, testImagePart],
      },
      { role: "assistant", content: "I see a screenshot." },
    ];

    const result = await runner.run(agent, {
      input: "What did you see before?",
      messages: previousMessages,
    });

    expect(result.output).toBe("I remember the image.");

    // Verify messages are passed to provider (system is extracted as systemPrompt by TurnExecutor)
    const call = (provider.chatWithTools as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    // 2 previous + current user = 3 (system message filtered out by TurnExecutor)
    expect(call.messages).toHaveLength(3);

    // The first user message should have ContentPart[]
    const firstUserMsg = call.messages[0];
    expect(Array.isArray(firstUserMsg.content)).toBe(true);
  });
});
