/**
 * Canonical capability identifiers used by the entitlement system.
 *
 * Every gated resource has a stable string ID. Streams compose these
 * with EntitlementType to form an EntitlementRef:
 *   { type: "DATA_API", refId: CAPABILITY_IDS.DATA_API.PUBLISHERS_GLOBAL_V1 }
 *
 * Adding a new capability: append a constant here, never modify or remove
 * existing values — they appear in WorkspaceEntitlement rows in production.
 */

export const CAPABILITY_IDS = {
  /** Recipes — manifestable workspace templates */
  RECIPE: {
    AUTHOR_PUBLISHING_V1: "aizona/author-publishing-v1",
  },

  /** Data API connectors — paid external data sources */
  DATA_API: {
    PUBLISHERS_GLOBAL_V1: "publishers-global-v1",
  },

  /** Individual skills (CommunitySkill rows) gated by entitlement */
  SKILL: {
    EMAIL_CAMPAIGN_ADVANCED: "email-campaign-advanced",
  },

  /** Tool bundles — collections of capabilities unlocked together */
  BUNDLE: {
    PUBLISHER_RESEARCH_TOOLKIT: "publisher-research-toolkit-v1",
  },

  /** Sandbox host functions — injected into V8 isolates */
  HOST_FN: {
    KB_READ: "kb.read",
    KB_WRITE: "kb.write",
    CHAT_SEND: "chat.send",
    SECRETS_GET: "secrets.get",
    DATA_API_CALL: "dataApi.call",
    HTTP_FETCH: "http.fetch",
    MESH_DELEGATE: "mesh.delegate",
  },
} as const;

/**
 * EntitlementType matches the Prisma enum. Streams that touch the DB
 * import the Prisma enum directly; this constant is for code that
 * builds refs without depending on @prisma/client.
 */
export const ENTITLEMENT_TYPES = ["BUNDLE", "SKILL", "TOOL", "DATA_API", "RECIPE"] as const;
export type EntitlementType = (typeof ENTITLEMENT_TYPES)[number];

export const ENTITLEMENT_SOURCES = [
  "TIER_INCLUDED",
  "AIZ_UNLOCKED",
  "USD_SUBSCRIPTION",
  "METERED",
  "TRIAL",
] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

export interface EntitlementRef {
  type: EntitlementType;
  refId: string;
}

export interface UnlockOption {
  source: EntitlementSource;
  /** Cost in AIZ when source = AIZ_UNLOCKED, USD when USD_SUBSCRIPTION. */
  cost?: { amount: number; currency: "AIZ" | "USD" };
  /** Description shown on the unlock card in chat. */
  description: string;
  /** Optional tier requirement (e.g. requires PRO subscription). */
  requiresTier?: "FREE" | "PRO" | "TEAM" | "ENTERPRISE";
}

/**
 * Authoring helper: compile-time guarantee that a refId is one of the
 * known constants. Skip if dynamic.
 */
export function ref<T extends EntitlementType>(type: T, refId: string): EntitlementRef {
  return { type, refId };
}

/**
 * Skill implementation kinds — cross-stream sync Drift 2.
 * Used by D.14 (cooling-off), D.21 (create_tool admin path), and G.21 (admin review queue).
 */
export type SkillKind = "JS_SOURCE" | "SOP_COMPOSITION" | "PROMPT_TEMPLATE";

/**
 * Items that can appear in a review queue — skills of any kind, or tools.
 */
export type ReviewItemKind = SkillKind | "TOOL";
