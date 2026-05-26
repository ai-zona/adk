import { z } from "zod";
import { AZADIDSchema } from "./did";
import { signMessage, verifySignature } from "./signing";

// ──────────────────────────────────────────────────────
// Agent Card v2 (JSON-LD compatible)
// ──────────────────────────────────────────────────────
// An Agent Card is the public-facing identity document for an AZA agent.
// It describes the agent's capabilities, endpoints, and is self-signed
// with the agent's Ed25519 key to prove authenticity.
// ──────────────────────────────────────────────────────

/**
 * A skill that an agent can perform.
 */
export const AgentSkillSchema = z.object({
  /** Unique skill identifier (e.g., "text-generation", "image-analysis"). */
  name: z.string().min(1).max(200),
  /** Human-readable description of the skill. */
  description: z.string().max(2000).optional(),
  /** JSON Schema describing expected input. */
  inputSchema: z.record(z.unknown()).optional(),
  /** JSON Schema describing expected output. */
  outputSchema: z.record(z.unknown()).optional(),
  /** Version of this skill implementation. */
  version: z.string().optional(),
  /** Tags for discovery and categorization. */
  tags: z.array(z.string()).optional(),
  /** Pricing information for this skill. */
  pricing: z
    .object({
      amount: z.string(),
      currency: z.string(),
      per: z.string().optional(), // "task", "token", "hour"
    })
    .optional(),
});

export type AgentSkill = z.infer<typeof AgentSkillSchema>;

/**
 * An endpoint where the agent can be reached.
 */
export const AgentEndpointSchema = z.object({
  /** The URL of the endpoint. */
  url: z.string().url(),
  /** Transport protocol. */
  transport: z.enum(["http", "ws", "grpc"]),
  /** Authentication method required. */
  authentication: z.enum(["none", "did-auth", "api-key", "oauth"]).optional(),
  /** Human-readable description. */
  description: z.string().max(500).optional(),
});

export type AgentEndpoint = z.infer<typeof AgentEndpointSchema>;

/**
 * The Agent Card schema (unsigned portion).
 * This is the data that gets signed to produce the complete Agent Card.
 */
export const AgentCardDataSchema = z.object({
  /** JSON-LD context for semantic interoperability. */
  "@context": z
    .union([z.string(), z.array(z.string())])
    .default("https://schema.aizona.io/agent-card/v2"),

  /** JSON-LD type. */
  "@type": z.literal("AgentCard").default("AgentCard"),

  /** The agent's DID (did:aza:network:identifier). */
  did: AZADIDSchema,

  /** Human-readable agent name. */
  name: z.string().min(1).max(200),

  /** Description of the agent's purpose and capabilities. */
  description: z.string().max(5000).optional(),

  /** Agent Card schema version. */
  version: z.string().default("2.0.0"),

  /** List of skills the agent supports. */
  skills: z.array(AgentSkillSchema).min(1),

  /** List of endpoints where the agent can be reached. */
  endpoints: z.array(AgentEndpointSchema).optional(),

  /** The agent's Ed25519 public key in hex format. */
  publicKey: z.string().regex(/^[0-9a-f]{64}$/i, "Public key must be 64 hex characters"),

  /** ISO 8601 timestamp when this card was created. */
  created: z.string().datetime(),

  /** ISO 8601 timestamp when this card was last updated. */
  updated: z.string().datetime(),

  /** Additional metadata. */
  metadata: z.record(z.unknown()).optional(),
});

export type AgentCardData = z.infer<typeof AgentCardDataSchema>;

/**
 * A complete, signed Agent Card.
 * The signature covers the canonical JSON serialization of the AgentCardData.
 */
export const AgentCardSchema = AgentCardDataSchema.extend({
  /** JWS-format signature (self-signed by the agent's private key). */
  signature: z.string(),
});

export type AgentCard = z.infer<typeof AgentCardSchema>;

// ──────────────────────────────────────────────────────
// Sign / Verify Helpers
// ──────────────────────────────────────────────────────

/**
 * Sign an Agent Card with the agent's private key.
 *
 * Creates a self-signed Agent Card by signing the card data (without the
 * signature field) using the agent's Ed25519 private key.
 *
 * @param cardData - The unsigned agent card data.
 * @param privateKey - The agent's Ed25519 private key (32 bytes).
 * @returns The complete signed Agent Card.
 */
export async function signAgentCard(
  cardData: AgentCardData,
  privateKey: Uint8Array,
): Promise<AgentCard> {
  // Validate the card data first
  const validated = AgentCardDataSchema.parse(cardData);

  // Sign the card data (without any existing signature)
  const signature = await signMessage(validated, privateKey);

  return {
    ...validated,
    signature,
  };
}

/**
 * Verify an Agent Card's self-signature.
 *
 * Extracts the public key from the card, removes the signature field,
 * and verifies that the signature was created by the holder of the
 * corresponding private key.
 *
 * @param card - The signed Agent Card to verify.
 * @returns The verified Agent Card data (payload from the signature).
 * @throws Error if the signature is invalid.
 */
export async function verifyAgentCard(card: AgentCard): Promise<AgentCardData> {
  // Parse and validate the card
  const validated = AgentCardSchema.parse(card);

  // Import the public key from the card
  const { publicKeyFromHex } = await import("./keypair");
  const publicKey = publicKeyFromHex(validated.publicKey);

  // Verify the signature - returns the original signed payload
  const payload = await verifySignature(validated.signature, publicKey);

  // Validate the returned payload matches the expected schema
  return AgentCardDataSchema.parse(payload);
}

/**
 * Create a new unsigned Agent Card data object with required defaults.
 */
export function createAgentCardData(params: {
  did: string;
  name: string;
  description?: string;
  skills: AgentSkill[];
  endpoints?: AgentEndpoint[];
  publicKey: string;
  metadata?: Record<string, unknown>;
}): AgentCardData {
  const now = new Date().toISOString();
  return AgentCardDataSchema.parse({
    "@context": "https://schema.aizona.io/agent-card/v2",
    "@type": "AgentCard" as const,
    did: params.did,
    name: params.name,
    description: params.description,
    version: "2.0.0",
    skills: params.skills,
    endpoints: params.endpoints,
    publicKey: params.publicKey,
    created: now,
    updated: now,
    metadata: params.metadata,
  });
}
