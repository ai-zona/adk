import { z } from "zod";

export interface TestFixture {
  input: string;
  expected: string;
}

export const testFixtureSchema = z.object({
  input: z.string(),
  expected: z.string(),
});
