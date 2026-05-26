// ──────────────────────────────────────────────────────
// ADK Plugin Registry — register, activate, deactivate plugins
// ──────────────────────────────────────────────────────

import type { ADKEventBus } from "../events/event-bus";
import type { ToolDef } from "../types/tool";
import type { PluginCapability, PluginContext, PluginDefinition } from "./types";

export type PluginStatus = "registered" | "active" | "inactive" | "error";

interface PluginEntry {
  definition: PluginDefinition;
  status: PluginStatus;
  config: Record<string, unknown>;
  registeredTools: string[];
  registeredGuardrails: string[];
  registeredExporters: number;
  error?: string;
  activatedAt?: Date;
}

export class PluginRegistry {
  private plugins = new Map<string, PluginEntry>();
  private tools = new Map<string, ToolDef<unknown, unknown>>();
  private guardrails: Array<{ pluginName: string; config: unknown }> = [];
  private exporters: Array<{ pluginName: string; exporter: unknown }> = [];
  private eventBus?: ADKEventBus;
  private dataDir: string;

  constructor(options?: { eventBus?: ADKEventBus; dataDir?: string }) {
    this.eventBus = options?.eventBus;
    this.dataDir = options?.dataDir ?? ".aizona-plugins";
  }

  /** Register a plugin definition (does not activate it) */
  register(definition: PluginDefinition, config?: Record<string, unknown>): void {
    const name = definition.manifest.name;
    if (this.plugins.has(name)) {
      throw new Error(`Plugin "${name}" is already registered`);
    }
    this.plugins.set(name, {
      definition,
      status: "registered",
      config: config ?? {},
      registeredTools: [],
      registeredGuardrails: [],
      registeredExporters: 0,
    });
  }

  /** Activate a registered plugin — calls its activate() lifecycle hook */
  async activate(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin "${name}" not found`);
    }
    if (entry.status === "active") return;

    const ctx = this.createContext(name, entry);

    try {
      await entry.definition.lifecycle.activate(ctx);
      entry.status = "active";
      entry.activatedAt = new Date();
    } catch (err) {
      entry.status = "error";
      entry.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /** Deactivate a plugin — calls deactivate() and removes all registered extensions */
  async deactivate(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin "${name}" not found`);
    }
    if (entry.status !== "active") return;

    try {
      await entry.definition.lifecycle.deactivate?.();
    } catch {
      // Best-effort — lifecycle cleanup errors should not prevent extension removal
    } finally {
      // Remove registered tools
      for (const toolName of entry.registeredTools) {
        this.tools.delete(toolName);
      }
      // Remove guardrails and exporters belonging to this plugin
      this.guardrails = this.guardrails.filter((g) => g.pluginName !== name);
      this.exporters = this.exporters.filter((e) => e.pluginName !== name);
      entry.registeredTools = [];
      entry.registeredGuardrails = [];
      entry.registeredExporters = 0;
      entry.status = "inactive";
    }
  }

  /** Unregister a plugin — must be deactivated first */
  unregister(name: string): void {
    const entry = this.plugins.get(name);
    if (!entry) return;
    if (entry.status === "active") {
      throw new Error(`Cannot unregister active plugin "${name}". Deactivate first.`);
    }
    this.plugins.delete(name);
  }

  /** Get a plugin entry by name */
  getPlugin(name: string): PluginEntry | undefined {
    return this.plugins.get(name);
  }

  /** List all registered plugins with their status */
  listPlugins(): Array<{
    name: string;
    version: string;
    status: PluginStatus;
    capabilities: PluginCapability[];
  }> {
    return Array.from(this.plugins.entries()).map(([name, entry]) => ({
      name,
      version: entry.definition.manifest.version,
      status: entry.status,
      capabilities: entry.definition.manifest.capabilities,
    }));
  }

  /** Get all tools registered by plugins (namespaced as "pluginName:toolName") */
  getRegisteredTools(): Map<string, ToolDef<unknown, unknown>> {
    return new Map(this.tools);
  }

  /** Get all guardrails registered by plugins */
  getRegisteredGuardrails(): Array<{ pluginName: string; config: unknown }> {
    return [...this.guardrails];
  }

  /** Get all trace exporters registered by plugins */
  getRegisteredExporters(): Array<{ pluginName: string; exporter: unknown }> {
    return [...this.exporters];
  }

  /** Run health check on a specific plugin */
  async healthCheck(
    name: string,
  ): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin "${name}" not found`);
    }
    if (entry.status !== "active") {
      return { healthy: false, details: { reason: "Plugin is not active" } };
    }
    if (!entry.definition.lifecycle.onHealthCheck) {
      return { healthy: true };
    }
    return entry.definition.lifecycle.onHealthCheck();
  }

  /** Update config for a plugin and notify it if active */
  async updateConfig(name: string, newConfig: Record<string, unknown>): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin "${name}" not found`);
    }
    entry.config = { ...newConfig };
    if (entry.status === "active" && entry.definition.lifecycle.onConfigChanged) {
      await entry.definition.lifecycle.onConfigChanged(newConfig);
    }
  }

  /** Create the PluginContext handed to the plugin during activation */
  private createContext(pluginName: string, entry: PluginEntry): PluginContext {
    const self = this;
    return {
      registerTool(tool: ToolDef<unknown, unknown>) {
        const namespacedName = `${pluginName}:${tool.name}`;
        const namespacedTool = { ...tool, name: namespacedName };
        self.tools.set(namespacedName, namespacedTool);
        entry.registeredTools.push(namespacedName);
      },
      registerGuardrail(config) {
        self.guardrails.push({ pluginName, config });
        entry.registeredGuardrails.push(config.name);
      },
      registerExporter(exporter) {
        self.exporters.push({ pluginName, exporter });
        entry.registeredExporters++;
      },
      getEventBus() {
        if (!self.eventBus) {
          throw new Error("No EventBus available");
        }
        return self.eventBus;
      },
      getConfig<T>() {
        return entry.config as T;
      },
      getDataDir() {
        return `${self.dataDir}/${pluginName}`;
      },
      log(level, message, data) {
        const prefix = `[plugin:${pluginName}]`;
        if (level === "error") {
          console.error(prefix, message, data);
        } else if (level === "warn") {
          console.warn(prefix, message, data);
        } else {
          console.log(prefix, `[${level}]`, message, data ?? "");
        }
      },
    };
  }
}
