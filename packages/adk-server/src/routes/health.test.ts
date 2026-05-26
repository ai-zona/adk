import { describe, expect, it } from "vitest";
import { createServer } from "../server";

describe("health routes", () => {
  describe("GET /health", () => {
    it("returns status ok with version and timestamp", async () => {
      const app = createServer();
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.version).toBe("0.1.0");
      expect(body.timestamp).toBeDefined();
      // Timestamp should be a valid ISO date string
      expect(() => new Date(body.timestamp)).not.toThrow();
    });

    it("returns health even without authentication configured", async () => {
      const app = createServer();
      // Health should bypass any auth middleware
      const res = await app.request("/health");
      expect(res.status).toBe(200);
    });

    it("returns health when auth is required for other routes", async () => {
      const app = createServer({
        validateApiKey: async () => null, // All keys invalid
      });

      // Health should still work without auth
      const healthRes = await app.request("/health");
      expect(healthRes.status).toBe(200);

      // But other routes should require auth
      const agentsRes = await app.request("/v1/agents");
      expect(agentsRes.status).toBe(401);
    });
  });
});
