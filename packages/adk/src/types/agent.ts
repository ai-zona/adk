// ──────────────────────────────────────────────────────
// ADK Agent Types
// ──────────────────────────────────────────────────────

import type { z } from "zod";
import type { ToolSelectionConfig } from "../tools/tool-selector";
import type { GuardrailConfig } from "./guardrail";
import type { RoutingStrategy } from "./llm";
import type { RunContext } from "./runner";
import type { ContextStrategy } from "./session";
import type { ToolDef } from "./tool";

/** Agent consent levels (extracted from platform-agents) */
export type ConsentLevel = "auto" | "notify" | "explicit" | "multi_party";

/** Agent autonomy levels */
export type AutonomyLevel = "autonomous" | "semi_autonomous" | "composite" | "oracle";

/** Model configuration for multi-provider routing */
export interface ModelConfig {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  routingStrategy?: RoutingStrategy;
  fallbackChain?: string[];
}

/** Handoff target definition */
export interface HandoffTarget {
  agent: string | AgentConfig;
  description: string;
  filter?: (ctx: RunContext) => boolean | Promise<boolean>;
}

/** JSON Schema type for structured output */
export type JsonSchema = Record<string, unknown>;

/** Agent configuration — the core definition */
export interface AgentConfig {
  /** Unique agent name */
  name: string;

  /** System instructions — can be static or dynamic */
  instructions: string | ((ctx: RunContext) => string | Promise<string>);

  /** Model to use (string shorthand or full config) */
  model?: string | ModelConfig;

  /** Tools available to this agent */
  tools?: ToolDef[];

  /** Agents this agent can hand off to */
  handoffs?: HandoffTarget[];

  /** Structured output schema (Zod or JSON Schema) */
  outputSchema?: z.ZodSchema | JsonSchema;

  /** Guardrails to apply */
  guardrails?: GuardrailConfig[];

  /** Consent level for execution */
  consentLevel?: ConsentLevel;

  /** Maximum turns before stopping */
  maxTurns?: number;

  /** Budget limit in USD */
  budgetLimitUsd?: number;

  /** Agent description (for tool/handoff descriptions) */
  description?: string;

  /** Agent metadata */
  metadata?: Record<string, unknown>;

  /** Tool selection config (dynamic per-turn filtering) */
  toolSelection?: ToolSelectionConfig;

  /** Context management config */
  contextConfig?: ContextConfig;
}

/** Context management configuration */
export interface ContextConfig {
  /** Context trimming strategy */
  strategy?: ContextStrategy;
  /** Fraction of model's context window to use (default: 0.85) */
  contextBudgetRatio?: number;
  /** Explicit fixed token budget — overrides ratio-based calculation */
  maxContextTokens?: number;
  /** Always keep this many recent turns verbatim (default: 4) */
  keepRecentTurns?: number;
  /** Cheaper model for summarization (e.g., "claude-haiku-4-5-20251001") */
  summaryModel?: string;
  /** Token counting strategy */
  tokenCounterStrategy?: "character" | "tiktoken-approx" | "provider-reported";
}

/** Resolved agent info for handoffs and multi-agent scenarios */
export interface AgentInfo {
  name: string;
  description?: string;
  consentLevel: ConsentLevel;
}
