import { z } from "zod";

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedInput?: Record<string, unknown>;
  /** Wall-clock duration of this single validateInput() call in ms. */
  latencyMs: number;
  /** Serialized size of the validated input in chars (post-stringify). */
  inputSize: number;
  /** Number of injection-pattern hits recorded during scanForInjections. */
  injectionHits: number;
}

// ──────────────────────────────────────────────────────
// InputValidator
// ──────────────────────────────────────────────────────

/**
 * Validates and sanitizes MCP tool invocation inputs.
 *
 * Checks for:
 * - Input size limits (1 MB max serialized)
 * - String length limits (100 k characters per value)
 * - SQL injection patterns
 * - Command injection patterns
 * - Path traversal attempts
 * - Prompt injection markers
 * - Optional JSON-Schema-style validation via Zod
 */
export class InputValidator {
  /** Maximum total serialized input size in bytes. */
  private static readonly MAX_INPUT_SIZE = 1024 * 1024; // 1 MB

  /** Maximum length for any single string value inside the input. */
  private static readonly MAX_STRING_LENGTH = 100_000;

  /**
   * Regex patterns that indicate common injection attempts.
   * Each entry is a tuple of [label, pattern].
   */
  private static readonly INJECTION_PATTERNS: Array<[string, RegExp]> = [
    // SQL injection
    [
      "SQL injection",
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER)\b.*\b(FROM|INTO|TABLE|SET)\b)/i,
    ],
    // Command injection
    ["command injection", /[;&|`$]\s*(rm|cat|wget|curl|bash|sh|nc|ncat)\b/i],
    // Path traversal
    ["path traversal", /\.\.\//],
    // Prompt injection markers
    ["prompt injection", /\b(ignore previous|disregard|system prompt|you are now)\b/i],
  ];

  // ── Public API ────────────────────────────────────

  /**
   * Validates an MCP tool invocation input object.
   *
   * @param toolName  - Name of the tool (used in error messages)
   * @param input     - The raw input record to validate
   * @param schema    - Optional JSON-Schema-like object. When provided the
   *                    validator will attempt to build a Zod schema from
   *                    known primitives and validate against it.
   * @returns A {@link ValidationResult} with validity flag, error list, and
   *          optionally the sanitized (trimmed) input.
   */
  validateInput(
    toolName: string,
    input: Record<string, unknown>,
    schema?: Record<string, unknown>,
  ): ValidationResult {
    const startNs = performance.now();
    const errors: string[] = [];

    // Capture serialized size once for telemetry. We intentionally compute
    // this regardless of size-check outcome so latency emissions carry
    // input-size context even on oversize rejections.
    let inputSize = 0;
    try {
      inputSize = JSON.stringify(input).length;
    } catch {
      // Unstringifiable input — size remains 0; checkSize() will fail next.
    }

    // 1. Check total input size
    if (!this.checkSize(input)) {
      errors.push(
        `Input for tool "${toolName}" exceeds maximum size of ${InputValidator.MAX_INPUT_SIZE} bytes`,
      );
      return {
        valid: false,
        errors,
        latencyMs: performance.now() - startNs,
        inputSize,
        injectionHits: 0,
      };
    }

    // 2. If a JSON schema is provided, validate against it
    if (schema) {
      const schemaErrors = this.validateAgainstSchema(input, schema);
      errors.push(...schemaErrors);
    }

    // 3. Recursively scan all string values for injection patterns
    const injectionErrors = this.scanForInjections(input);
    const injectionHits = injectionErrors.length;
    errors.push(...injectionErrors);

    // 4. Check max string length on all string values
    const lengthErrors = this.checkStringLengths(input);
    errors.push(...lengthErrors);

    if (errors.length > 0) {
      return {
        valid: false,
        errors,
        latencyMs: performance.now() - startNs,
        inputSize,
        injectionHits,
      };
    }

    // 5. Build sanitized copy (trimmed strings)
    const sanitizedInput = this.sanitizeObject(input) as Record<string, unknown>;

    return {
      valid: true,
      errors: [],
      sanitizedInput,
      latencyMs: performance.now() - startNs,
      inputSize,
      injectionHits,
    };
  }

  // ── Private helpers ───────────────────────────────

  /**
   * Checks whether the serialized JSON representation of the input fits
   * within {@link MAX_INPUT_SIZE}.
   */
  private checkSize(input: Record<string, unknown>): boolean {
    try {
      const serialized = JSON.stringify(input);
      return serialized.length <= InputValidator.MAX_INPUT_SIZE;
    } catch {
      // If the input cannot even be serialized, reject it.
      return false;
    }
  }

  /**
   * Scans a string value against all injection patterns and returns a list
   * of human-readable descriptions for each match.
   */
  private checkInjection(value: string): string[] {
    const detected: string[] = [];
    for (const [label, pattern] of InputValidator.INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        detected.push(label);
      }
    }
    return detected;
  }

  /**
   * Recursively walks an arbitrary value and accumulates injection-pattern
   * matches found in any string leaves.
   */
  private scanForInjections(value: unknown, path = ""): string[] {
    const errors: string[] = [];

    if (typeof value === "string") {
      const detected = this.checkInjection(value);
      for (const label of detected) {
        errors.push(`Potential ${label} detected in input${path ? ` at "${path}"` : ""}`);
      }
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        errors.push(...this.scanForInjections(value[i], `${path}[${i}]`));
      }
    } else if (value !== null && typeof value === "object") {
      for (const [key, val] of Object.entries(value)) {
        errors.push(...this.scanForInjections(val, path ? `${path}.${key}` : key));
      }
    }

    return errors;
  }

  /**
   * Recursively checks that no string value exceeds
   * {@link MAX_STRING_LENGTH}.
   */
  private checkStringLengths(value: unknown, path = ""): string[] {
    const errors: string[] = [];

    if (typeof value === "string") {
      if (value.length > InputValidator.MAX_STRING_LENGTH) {
        errors.push(
          `String value${path ? ` at "${path}"` : ""} exceeds maximum length of ${InputValidator.MAX_STRING_LENGTH}`,
        );
      }
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        errors.push(...this.checkStringLengths(value[i], `${path}[${i}]`));
      }
    } else if (value !== null && typeof value === "object") {
      for (const [key, val] of Object.entries(value)) {
        errors.push(...this.checkStringLengths(val, path ? `${path}.${key}` : key));
      }
    }

    return errors;
  }

  /**
   * Validates the input against a JSON-Schema-like descriptor.
   *
   * Supports a subset of JSON Schema: `type`, `required`, `properties`,
   * `enum`, `minimum`, `maximum`, `minLength`, `maxLength`.  For anything
   * more exotic the schema is silently accepted (we err on the side of
   * permissiveness rather than rejecting unknown schema keywords).
   */
  private validateAgainstSchema(
    input: Record<string, unknown>,
    schema: Record<string, unknown>,
  ): string[] {
    const errors: string[] = [];

    // Build a Zod shape from the JSON-Schema properties
    try {
      const zodSchema = this.jsonSchemaToZod(schema);
      const result = zodSchema.safeParse(input);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push(`Schema validation: ${issue.path.join(".")} - ${issue.message}`);
        }
      }
    } catch {
      // If we cannot convert the schema, fall through without error.
      // The schema may use features we don't support yet.
    }

    return errors;
  }

  /**
   * Converts a minimal JSON-Schema object into a Zod schema.
   * Only handles `type: "object"` with `properties` at the top level.
   */
  private jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
    const type = schema.type as string | undefined;

    if (type === "object") {
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const required = (schema.required ?? []) as string[];

      const shape: Record<string, z.ZodType> = {};

      for (const [key, propSchema] of Object.entries(properties)) {
        let fieldSchema = this.primitiveToZod(propSchema);
        if (!required.includes(key)) {
          fieldSchema = fieldSchema.optional();
        }
        shape[key] = fieldSchema;
      }

      return z.object(shape).passthrough();
    }

    // Fallback: accept anything
    return z.unknown();
  }

  /**
   * Converts a single JSON-Schema property definition to a Zod type.
   */
  private primitiveToZod(prop: Record<string, unknown>): z.ZodType {
    const type = prop.type as string | undefined;
    const enumValues = prop.enum as unknown[] | undefined;

    if (enumValues && Array.isArray(enumValues)) {
      return z.enum(enumValues.map(String) as [string, ...string[]]);
    }

    switch (type) {
      case "string": {
        let s = z.string();
        if (typeof prop.minLength === "number") {
          s = s.min(prop.minLength);
        }
        if (typeof prop.maxLength === "number") {
          s = s.max(prop.maxLength);
        }
        return s;
      }
      case "number":
      case "integer": {
        let n = z.number();
        if (type === "integer") {
          n = n.int();
        }
        if (typeof prop.minimum === "number") {
          n = n.min(prop.minimum);
        }
        if (typeof prop.maximum === "number") {
          n = n.max(prop.maximum);
        }
        return n;
      }
      case "boolean":
        return z.boolean();
      case "array":
        return z.array(z.unknown());
      case "object":
        return this.jsonSchemaToZod(prop);
      default:
        return z.unknown();
    }
  }

  /**
   * Deep-clones a value while trimming all string leaves.
   */
  private sanitizeObject(value: unknown): unknown {
    if (typeof value === "string") {
      return value.trim();
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.sanitizeObject(v));
    }
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = this.sanitizeObject(val);
      }
      return result;
    }
    return value;
  }
}
