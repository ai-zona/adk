// ──────────────────────────────────────────────────────
// ADK Plugin — definePlugin()
// ──────────────────────────────────────────────────────

import type { PluginDefinition, PluginLifecycle, PluginManifest } from "./types";

/** Define a plugin from config — validates manifest and freezes the definition */
export function definePlugin(config: {
  manifest: PluginManifest;
  activate: PluginLifecycle["activate"];
  deactivate?: PluginLifecycle["deactivate"];
  onConfigChanged?: PluginLifecycle["onConfigChanged"];
  onHealthCheck?: PluginLifecycle["onHealthCheck"];
}): PluginDefinition {
  if (!config.manifest.name) {
    throw new Error("Plugin manifest must have a name");
  }
  if (!config.manifest.version) {
    throw new Error("Plugin manifest must have a version");
  }
  if (!config.manifest.capabilities?.length) {
    throw new Error("Plugin must declare at least one capability");
  }

  const definition: PluginDefinition = {
    manifest: Object.freeze({ ...config.manifest }),
    lifecycle: Object.freeze({
      activate: config.activate,
      deactivate: config.deactivate,
      onConfigChanged: config.onConfigChanged,
      onHealthCheck: config.onHealthCheck,
    }),
  };

  return Object.freeze(definition);
}
