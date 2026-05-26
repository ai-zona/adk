import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ADKEventBus } from "../events/event-bus";
import { defineTool } from "../tools/define-tool";
import { definePlugin } from "./define-plugin";
import { PluginRegistry } from "./plugin-registry";
import type { PluginDefinition } from "./types";

// ── Helpers ──

function createTestPlugin(
  overrides?: Partial<{
    name: string;
    version: string;
    activate: (ctx: any) => Promise<void>;
    deactivate: () => Promise<void>;
    onHealthCheck: () => Promise<{ healthy: boolean; details?: Record<string, unknown> }>;
    onConfigChanged: (c: Record<string, unknown>) => Promise<void>;
  }>,
): PluginDefinition {
  return definePlugin({
    manifest: {
      name: overrides?.name ?? "test-plugin",
      version: overrides?.version ?? "1.0.0",
      description: "A test plugin",
      capabilities: ["tools"],
    },
    activate: overrides?.activate ?? (async () => {}),
    deactivate: overrides?.deactivate,
    onHealthCheck: overrides?.onHealthCheck,
    onConfigChanged: overrides?.onConfigChanged,
  });
}

function createTestTool(name = "my-tool") {
  return defineTool({
    name,
    description: `Tool ${name}`,
    inputSchema: z.object({ input: z.string() }),
    execute: async (input) => input.input,
  });
}

// ── Tests ──

describe("definePlugin", () => {
  it("creates a frozen plugin definition", () => {
    const plugin = definePlugin({
      manifest: {
        name: "hello",
        version: "0.1.0",
        description: "Greets",
        capabilities: ["tools"],
      },
      activate: async () => {},
    });

    expect(plugin.manifest.name).toBe("hello");
    expect(plugin.manifest.version).toBe("0.1.0");
    expect(Object.isFrozen(plugin)).toBe(true);
    expect(Object.isFrozen(plugin.manifest)).toBe(true);
    expect(Object.isFrozen(plugin.lifecycle)).toBe(true);
  });

  it("throws on empty name", () => {
    expect(() =>
      definePlugin({
        manifest: { name: "", version: "1.0.0", description: "x", capabilities: ["tools"] },
        activate: async () => {},
      }),
    ).toThrow("Plugin manifest must have a name");
  });

  it("throws on empty version", () => {
    expect(() =>
      definePlugin({
        manifest: { name: "x", version: "", description: "x", capabilities: ["tools"] },
        activate: async () => {},
      }),
    ).toThrow("Plugin manifest must have a version");
  });

  it("throws on empty capabilities", () => {
    expect(() =>
      definePlugin({
        manifest: { name: "x", version: "1.0.0", description: "x", capabilities: [] },
        activate: async () => {},
      }),
    ).toThrow("Plugin must declare at least one capability");
  });
});

