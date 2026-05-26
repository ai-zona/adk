// ──────────────────────────────────────────────────────
// ADK Plugins — public API
// ──────────────────────────────────────────────────────

export { definePlugin } from "./define-plugin";
export { PluginRegistry } from "./plugin-registry";
export type { PluginStatus } from "./plugin-registry";
export type {
  PluginCapability,
  PluginContext,
  PluginDefinition,
  PluginLifecycle,
  PluginManifest,
  UIExtensionSlot,
} from "./types";
