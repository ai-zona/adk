// ──────────────────────────────────────────────────────
// ADK Structured Output
// ──────────────────────────────────────────────────────
// Converts Zod schemas to JSON Schema and generates
// provider-specific formats for structured output.
//
// - Anthropic: tool_use with forced single-tool call
// - OpenAI: response_format: { type: "json_schema" }
// - Google: response_schema
// ──────────────────────────────────────────────────────

import type { ZodSchema } from "zod";
import { z } from "zod";
import type { JsonSchema } from "../types/agent";

// Internal helper: access Zod internals via `unknown` cast
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDef = any;

/** Convert a Zod schema to JSON Schema */
export function zodToJsonSchema(schema: ZodSchema): JsonSchema {
  return convertZodType(schema._def as AnyDef);
}

function convertZodType(def: AnyDef): JsonSchema {
  const typeName: string = def.typeName;

  switch (typeName) {
    case "ZodString":
      return handleStringDef(def);
    case "ZodNumber":
      return handleNumberDef(def);
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodNull":
      return { type: "null" };
    case "ZodUndefined":
      return {};
    case "ZodLiteral":
      return { const: def.value };
    case "ZodEnum":
      return { type: "string", enum: def.values };
    case "ZodNativeEnum":
      return { type: "string", enum: Object.values(def.values) };
    case "ZodArray":
      return handleArrayDef(def);
    case "ZodObject":
      return handleObjectDef(def);
    case "ZodOptional":
      return convertZodType(def.innerType._def);
    case "ZodNullable": {
      const inner = convertZodType(def.innerType._def);
      return { anyOf: [inner, { type: "null" }] };
    }
    case "ZodUnion": {
      const options: ZodSchema[] = def.options;
      return { anyOf: options.map((opt) => convertZodType(opt._def as AnyDef)) };
    }
    case "ZodDiscriminatedUnion": {
      const opts: ZodSchema[] = def.options;
      return { anyOf: opts.map((opt) => convertZodType(opt._def as AnyDef)) };
    }
    case "ZodRecord": {
      return {
        type: "object",
        additionalProperties: convertZodType(def.valueType._def),
      };
    }
    case "ZodTuple": {
      const items: ZodSchema[] = def.items;
      return {
        type: "array",
        items: items.map((item) => convertZodType(item._def as AnyDef)),
        minItems: items.length,
        maxItems: items.length,
      };
    }
    case "ZodDefault":
      return {
        ...convertZodType(def.innerType._def),
        default: def.defaultValue(),
      };
    case "ZodEffects":
      return convertZodType(def.schema._def);
    case "ZodPipeline":
      return convertZodType(def.in._def);
    case "ZodLazy":
      return convertZodType(def.getter()._def);
    case "ZodAny":
      return {};
    default:
      return {};
  }
}

function handleStringDef(def: AnyDef): JsonSchema {
  const schema: Record<string, unknown> = { type: "string" };
  const checks: Array<{ kind: string; value?: unknown; regex?: RegExp }> | undefined = def.checks;
  if (checks) {
    for (const check of checks) {
      if (check.kind === "min") schema.minLength = check.value;
      if (check.kind === "max") schema.maxLength = check.value;
      if (check.kind === "email") schema.format = "email";
      if (check.kind === "url") schema.format = "uri";
      if (check.kind === "uuid") schema.format = "uuid";
      if (check.kind === "regex" && check.regex) schema.pattern = String(check.regex);
    }
  }
  return schema;
}

function handleNumberDef(def: AnyDef): JsonSchema {
  const checks: Array<{ kind: string; value?: number; inclusive?: boolean }> | undefined =
    def.checks;
  const isInt = checks?.some((c) => c.kind === "int");
  const schema: Record<string, unknown> = { type: isInt ? "integer" : "number" };
  if (checks) {
    for (const check of checks) {
      if (check.kind === "min") {
        if (check.inclusive === false) schema.exclusiveMinimum = check.value;
        else schema.minimum = check.value;
      }
      if (check.kind === "max") {
        if (check.inclusive === false) schema.exclusiveMaximum = check.value;
        else schema.maximum = check.value;
      }
    }
  }
  return schema;
}

function handleArrayDef(def: AnyDef): JsonSchema {
  const schema: Record<string, unknown> = {
    type: "array",
    items: convertZodType(def.type._def),
  };
  if (def.minLength) schema.minItems = def.minLength.value;
  if (def.maxLength) schema.maxItems = def.maxLength.value;
  return schema;
}

function handleObjectDef(def: AnyDef): JsonSchema {
  const shape: Record<string, ZodSchema> = def.shape();
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = convertZodType(value._def as AnyDef);
    if (!isOptional(value)) {
      required.push(key);
    }
  }

  const schema: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}

function isOptional(schema: ZodSchema): boolean {
  const def = schema._def as AnyDef;
  if (def.typeName === "ZodOptional") return true;
  if (def.typeName === "ZodDefault") return true;
  if (def.typeName === "ZodUndefined") return true;
  return false;
}

/** Check if a value is a Zod schema */
export function isZodSchema(value: unknown): value is ZodSchema {
  return value instanceof z.ZodType;
}

/** Ensure we have a JSON Schema (convert Zod if needed) */
export function ensureJsonSchema(schema: ZodSchema | JsonSchema): JsonSchema {
  if (isZodSchema(schema)) {
    return zodToJsonSchema(schema);
  }
  return schema;
}
