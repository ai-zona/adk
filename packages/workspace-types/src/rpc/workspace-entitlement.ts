import { z } from "zod";
import { ENTITLEMENT_SOURCES, ENTITLEMENT_TYPES } from "../capabilities/identifiers.js";

const cuid = z.string().min(20).max(40);
const refSchema = z.object({ type: z.enum(ENTITLEMENT_TYPES), refId: z.string().min(1).max(120) });

export const listEntitlementsInputSchema = z.object({
  workspaceId: cuid,
  type: z.enum(ENTITLEMENT_TYPES).optional(),
});
export const listEntitlementsOutputSchema = z.object({
  entitlements: z.array(
    z.object({
      id: z.string(),
      type: z.enum(ENTITLEMENT_TYPES),
      refId: z.string(),
      source: z.enum(ENTITLEMENT_SOURCES),
      unlockedAt: z.string().datetime({ offset: true }),
      expiresAt: z.string().datetime({ offset: true }).nullable(),
      unlockedBy: z.string().nullable(),
      txHash: z.string().nullable(),
      metadata: z.record(z.unknown()).nullable(),
    }),
  ),
});

export const checkEntitlementInputSchema = z.object({ workspaceId: cuid, ref: refSchema });
export const checkEntitlementOutputSchema = z.object({
  ok: z.boolean(),
  source: z.enum(ENTITLEMENT_SOURCES).optional(),
  unlockOptions: z
    .array(
      z.object({
        source: z.enum(ENTITLEMENT_SOURCES),
        cost: z.object({ amount: z.number(), currency: z.enum(["AIZ", "USD"]) }).optional(),
        description: z.string(),
        requiresTier: z.enum(["FREE", "PRO", "TEAM", "ENTERPRISE"]).optional(),
      }),
    )
    .optional(),
});

export const meteredUsageSummaryInputSchema = z.object({
  workspaceId: cuid,
  /** ISO 8601 — defaults to start of current month */
  since: z.string().datetime({ offset: true }).optional(),
});
export const meteredUsageSummaryOutputSchema = z.object({
  totalAiz: z.number(),
  totalUsd: z.number(),
  byCapability: z.array(
    z.object({
      capability: z.string(),
      callCount: z.number().int().nonnegative(),
      aiz: z.number(),
      usd: z.number(),
    }),
  ),
  unsettledRowCount: z.number().int().nonnegative(),
});

export const workspaceEntitlementProcedures = {
  listEntitlements: { input: listEntitlementsInputSchema, output: listEntitlementsOutputSchema },
  checkEntitlement: { input: checkEntitlementInputSchema, output: checkEntitlementOutputSchema },
  meteredUsageSummary: {
    input: meteredUsageSummaryInputSchema,
    output: meteredUsageSummaryOutputSchema,
  },
} as const;
