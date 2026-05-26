// ──────────────────────────────────────────────────────
// ADK Schema Utilities
// ──────────────────────────────────────────────────────
// Validation utilities and provider-specific format converters
// ──────────────────────────────────────────────────────

import type { ZodSchema } from "zod";
import type { JsonSchema } from "../types/agent";
import { ensureJsonSchema, isZodSchema } from "./structured-output";

/** Validate output against a Zod schema */
export function validateOutput<T>(
  output: string,
  schema: ZodSchema<T>,
): { success: true; data: T } | { success: false; error: string } {
  try {
    const parsed = JSON.parse(output);
    const result = schema.safeParse(parsed);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return { success: false, error: result.error.message };
  } catch (e) {
    return { success: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Anthropic structured output: use tool_use with forced single-tool call */
export function toAnthropicToolSchema(
  schema: ZodSchema | JsonSchema,
  name = "structured_output",
): { name: string; description: string; input_schema: JsonSchema } {
  const jsonSchema = ensureJsonSchema(schema);
  return {
    name,
    description: "Generate structured output matching the specified schema",
    input_schema: jsonSchema,
  };
}

/** OpenAI structured output: response_format with json_schema */
export function toOpenAIResponseFormat(
  schema: ZodSchema | JsonSchema,
  name = "output",
): { type: "json_schema"; json_schema: { name: string; strict: boolean; schema: JsonSchema } } {
  const jsonSchema = ensureJsonSchema(schema);
  return {
    type: "json_schema",
    json_schema: {
      name,
      strict: true,
      schema: jsonSchema,
    },
  };
}

/** Google structured output: generation_config.response_schema */
export function toGoogleSchemaFormat(schema: ZodSchema | JsonSchema): {
  responseMimeType: string;
  responseSchema: JsonSchema;
} {
  const jsonSchema = ensureJsonSchema(schema);
  return {
    responseMimeType: "application/json",
    responseSchema: jsonSchema,
  };
}

/** Convert a schema (Zod or JSON) to LLM tool definition format */
export function schemaToToolInput(schema: ZodSchema | JsonSchema): Record<string, unknown> {
  if (isZodSchema(schema)) {
    return ensureJsonSchema(schema) as Record<string, unknown>;
  }
  return schema as Record<string, unknown>;
}
