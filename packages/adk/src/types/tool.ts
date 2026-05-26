// ──────────────────────────────────────────────────────
// ADK Tool Types
// ──────────────────────────────────────────────────────

import type { z } from "zod";
import type { JsonSchema } from "./agent";
import type { RunContext } from "./runner";

/** Tool context passed to tool execute functions */
export interface ToolContext {
  /** Current run context */
  runContext: RunContext;
  /** ID of the tool call (from LLM) */
  toolCallId: string;
  /** Agent invoking the tool */
  agentName: string;
}

/** Pre-execute hook result */
export interface ToolPreHookResult {
  /** Whether to proceed with execution */
  allow: boolean;
  /** Modified input (if allow=true and modification needed) */
  modifiedInput?: unknown;
  /** Reason for blocking (if allow=false) */
  reason?: string;
}

/** Post-execute hook result */
export interface ToolPostHookResult {
  /** Modified output (if modification needed) */
  modifiedOutput?: unknown;
}

/** Tool hooks for pre/post execution */
export interface ToolHooks {
  preExecute?: (input: unknown, ctx: ToolContext) => Promise<ToolPreHookResult> | ToolPreHookResult;
  postExecute?: (
    input: unknown,
    output: unknown,
    ctx: ToolContext,
  ) => Promise<ToolPostHookResult> | ToolPostHookResult;
}

/** Example input for a tool (shown to LLM for better accuracy) */
export interface ToolExample {
  /** Example input values */
  input: Record<string, unknown>;
  /** Description of what this example demonstrates */
  description?: string;
}

/** Tool definition — unifies skills, MCP tools, and custom functions */
export interface ToolDef<TInput = unknown, TOutput = unknown> {
  /** Unique tool name */
  name: string;

  /** Description shown to LLM */
  description: string;

  /** Input schema (Zod for validation, JSON Schema for LLM) */
  inputSchema: z.ZodSchema<TInput> | JsonSchema;

  /** Optional output schema */
  outputSchema?: z.ZodSchema<TOutput> | JsonSchema;

  /** Execute function */
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput>;

  /** Optional pre/post execution hooks */
  hooks?: ToolHooks;

  /** Tool metadata */
  metadata?: Record<string, unknown>;

  /** If true, tool is not sent to LLM until explicitly loaded via tool_search */
  deferLoading?: boolean;

  /** Example inputs to improve LLM accuracy */
  examples?: ToolExample[];

  /** Per-tool timeout in milliseconds (default: 30000) */
  timeoutMs?: number;

  /** Number of retries on failure (default: 0) */
  retries?: number;
}

/** Tool definition config (for defineTool() builder) */
export interface ToolDefConfig<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput> | JsonSchema;
  outputSchema?: z.ZodSchema<TOutput> | JsonSchema;
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
  hooks?: ToolHooks;
  metadata?: Record<string, unknown>;
  deferLoading?: boolean;
  examples?: ToolExample[];
  timeoutMs?: number;
  retries?: number;
}
