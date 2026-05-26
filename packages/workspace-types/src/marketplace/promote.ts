import { z } from "zod";

export type PricingMode = "FREE" | "AIZ" | "AIZ_USD";

export const pricingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("FREE") }),
  z.object({ mode: z.literal("AIZ"), amount: z.number().int().positive() }),
  z.object({
    mode: z.literal("AIZ_USD"),
    aizAmount: z.number().int().positive(),
    usdAmount: z.number().positive(),
  }),
]);