describe("PluginRegistry", () => {
  let registry: PluginRegistry;
  let eventBus: ADKEventBus;

  beforeEach(() => {
    eventBus = new ADKEventBus();
    registry = new PluginRegistry({ eventBus, dataDir: "/tmp/test-plugins" });
  });

  // ── Registration ──

  it("registers a plugin and lists it", () => {
    const plugin = createTestPlugin();
    registry.register(plugin);

    const list = registry.listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      name: "test-plugin",
      version: "1.0.0",
      status: "registered",
      capabilities: ["tools"],
    });
  });

  it("rejects duplicate plugin names", () => {
    const plugin = createTestPlugin();
    registry.register(plugin);
    expect(() => registry.register(plugin)).toThrow('Plugin "test-plugin" is already registered');
  });

  it("returns plugin entry by name", () => {
    const plugin = createTestPlugin();
    registry.register(plugin);

    const entry = registry.getPlugin("test-plugin");
    expect(entry).toBeDefined();
    expect(entry?.status).toBe("registered");
  });

  it("returns undefined for unknown plugin", () => {
    expect(registry.getPlugin("unknown")).toBeUndefined();
  });

  // ── Activation ──

  it("activates a plugin and sets status to active", async () => {
    const activateFn = vi.fn(async () => {});
    const plugin = createTestPlugin({ activate: activateFn });
    registry.register(plugin);

    await registry.activate("test-plugin");

    expect(activateFn).toHaveBeenCalledOnce();
    expect(registry.getPlugin("test-plugin")?.status).toBe("active");
    expect(registry.getPlugin("test-plugin")?.activatedAt).toBeInstanceOf(Date);
  });

  it("activating already-active plugin is a no-op", async () => {
    const activateFn = vi.fn(async () => {});
    const plugin = createTestPlugin({ activate: activateFn });
    registry.register(plugin);

    await registry.activate("test-plugin");
    await registry.activate("test-plugin");

    expect(activateFn).toHaveBeenCalledOnce();
  });

  it("throws when activating non-existent plugin", async () => {
    await expect(registry.activate("ghost")).rejects.toThrow('Plugin "ghost" not found');
  });

  it("sets status to error when activation fails", async () => {
    const plugin = createTestPlugin({
      activate: async () => {
        throw new Error("init boom");
      },
    });
    registry.register(plugin);

    await expect(registry.activate("test-plugin")).rejects.toThrow("init boom");
    const entry = registry.getPlugin("test-plugin")!;
    expect(entry.status).toBe("error");
    expect(entry.error).toBe("init boom");
  });

  // ── Tools ──

  it("registers tools with namespace prefix during activation", async () => {
    const tool = createTestTool("search");
    const plugin = createTestPlugin({
      activate: async (ctx) => {
        ctx.registerTool(tool);
      },
    });
    registry.register(plugin);
    await registry.activate("test-plugin");

    const tools = registry.getRegisteredTools();
    expect(tools.size).toBe(1);
    expect(tools.has("test-plugin:search")).toBe(true);
    expect(tools.get("test-plugin:search")?.name).toBe("test-plugin:search");
  });

  it("removes tools on deactivation", async () => {
    const tool = createTestTool("search");
    const plugin = createTestPlugin({
      activate: async (ctx) => {
        ctx.registerTool(tool);
      },
    });
    registry.register(plugin);
    await registry.activate("test-plugin");
    expect(registry.getRegisteredTools().size).toBe(1);

    await registry.deactivate("test-plugin");
    expect(registry.getRegisteredTools().size).toBe(0);
  });

  // ── Guardrails ──

  it("registers guardrails during activation", async () => {
    const plugin = createTestPlugin({
      activate: async (ctx) => {
        ctx.registerGuardrail({
          name: "profanity-filter",
          type: "input",
          handler: async () => ({ passed: true }),
        });
      },
    });
    registry.register(plugin);
    await registry.activate("test-plugin");

    const guardrails = registry.getRegisteredGuardrails();
    expect(guardrails).toHaveLength(1);
    expect(guardrails[0].pluginName).toBe("test-plugin");
    expect(guardrails[0].config.name).toBe("profanity-filter");
  });

  it("removes guardrails on deactivation", async () => {
    const plugin = createTestPlugin({
      activate: async (ctx) => {
        ctx.registerGuardrail({ name: "g1", type: "output", handler: async () => ({}) });
      },
    });
    registry.register(plugin);
    await registry.activate("test-plugin");
    expect(registry.getRegisteredGuardrails()).toHaveLength(1);

    await registry.deactivate("test-plugin");
    expect(registry.getRegisteredGuardrails()).toHaveLength(0);
  });

  // ── Exporters ──

  it("registers trace exporters during activation", async () => {
    const mockExporter = { export: async () => {} };
    const plugin = createTestPlugin({
      activate: async (ctx) => {
        ctx.registerExporter(mockExporter);
      },
    });
    registry.register(plugin);
    await registry.activate("test-plugin");

    const exporters = registry.getRegisteredExporters();
    expect(exporters).toHaveLength(1);
    expect(exporters[0].pluginName).toBe("test-plugin");
  });

  it("removes exporters on deactivation", async () => {
    const plugin = createTestPlugin({
      activate: async (ctx) => {
        ctx.registerExporter({ export: async () => {} });
      },
    });
    registry.register(plugin);
    await registry.activate("test-plugin");
    expect(registry.getRegisteredExporters()).toHaveLength(1);

    await registry.deactivate("test-plugin");
    expect(registry.getRegisteredExporters()).toHaveLength(0);
  });

  // ── Deactivation ──

  it("calls deactivate lifecycle hook", async () => {
    const deactivateFn = vi.fn(async () => {});
    const plugin = createTestPlugin({ deactivate: deactivateFn });
    registry.register(plugin);
    await registry.activate("test-plugin");

    await registry.deactivate("test-plugin");

    expect(deactivateFn).toHaveBeenCalledOnce();
    expect(registry.getPlugin("test-plugin")?.status).toBe("inactive");
  });

  it("deactivating non-active plugin is a no-op", async () => {
    const plugin = createTestPlugin();
    registry.register(plugin);

    // Status is "registered", not "active" — should be a no-op
    await registry.deactivate("test-plugin");
    expect(registry.getPlugin("test-plugin")?.status).toBe("registered");
  });

  it("throws when deactivating non-existent plugin", async () => {
    await expect(registry.deactivate("ghost")).rejects.toThrow('Plugin "ghost" not found');
  });

  it("cleans up even if deactivate() throws", async () => {
    const tool = createTestTool("leaky");
    const plugin = createTestPlugin({
      activate: async (ctx) => {
        ctx.registerTool(tool);
      },
      deactivate: async () => {
        throw new Error("cleanup failed");
      },
    });
    registry.register(plugin);
    await registry.activate("test-plugin");

    // Should not throw — cleanup happens in finally
    await registry.deactivate("test-plugin");
    expect(registry.getRegisteredTools().size).toBe(0);
    expect(registry.getPlugin("test-plugin")?.status).toBe("inactive");
  });

  // ── Unregister ──

  it("unregisters an inactive plugin", async () => {
    const plugin = createTestPlugin();
    registry.register(plugin);
    await registry.activate("test-plugin");
    await registry.deactivate("test-plugin");

    registry.unregister("test-plugin");
    expect(registry.listPlugins()).toHaveLength(0);
  });

  it("throws when unregistering active plugin", async () => {
    const plugin = createTestPlugin();
    registry.register(plugin);
    await registry.activate("test-plugin");

    expect(() => registry.unregister("test-plugin")).toThrow(
      'Cannot unregister active plugin "test-plugin". Deactivate first.',
    );
  });

  it("unregistering unknown plugin is a no-op", () => {
    // Should not throw
    registry.unregister("ghost");
    expect(registry.listPlugins()).toHaveLength(0);
  });

  // ── Plugin Config ──

  it("passes config through context", async () => {
    let capturedConfig: any;
    const plugin = createTestPlugin({
      activate: async (ctx) => {
        capturedConfig = ctx.getConfig();
      },
    });
    registry.register(plugin, { apiKey: "sk-123", maxRetries: 3 });
    await registry.activate("test-plugin");

    expect(capturedConfig).toEqual({ apiKey: "sk-123", maxRetries: 3 });
  });

  it("typed config via generic", async () => {
    interface MyConfig {
      endpoint: string;
      verbose: boolean;
    }
    let capturedConfig: MyConfig | undefined;
    const plugin = createTestPlugin({
      activate: async (ctx) => {
        capturedConfig = ctx.getConfig<MyConfig>();
      },
    });
    registry.register(plugin, { endpoint: "https://api.example.com", verbose: true });
    await registry.activate("test-plugin");

    expect(capturedConfig?.endpoint).toBe("https://api.example.com");
    expect(capturedConfig?.verbose).toBe(true);
  });

  it("updateConfig notifies active plugin", async () => {
    const onConfigChanged = vi.fn(async () => {});
    const plugin = createTestPlugin({ onConfigChanged });
    registry.register(plugin, { key: "old" });
    await registry.activate("test-plugin");

    await registry.updateConfig("test-plugin", { key: "new" });

    expect(onConfigChanged).toHaveBeenCalledWith({ key: "new" });
    expect(registry.getPlugin("test-plugin")?.config).toEqual({ key: "new" });
  });

  it("updateConfig on inactive plugin just updates stored config", async () => {
    const plugin = createTestPlugin();
    registry.register(plugin, { key: "old" });

    await registry.updateConfig("test-plugin", { key: "new" });
    expect(registry.getPlugin("test-plugin")?.config).toEqual({ key: "new" });
  });

  it("updateConfig throws for unknown plugin", async () => {
    await expect(registry.updateConfig("ghost", {})).rejects.toThrow('Plugin "ghost" not found');
  });

  // ── Data Dir ──

  it("provides per-plugin data directory", async () => {
    let dataDir: string | undefined;
    const plugin = createTestPlugin({
      activate: async (ctx) => {
        dataDir = ctx.getDataDir();
      },
    });
    registry.register(plugin);
    await registry.activate("test-plugin");

    expect(dataDir).toBe("/tmp/test-plugins/test-plugin");
  });

  // ── EventBus ──

  it("provides event bus access", async () => {
    let bus: ADKEventBus | undefined;
    const plugin = createTestPlugin({
      activate: async (ctx) => {
        bus = ctx.getEventBus();
      },
    });
    registry.register(plugin);
    await registry.activate("test-plugin");

    expect(bus).toBe(eventBus);
  });

  it("throws when event bus is not configured", async () => {
    const noBusRegistry = new PluginRegistry();
    const plugin = createTestPlugin({
      activate: async (ctx) => {
        ctx.getEventBus(); // should throw
      },
    });
    noBusRegistry.register(plugin);

    await expect(noBusRegistry.activate("test-plugin")).rejects.toThrow("No EventBus available");
  });

  // ── Health Check ──

  it("delegates health check to plugin", async () => {
    const plugin = createTestPlugin({
      onHealthCheck: async () => ({
        healthy: true,
        details: { connections: 5 },
      }),
    });
    registry.register(plugin);
    await registry.activate("test-plugin");

    const result = await registry.healthCheck("test-plugin");
    expect(result.healthy).toBe(true);
    expect(result.details).toEqual({ connections: 5 });
  });

  it("returns healthy=true when plugin has no health check", async () => {
    const plugin = createTestPlugin();
    registry.register(plugin);
    await registry.activate("test-plugin");

    const result = await registry.healthCheck("test-plugin");
    expect(result.healthy).toBe(true);
  });

  it("returns unhealthy for inactive plugin", async () => {
    const plugin = createTestPlugin();
    registry.register(plugin);

    const result = await registry.healthCheck("test-plugin");
    expect(result.healthy).toBe(false);
    expect(result.details?.reason).toBe("Plugin is not active");
  });

  it("throws health check for unknown plugin", async () => {
    await expect(registry.healthCheck("ghost")).rejects.toThrow('Plugin "ghost" not found');
  });

  // ── Logging ──

  it("context.log produces prefixed output", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = createTestPlugin({
      activate: async (ctx) => {
        ctx.log("info", "activated");
        ctx.log("warn", "deprecation", { field: "old" });
        ctx.log("error", "failed", { code: 500 });
        ctx.log("debug", "verbose");
      },
    });
    registry.register(plugin);
    await registry.activate("test-plugin");

    expect(logSpy).toHaveBeenCalledWith("[plugin:test-plugin]", "[info]", "activated", "");
    expect(warnSpy).toHaveBeenCalledWith("[plugin:test-plugin]", "deprecation", { field: "old" });
    expect(errorSpy).toHaveBeenCalledWith("[plugin:test-plugin]", "failed", { code: 500 });
    expect(logSpy).toHaveBeenCalledWith("[plugin:test-plugin]", "[debug]", "verbose", "");

    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  // ── Multiple Plugins ──

  it("manages multiple plugins independently", async () => {
    const pluginA = createTestPlugin({
      name: "plugin-a",
      activate: async (ctx) => {
        ctx.registerTool(createTestTool("tool-a"));
      },
    });
    const pluginB = createTestPlugin({
      name: "plugin-b",
      activate: async (ctx) => {
        ctx.registerTool(createTestTool("tool-b"));
        ctx.registerGuardrail({ name: "guard-b", type: "input", handler: async () => ({}) });
      },
    });

    registry.register(pluginA);
    registry.register(pluginB);
    await registry.activate("plugin-a");
    await registry.activate("plugin-b");

    expect(registry.listPlugins()).toHaveLength(2);
    expect(registry.getRegisteredTools().size).toBe(2);
    expect(registry.getRegisteredTools().has("plugin-a:tool-a")).toBe(true);
    expect(registry.getRegisteredTools().has("plugin-b:tool-b")).toBe(true);
    expect(registry.getRegisteredGuardrails()).toHaveLength(1);

    // Deactivate plugin-a, plugin-b stays
    await registry.deactivate("plugin-a");
    expect(registry.getRegisteredTools().size).toBe(1);
    expect(registry.getRegisteredTools().has("plugin-b:tool-b")).toBe(true);
    expect(registry.getRegisteredGuardrails()).toHaveLength(1);
  });

  // ── Default dataDir ──

  it("uses default dataDir when not configured", async () => {
    const defaultRegistry = new PluginRegistry();
    let dataDir: string | undefined;
    const plugin = createTestPlugin({
      activate: async (ctx) => {
        dataDir = ctx.getDataDir();
      },
    });
    defaultRegistry.register(plugin);
    await defaultRegistry.activate("test-plugin");

    expect(dataDir).toBe(".aizona-plugins/test-plugin");
  });
});
