// ──────────────────────────────────────────────────────
// ADK Plugin Types
// ──────────────────────────────────────────────────────

import type { ADKEventBus } from "../events/event-bus";
import type { ToolDef } from "../types/tool";

/** Capabilities a plugin can provide */
export type PluginCapability =
  | "tools"
  | "guardrails"
  | "providers"
  | "session-backends"
  | "exporters"
  | "transforms"
  | "commands"
  | "ui-panels"
  | "ui-widgets"
  | "ui-themes";

/** UI extension slot declaration */
export interface UIExtensionSlot {
  /** Slot identifier: "dashboard.sidebar", "agent.detail.tab", "settings.panel", "marketplace.card" */
  slot: string;
  /** Display label */
  label: string;
  /** Relative path to the component within the plugin package */
  component: string;
  /** Optional icon name */
  icon?: string;
}

/** Plugin manifest — immutable metadata about the plugin */
export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  capabilities: PluginCapability[];
  uiExtensions?: UIExtensionSlot[];
  /** JSON Schema describing the plugin's configuration shape */
  configSchema?: Record<string, unknown>;
}

/** Context provided to a plugin during activation */
export interface PluginContext {
  /** Register a tool that agents can use */
  registerTool(tool: ToolDef<unknown, unknown>): void;

  /** Register a guardrail */
  registerGuardrail(config: {
    name: string;
    type: "input" | "output" | "tool";
    handler: (...args: unknown[]) => Promise<unknown>;
  }): void;

  /** Register a trace exporter */
  registerExporter(exporter: { export(trace: unknown): Promise<void> }): void;

  /** Access the event bus for pub/sub */
  getEventBus(): ADKEventBus;

  /** Get plugin configuration (type-safe with generic) */
  getConfig<T = Record<string, unknown>>(): T;

  /** Get plugin data directory path (for persistent storage) */
  getDataDir(): string;

  /** Log a message scoped to this plugin */
  log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>,
  ): void;
}

/** Lifecycle hooks for a plugin */
export interface PluginLifecycle {
  /** Called when plugin is activated. Register tools, guardrails, etc. */
  activate(ctx: PluginContext): Promise<void>;

  /** Called when plugin is deactivated. Cleanup resources. */
  deactivate?(): Promise<void>;

  /** Called when plugin config changes at runtime */
  onConfigChanged?(newConfig: Record<string, unknown>): Promise<void>;

  /** Health check — returns whether the plugin is functioning correctly */
  onHealthCheck?(): Promise<{ healthy: boolean; details?: Record<string, unknown> }>;
}

/** Complete plugin definition (manifest + lifecycle) */
export interface PluginDefinition {
  manifest: PluginManifest;
  lifecycle: PluginLifecycle;
}
