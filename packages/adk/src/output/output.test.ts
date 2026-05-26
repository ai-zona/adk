import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ensureJsonSchema,
  isZodSchema,
  toAnthropicToolSchema,
  toGoogleSchemaFormat,
  toOpenAIResponseFormat,
  validateOutput,
  zodToJsonSchema,
} from "./index";

describe("zodToJsonSchema", () => {
  it("converts ZodString", () => {
    const schema = zodToJsonSchema(z.string());
    expect(schema).toEqual({ type: "string" });
  });

  it("converts ZodString with constraints", () => {
    const schema = zodToJsonSchema(z.string().min(1).max(100));
    expect(schema).toEqual({ type: "string", minLength: 1, maxLength: 100 });
  });

  it("converts ZodString email format", () => {
    const schema = zodToJsonSchema(z.string().email());
    expect(schema).toEqual({ type: "string", format: "email" });
  });

  it("converts ZodNumber", () => {
    const schema = zodToJsonSchema(z.number());
    expect(schema).toEqual({ type: "number" });
  });

  it("converts ZodNumber.int()", () => {
    const schema = zodToJsonSchema(z.number().int());
    expect(schema).toEqual({ type: "integer" });
  });

  it("converts ZodNumber with min/max", () => {
    const schema = zodToJsonSchema(z.number().min(0).max(100));
    expect(schema).toEqual({ type: "number", minimum: 0, maximum: 100 });
  });

  it("converts ZodBoolean", () => {
    const schema = zodToJsonSchema(z.boolean());
    expect(schema).toEqual({ type: "boolean" });
  });

  it("converts ZodNull", () => {
    const schema = zodToJsonSchema(z.null());
    expect(schema).toEqual({ type: "null" });
  });

  it("converts ZodLiteral", () => {
    const schema = zodToJsonSchema(z.literal("hello"));
    expect(schema).toEqual({ const: "hello" });
  });

  it("converts ZodEnum", () => {
    const schema = zodToJsonSchema(z.enum(["red", "green", "blue"]));
    expect(schema).toEqual({ type: "string", enum: ["red", "green", "blue"] });
  });

  it("converts ZodArray", () => {
    const schema = zodToJsonSchema(z.array(z.string()));
    expect(schema).toEqual({ type: "array", items: { type: "string" } });
  });

  it("converts ZodArray with length constraints", () => {
    const schema = zodToJsonSchema(z.array(z.number()).min(1).max(10));
    expect(schema).toEqual({ type: "array", items: { type: "number" }, minItems: 1, maxItems: 10 });
  });

  it("converts ZodObject", () => {
    const schema = zodToJsonSchema(
      z.object({
        name: z.string(),
        age: z.number(),
      }),
    );
    expect(schema).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name", "age"],
    });
  });

  it("converts ZodObject with optional fields", () => {
    const schema = zodToJsonSchema(
      z.object({
        name: z.string(),
        nickname: z.string().optional(),
      }),
    );
    expect(schema).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        nickname: { type: "string" },
      },
      required: ["name"],
    });
  });

  it("converts ZodNullable", () => {
    const schema = zodToJsonSchema(z.string().nullable());
    expect(schema).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
  });

  it("converts ZodUnion", () => {
    const schema = zodToJsonSchema(z.union([z.string(), z.number()]));
    expect(schema).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
  });

  it("converts nested objects", () => {
    const schema = zodToJsonSchema(
      z.object({
        user: z.object({
          name: z.string(),
          email: z.string().email(),
        }),
        scores: z.array(z.number()),
      }),
    );

    expect(schema).toEqual({
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
          },
          required: ["name", "email"],
        },
        scores: {
          type: "array",
          items: { type: "number" },
        },
      },
      required: ["user", "scores"],
    });
  });

  it("converts ZodDefault", () => {
    const schema = zodToJsonSchema(z.string().default("hello"));
    expect(schema).toEqual({ type: "string", default: "hello" });
  });

  it("converts ZodRecord", () => {
    const schema = zodToJsonSchema(z.record(z.number()));
    expect(schema).toEqual({
      type: "object",
      additionalProperties: { type: "number" },
    });
  });
});

describe("isZodSchema", () => {
  it("returns true for Zod schemas", () => {
    expect(isZodSchema(z.string())).toBe(true);
    expect(isZodSchema(z.object({ x: z.number() }))).toBe(true);
  });

  it("returns false for JSON Schema", () => {
    expect(isZodSchema({ type: "string" })).toBe(false);
    expect(isZodSchema(null)).toBe(false);
    expect(isZodSchema(42)).toBe(false);
  });
});

describe("ensureJsonSchema", () => {
  it("converts Zod to JSON Schema", () => {
    const result = ensureJsonSchema(z.string());
    expect(result).toEqual({ type: "string" });
  });

  it("passes JSON Schema through", () => {
    const jsonSchema = { type: "object", properties: { x: { type: "number" } } };
    const result = ensureJsonSchema(jsonSchema);
    expect(result).toBe(jsonSchema);
  });
});

describe("validateOutput", () => {
  const schema = z.object({ answer: z.string(), confidence: z.number() });

  it("validates correct JSON", () => {
    const result = validateOutput('{"answer":"yes","confidence":0.9}', schema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ answer: "yes", confidence: 0.9 });
    }
  });

  it("rejects invalid JSON", () => {
    const result = validateOutput("not json", schema);
    expect(result.success).toBe(false);
  });

  it("rejects mismatched schema", () => {
    const result = validateOutput('{"answer":42}', schema);
    expect(result.success).toBe(false);
  });
});

describe("Provider format converters", () => {
  const schema = z.object({ answer: z.string() });

  it("toAnthropicToolSchema generates tool definition", () => {
    const result = toAnthropicToolSchema(schema, "extract_answer");
    expect(result.name).toBe("extract_answer");
    expect(result.description).toContain("structured output");
    expect(result.input_schema).toEqual({
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    });
  });

  it("toAnthropicToolSchema uses default name", () => {
    const result = toAnthropicToolSchema(schema);
    expect(result.name).toBe("structured_output");
  });

  it("toOpenAIResponseFormat generates json_schema format", () => {
    const result = toOpenAIResponseFormat(schema, "my_output");
    expect(result.type).toBe("json_schema");
    expect(result.json_schema.name).toBe("my_output");
    expect(result.json_schema.strict).toBe(true);
    expect(result.json_schema.schema).toEqual({
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    });
  });

  it("toGoogleSchemaFormat generates response_schema", () => {
    const result = toGoogleSchemaFormat(schema);
    expect(result.responseMimeType).toBe("application/json");
    expect(result.responseSchema).toEqual({
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    });
  });

  it("accepts JSON Schema directly", () => {
    const jsonSchema = { type: "object", properties: { x: { type: "number" } } };
    const result = toAnthropicToolSchema(jsonSchema);
    expect(result.input_schema).toBe(jsonSchema);
  });
});
